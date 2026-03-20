import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PI_DIR = join(homedir(), ".pi", "agent");
const RECENT_FILE = join(PI_DIR, "recent-models.json");
const KEYBINDINGS_FILE = join(PI_DIR, "keybindings.json");
const KEYBINDING_ID = "ext.recentModels.cycle";
const MAX_RECENT = 5;

interface SavedModel {
  provider: string;
  id: string;
}

function getKeybinding(): string | undefined {
  try {
    const kb = JSON.parse(readFileSync(KEYBINDINGS_FILE, "utf8"));
    const v = kb[KEYBINDING_ID];
    if (!v) return undefined;
    const key = Array.isArray(v) ? v[0] : v;
    return key || undefined;
  } catch {}
  return undefined;
}

export default function (pi: ExtensionAPI) {
  let stack: SavedModel[] = [];
  let cycling = false;

  async function load(): Promise<void> {
    try {
      stack = JSON.parse(await readFile(RECENT_FILE, "utf8"));
    } catch {
      stack = [];
    }
  }

  async function save(): Promise<void> {
    try {
      await writeFile(RECENT_FILE, JSON.stringify(stack, null, 2));
    } catch {}
  }

  function isSame(a: SavedModel, b: SavedModel): boolean {
    return a.provider === b.provider && a.id === b.id;
  }

  // On model change (manual, restore) — push to top of stack
  pi.on("model_select", async (event) => {
    if (cycling) return;

    const m: SavedModel = { provider: event.model.provider, id: event.model.id };
    stack = stack.filter((r) => !isSame(r, m));
    stack.unshift(m);
    if (stack.length > MAX_RECENT) stack.pop();
    await save();
  });

  pi.on("session_start", async () => {
    await load();
  });

  async function cycleModel(ctx: any): Promise<void> {
    if (stack.length < 2) {
      ctx.ui.notify("No other recent models", "info");
      return;
    }

    // Pop current from top, push to bottom
    const current = stack.shift()!;
    stack.push(current);

    const target = stack[0];
    const model = ctx.modelRegistry.find(target.provider, target.id);

    if (!model) {
      ctx.ui.notify(`Not found: ${target.provider}/${target.id}`, "error");
      return;
    }

    cycling = true;
    const ok = await pi.setModel(model);
    cycling = false;

    if (!ok) {
      ctx.ui.notify(`No API key for ${target.id}`, "error");
    }

    await save();
  }

  pi.registerCommand("cycle-model", {
    description: "Cycle through recent models",
    handler: async (_args, ctx) => {
      await cycleModel(ctx);
    },
  });

  const key = getKeybinding();
  if (key) {
    pi.registerShortcut(key as any, {
      description: "Cycle through recent models",
      handler: async (ctx) => {
        await cycleModel(ctx);
      },
    });
  }
}
