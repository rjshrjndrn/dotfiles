/**
 * Claude UI-style Tree Tool Renderer
 *
 * Makes tool output look like Claude's web UI:
 * - Compact one-line summaries when collapsed
 * - Tree-like visual indicators (▶/▼)
 * - Status badges (⏳ running, ✓ success, ✗ error)
 * - Indented output when expanded with tree lines
 * - Tools collapsed by default
 *
 * Usage: Place in ~/.pi/agent/extensions/collapse-tools.ts
 * Toggle expand: ctrl+e
 */

import type {
  BashToolDetails,
  EditToolDetails,
  ExtensionAPI,
  FindToolDetails,
  GrepToolDetails,
  LsToolDetails,
  ReadToolDetails,
} from "@mariozechner/pi-coding-agent";
import {
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
  keyHint,
} from "@mariozechner/pi-coding-agent";
import { Container, Text } from "@mariozechner/pi-tui";
import { homedir } from "os";

function shortPath(path: string): string {
  const home = homedir();
  if (path.startsWith(home)) return `~${path.slice(home.length)}`;
  return path;
}

// Cache built-in tools per cwd
const cache = new Map<string, ReturnType<typeof mkTools>>();
function mkTools(cwd: string) {
  return {
    read: createReadTool(cwd),
    bash: createBashTool(cwd),
    edit: createEditTool(cwd),
    write: createWriteTool(cwd),
    find: createFindTool(cwd),
    grep: createGrepTool(cwd),
    ls: createLsTool(cwd),
  };
}
function tools(cwd: string) {
  let t = cache.get(cwd);
  if (!t) { t = mkTools(cwd); cache.set(cwd, t); }
  return t;
}

