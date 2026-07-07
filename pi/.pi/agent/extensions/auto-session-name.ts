/**
 * Auto Session Name Extension
 *
 * Registers a `name_session` tool that the agent calls to set a
 * 2-3 word topic name for the session. Injects a system prompt
 * nudge on first turn so the agent names the session naturally.
 *
 * No extra LLM call — the main agent does the naming itself.
 */

import { Type } from "typebox";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  // Register the tool
  pi.registerTool({
    name: "name_session",
    label: "Name Session",
    description:
      "Set a 2-3 word topic name for this session. Call this after your first response. " +
      "Focus on WHAT the work is about (subject/area), not what the user asked to do. " +
      "Examples: 'auth token expiry', 'settings dark mode', 'db connection pool'.",
    parameters: Type.Object({
      name: Type.String({
        description:
          "2-3 word topic name. No quotes, no verbs, no prefix. e.g. 'session naming ext'",
      }),
    }),
    async execute(_toolCallId, params) {
      const name = params.name
        .replace(/[\r\n\t]/g, " ")
        .replace(/ +/g, " ")
        .trim();

      if (!name) {
        return {
          content: [{ type: "text" as const, text: "Empty name, skipped." }],
          details: {},
        };
      }

      pi.setSessionName(name);
      return {
        content: [{ type: "text" as const, text: `Session named: ${name}` }],
        details: {},
      };
    },
  });

  // Nudge agent to name session on first turn
  let nudged = false;
  pi.on("agent_start", (_event, ctx) => {
    if (nudged || pi.getSessionName()) return;
    nudged = true;

    ctx.systemPromptAppend(
      "IMPORTANT: After your first response, call the `name_session` tool with a 2-3 word topic name for this session."
    );
  });
}
