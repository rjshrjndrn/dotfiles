import type { Plugin } from "@opencode-ai/plugin";

const WRITE_TOOLS = new Set(["edit", "write", "apply_patch", "bash"]);
const GIT_COMMIT = /\bgit\s+(commit|merge|rebase|cherry-pick)\b/;

type Task = { status?: string; id?: number; ref?: string };
type Todo = { id: string; content: string; status: string; priority: string };

async function run(cmd: string, stdin?: string): Promise<string | undefined> {
  const proc = Bun.spawn(["sh", "-c", cmd], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: stdin ? new Blob([stdin]) : undefined,
  });
  const text = await new Response(proc.stdout).text();
  const code = await proc.exited;
  if (code !== 0) return undefined;
  return text.trim();
}

async function tasks(): Promise<Task[]> {
  const raw = await run("tk list");
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Task[];
  } catch {
    return [];
  }
}

async function active(): Promise<boolean> {
  const list = await tasks();
  return list.some((t) => t.status === "active");
}

async function todosGet(): Promise<Todo[]> {
  const raw = await run("tk todos get");
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Todo[];
  } catch {
    return [];
  }
}

async function todosSync(todos: Todo[]): Promise<Todo[]> {
  const raw = await run("tk todos sync", JSON.stringify(todos));
  if (!raw) return todos;
  try {
    return JSON.parse(raw) as Todo[];
  } catch {
    return todos;
  }
}

async function block(client: any, reason: string) {
  await client.tui.showToast({
    body: {
      message: `Blocked: ${reason}`,
      variant: "error",
      duration: 8000,
    },
  });
}

export const plugin: Plugin = async ({ client }) => {
  let defaultPrompt: string | undefined;
  let projectPrompt: string | undefined;

  const [defaultRaw, projectRaw] = await Promise.all([
    run("tk system get-default-prompt"),
    run("tk project get"),
  ]);

  if (defaultRaw) {
    try {
      const parsed = JSON.parse(defaultRaw) as { default_prompt?: string };
      if (parsed.default_prompt) defaultPrompt = parsed.default_prompt.trim();
    } catch {}
  }

  if (projectRaw) {
    try {
      const parsed = JSON.parse(projectRaw) as { prompt?: string };
      if (parsed.prompt) projectPrompt = parsed.prompt.trim();
    } catch {}
  }

  let toasted = false;
  return {
    event: async ({ event }) => {
      if (event.type !== "session.created") return;
      if (toasted) return;
      toasted = true;
      const loaded = defaultPrompt || projectPrompt;
      await client.tui.showToast({
        body: {
          message: loaded
            ? "tk: instructions loaded"
            : "tk: no instructions found",
          variant: loaded ? "success" : "warning",
        },
      });
    },

    "experimental.chat.system.transform": async (_input, output) => {
      if (defaultPrompt) output.system.push(defaultPrompt);
      if (projectPrompt) output.system.push(projectPrompt);

      // inject current tk task state so the LLM has context
      const todos = await todosGet();
      if (todos.length > 0) {
        const lines = todos.map((t) => {
          const mark =
            t.status === "completed"
              ? "x"
              : t.status === "in_progress"
                ? "*"
                : " ";
          return `[${mark}] ${t.content}`;
        });
        output.system.push(
          `## Current tk tasks\n${lines.join("\n")}\n\nWhen using todowrite, preserve [PREFIX-N] refs in content. New items without refs will be auto-created in tk.`,
        );
      }
    },

    "experimental.session.compacting": async (_input, output) => {
      if (defaultPrompt) output.context.push(defaultPrompt);
      if (projectPrompt) output.context.push(projectPrompt);
    },

    "tool.execute.before": async (input, output) => {
      // --- todowrite: sync to tk ---
      if (input.tool === "todowrite") {
        const args = output.args as { todos?: Todo[] };
        if (args.todos && args.todos.length > 0) {
          const synced = await todosSync(args.todos);
          (output.args as { todos: Todo[] }).todos = synced;
        }
        return;
      }

      if (!WRITE_TOOLS.has(input.tool)) return;

      // git commit: block if no active task
      if (input.tool === "bash") {
        const cmd = (output.args as { command?: string }).command ?? "";
        if (!GIT_COMMIT.test(cmd)) return;
        if (await active()) return;
        await block(
          client,
          "no active tk task. Run `tk start -id <ref>` first.",
        );
        output.args = {
          command:
            "echo 'BLOCKED: No active tk task. Create and start a task with `tk create` and `tk start` before committing.'",
        };
        return;
      }

      // file writes: block if no active task
      if (await active()) return;
      await block(
        client,
        "no active tk task. Create a task plan before writing code.",
      );
      const path =
        (output.args as { filePath?: string; file_path?: string }).filePath ??
        (output.args as { file_path?: string }).file_path ??
        "unknown";
      output.args = {
        ...(output.args as Record<string, unknown>),
        content: `// BLOCKED: No active tk task. File write to ${path} was prevented.\n// Run: tk create -name "your task" && tk start -id <ref>`,
      };
    },

    "tool.execute.after": async (input, output) => {
      // --- todoread: return tk tasks ---
      if (input.tool === "todoread") {
        const todos = await todosGet();
        output.output = JSON.stringify(todos, null, 2);
        output.metadata = { todos };
      }
    },

    "tool.definition": async (input, output) => {
      if (input.toolID === "todowrite") {
        output.description +=
          "\n\nIMPORTANT: Tasks are synced to tk. Preserve [PREFIX-N] refs (e.g. [TK-5]) at the start of content strings for existing tasks. New items without a ref will be auto-created in tk. Status mapping: pending, in_progress, completed, cancelled.";
      }
      if (input.toolID === "bash") {
        output.description +=
          "\n\nIMPORTANT: Before running `git commit`, verify a tk task is active with `tk list`. If none is active, create one with `tk create` and start it with `tk start -id <ref>`. Commits without an active task will be blocked.";
      }
      if (
        input.toolID === "edit" ||
        input.toolID === "write" ||
        input.toolID === "apply_patch"
      ) {
        output.description +=
          "\n\nIMPORTANT: File modifications require an active tk task. Check with `tk list` first. If no task is active, create and start one before making changes.";
      }
    },
  };
};