export default function (pi: ExtensionAPI) {
  // Collapse tools by default
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setToolsExpanded(false);
  });

  // ── Read ──────────────────────────────────────────────────────────────
  const readOrig = tools(process.cwd()).read;
  pi.registerTool({
    name: "read",
    label: "read",
    description: readOrig.description,
    parameters: readOrig.parameters,

    async execute(id, params, signal, onUpdate, ctx) {
      return tools(ctx.cwd).read.execute(id, params, signal, onUpdate);
    },

    renderCall(args, theme, context) {
      const arrow = context.expanded ? "▼" : "▶";
      const path = shortPath(args.path || "");
      let line = theme.fg("dim", arrow + " ");
      line += theme.fg("toolTitle", theme.bold("read")) + " ";
      line += theme.fg("accent", path);
      if (args.offset || args.limit) {
        const parts: string[] = [];
        if (args.offset) parts.push(`L${args.offset}`);
        if (args.limit) parts.push(`${args.limit} lines`);
        line += theme.fg("dim", ` (${parts.join(", ")})`);
      }
      return new Text(line, 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme, _context) {
      if (isPartial) return new Text(theme.fg("warning", "  ⏳ reading…"), 0, 0);

      const details = result.details as ReadToolDetails | undefined;
      const content = result.content[0];

      if (content?.type === "image") {
        return new Text(theme.fg("success", "  ✓ image loaded"), 0, 0);
      }
      if (content?.type !== "text") {
        return new Text(theme.fg("error", "  ✗ no content"), 0, 0);
      }

      const lineCount = content.text.split("\n").length;
      let text = theme.fg("success", "  ✓ ") + theme.fg("muted", `${lineCount} lines`);

      if (details?.truncation?.truncated) {
        text += theme.fg("warning", ` (truncated from ${details.truncation.totalLines})`);
      }

      if (expanded) {
        const lines = content.text.split("\n").slice(0, 25);
        for (const l of lines) {
          text += "\n" + theme.fg("dim", "  │ ") + theme.fg("toolOutput", l);
        }
        if (lineCount > 25) {
          text += "\n" + theme.fg("dim", `  └─ … ${lineCount - 25} more lines`);
        } else {
          text += "\n" + theme.fg("dim", "  └─");
        }
      }

      return new Text(text, 0, 0);
    },
  });

  // ── Bash ──────────────────────────────────────────────────────────────
  const bashOrig = tools(process.cwd()).bash;
  pi.registerTool({
    name: "bash",
    label: "bash",
    description: bashOrig.description,
    parameters: bashOrig.parameters,

    async execute(id, params, signal, onUpdate, ctx) {
      return tools(ctx.cwd).bash.execute(id, params, signal, onUpdate);
    },

    renderCall(args, theme, context) {
      const arrow = context.expanded ? "▼" : "▶";
      const cmd = args.command || "…";
      const display = cmd.length > 100 ? cmd.slice(0, 97) + "…" : cmd;
      let line = theme.fg("dim", arrow + " ");
      line += theme.fg("toolTitle", theme.bold("$")) + " ";
      line += theme.fg("accent", display);
      if (args.timeout) {
        line += theme.fg("dim", ` (${args.timeout}s)`);
      }
      return new Text(line, 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme, _context) {
      if (isPartial) return new Text(theme.fg("warning", "  ⏳ running…"), 0, 0);

      const content = result.content[0];
      const output = content?.type === "text" ? content.text : "";
      const allLines = output.split("\n");
      const nonEmpty = allLines.filter((l) => l.trim()).length;

      const exitMatch = output.match(/exit code: (\d+)/);
      const exitCode = exitMatch ? parseInt(exitMatch[1], 10) : null;
      const details = result.details as BashToolDetails | undefined;

      let text: string;
      if (exitCode === null || exitCode === 0) {
        text = theme.fg("success", "  ✓ ") + theme.fg("muted", `${nonEmpty} lines`);
      } else {
        text = theme.fg("error", `  ✗ exit ${exitCode}`) + theme.fg("muted", ` (${nonEmpty} lines)`);
      }

      if (details?.truncation?.truncated) {
        text += theme.fg("warning", " [truncated]");
      }

      if (expanded) {
        const lines = allLines.slice(0, 30);
        for (const l of lines) {
          text += "\n" + theme.fg("dim", "  │ ") + theme.fg("toolOutput", l);
        }
        if (allLines.length > 30) {
          text += "\n" + theme.fg("dim", `  └─ … ${allLines.length - 30} more lines`);
        } else {
          text += "\n" + theme.fg("dim", "  └─");
        }
      }

      return new Text(text, 0, 0);
    },
  });

  // ── Edit ──────────────────────────────────────────────────────────────
  const editOrig = tools(process.cwd()).edit;
  pi.registerTool({
    name: "edit",
    label: "edit",
    description: editOrig.description,
    parameters: editOrig.parameters,

    async execute(id, params, signal, onUpdate, ctx) {
      return tools(ctx.cwd).edit.execute(id, params, signal, onUpdate);
    },

    renderCall(args, theme, context) {
      const arrow = context.expanded ? "▼" : "▶";
      const path = shortPath(args.path || "");
      const edits = args.edits?.length ?? 0;
      let line = theme.fg("dim", arrow + " ");
      line += theme.fg("toolTitle", theme.bold("edit")) + " ";
      line += theme.fg("accent", path);
      if (edits > 1) line += theme.fg("dim", ` (${edits} edits)`);
      return new Text(line, 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme, _context) {
      if (isPartial) return new Text(theme.fg("warning", "  ⏳ editing…"), 0, 0);

      const details = result.details as EditToolDetails | undefined;
      const content = result.content[0];

      if (content?.type === "text" && content.text.startsWith("Error")) {
        return new Text(theme.fg("error", "  ✗ ") + theme.fg("error", content.text.split("\n")[0]), 0, 0);
      }

      if (!details?.diff) {
        return new Text(theme.fg("success", "  ✓ applied"), 0, 0);
      }

      const diffLines = details.diff.split("\n");
      let adds = 0, dels = 0;
      for (const l of diffLines) {
        if (l.startsWith("+") && !l.startsWith("+++")) adds++;
        if (l.startsWith("-") && !l.startsWith("---")) dels++;
      }

      let text = theme.fg("success", "  ✓ ");
      text += theme.fg("success", `+${adds}`) + theme.fg("dim", "/") + theme.fg("error", `-${dels}`);

      for (const l of diffLines.slice(0, 40)) {
        const prefix = theme.fg("dim", "  │ ");
        if (l.startsWith("+") && !l.startsWith("+++")) {
          text += "\n" + prefix + theme.fg("toolDiffAdded", l);
        } else if (l.startsWith("-") && !l.startsWith("---")) {
          text += "\n" + prefix + theme.fg("toolDiffRemoved", l);
        } else {
          text += "\n" + prefix + theme.fg("toolDiffContext", l);
        }
      }
      if (diffLines.length > 40) {
        text += "\n" + theme.fg("dim", `  └─ … ${diffLines.length - 40} more diff lines`);
      } else {
        text += "\n" + theme.fg("dim", "  └─");
      }

      return new Text(text, 0, 0);
    },
  });

  // ── Write ─────────────────────────────────────────────────────────────
  const writeOrig = tools(process.cwd()).write;
  pi.registerTool({
    name: "write",
    label: "write",
    description: writeOrig.description,
    parameters: writeOrig.parameters,

    async execute(id, params, signal, onUpdate, ctx) {
      return tools(ctx.cwd).write.execute(id, params, signal, onUpdate);
    },

    renderCall(args, theme, context) {
      const arrow = context.expanded ? "▼" : "▶";
      const path = shortPath(args.path || "");
      const lines = args.content ? args.content.split("\n").length : 0;
      let line = theme.fg("dim", arrow + " ");
      line += theme.fg("toolTitle", theme.bold("write")) + " ";
      line += theme.fg("accent", path);
      if (lines > 0) line += theme.fg("dim", ` (${lines} lines)`);
      return new Text(line, 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme, _context) {
      if (isPartial) return new Text(theme.fg("warning", "  ⏳ writing…"), 0, 0);

      const content = result.content[0];
      if (content?.type === "text" && content.text.toLowerCase().includes("error")) {
        return new Text(theme.fg("error", "  ✗ ") + theme.fg("error", content.text.split("\n")[0]), 0, 0);
      }

      return new Text(theme.fg("success", "  ✓ written"), 0, 0);
    },
  });

  // ── Find ──────────────────────────────────────────────────────────────
  const findOrig = tools(process.cwd()).find;
  pi.registerTool({
    name: "find",
    label: "find",
    description: findOrig.description,
    parameters: findOrig.parameters,

    async execute(id, params, signal, onUpdate, ctx) {
      return tools(ctx.cwd).find.execute(id, params, signal, onUpdate);
    },

    renderCall(args, theme, context) {
      const arrow = context.expanded ? "▼" : "▶";
      const pattern = args.pattern || "*";
      const path = shortPath(args.path || ".");
      let line = theme.fg("dim", arrow + " ");
      line += theme.fg("toolTitle", theme.bold("find")) + " ";
      line += theme.fg("accent", pattern);
      line += theme.fg("dim", ` in ${path}`);
      return new Text(line, 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme, _context) {
      if (isPartial) return new Text(theme.fg("warning", "  ⏳ searching…"), 0, 0);

      const content = result.content[0];
      if (content?.type !== "text") return new Text(theme.fg("error", "  ✗ no results"), 0, 0);

      const files = content.text.trim().split("\n").filter(Boolean);
      let text = theme.fg("success", "  ✓ ") + theme.fg("muted", `${files.length} files`);

      if (expanded) {
        const show = files.slice(0, 30);
        for (const f of show) {
          text += "\n" + theme.fg("dim", "  │ ") + theme.fg("toolOutput", f);
        }
        if (files.length > 30) {
          text += "\n" + theme.fg("dim", `  └─ … ${files.length - 30} more`);
        } else {
          text += "\n" + theme.fg("dim", "  └─");
        }
      }

      return new Text(text, 0, 0);
    },
  });

  // ── Grep ──────────────────────────────────────────────────────────────
  const grepOrig = tools(process.cwd()).grep;
  pi.registerTool({
    name: "grep",
    label: "grep",
    description: grepOrig.description,
    parameters: grepOrig.parameters,

    async execute(id, params, signal, onUpdate, ctx) {
      return tools(ctx.cwd).grep.execute(id, params, signal, onUpdate);
    },

    renderCall(args, theme, context) {
      const arrow = context.expanded ? "▼" : "▶";
      const pattern = args.pattern || "";
      const path = shortPath(args.path || ".");
      let line = theme.fg("dim", arrow + " ");
      line += theme.fg("toolTitle", theme.bold("grep")) + " ";
      line += theme.fg("accent", `/${pattern}/`);
      line += theme.fg("dim", ` in ${path}`);
      if (args.glob) line += theme.fg("dim", ` (${args.glob})`);
      return new Text(line, 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme, _context) {
      if (isPartial) return new Text(theme.fg("warning", "  ⏳ searching…"), 0, 0);

      const content = result.content[0];
      if (content?.type !== "text") return new Text(theme.fg("error", "  ✗ no results"), 0, 0);

      const matches = content.text.trim().split("\n").filter(Boolean);
      let text = theme.fg("success", "  ✓ ") + theme.fg("muted", `${matches.length} matches`);

      if (expanded) {
        const show = matches.slice(0, 30);
        for (const m of show) {
          text += "\n" + theme.fg("dim", "  │ ") + theme.fg("toolOutput", m);
        }
        if (matches.length > 30) {
          text += "\n" + theme.fg("dim", `  └─ … ${matches.length - 30} more`);
        } else {
          text += "\n" + theme.fg("dim", "  └─");
        }
      }

      return new Text(text, 0, 0);
    },
  });

  // ── Ls ────────────────────────────────────────────────────────────────
  const lsOrig = tools(process.cwd()).ls;
  pi.registerTool({
    name: "ls",
    label: "ls",
    description: lsOrig.description,
    parameters: lsOrig.parameters,

    async execute(id, params, signal, onUpdate, ctx) {
      return tools(ctx.cwd).ls.execute(id, params, signal, onUpdate);
    },

    renderCall(args, theme, context) {
      const arrow = context.expanded ? "▼" : "▶";
      const path = shortPath(args.path || ".");
      let line = theme.fg("dim", arrow + " ");
      line += theme.fg("toolTitle", theme.bold("ls")) + " ";
      line += theme.fg("accent", path);
      return new Text(line, 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme, _context) {
      if (isPartial) return new Text(theme.fg("warning", "  ⏳ listing…"), 0, 0);

      const content = result.content[0];
      if (content?.type !== "text") return new Text(theme.fg("error", "  ✗ empty"), 0, 0);

      const entries = content.text.trim().split("\n").filter(Boolean);
      let text = theme.fg("success", "  ✓ ") + theme.fg("muted", `${entries.length} entries`);

      if (expanded) {
        const show = entries.slice(0, 30);
        for (const e of show) {
          text += "\n" + theme.fg("dim", "  │ ") + theme.fg("toolOutput", e);
        }
        if (entries.length > 30) {
          text += "\n" + theme.fg("dim", `  └─ … ${entries.length - 30} more`);
        } else {
          text += "\n" + theme.fg("dim", "  └─");
        }
      }

      return new Text(text, 0, 0);
    },
  });
}
