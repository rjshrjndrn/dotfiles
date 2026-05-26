/**
 * Auto Session Name Extension
 *
 * After first agent_end on a fresh session, makes a lightweight LLM call
 * to generate a short descriptive session name (~60 chars) from the first
 * user message. Fire-and-forget — doesn't block the user.
 *
 * Skips if user already set name via /name or pi.setSessionName().
 * Based on pi-mono issue #2090 design (not yet shipped in v0.67.2).
 */

import { completeSimple } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const SYSTEM_PROMPT =
  "Generate a short name (under 72 characters) for a coding session that starts with this message. Output only the name, nothing else. No quotes, no prefix.";

// Matches pi's skill block format: <skill name="..." location="...">...content...</skill>
const SKILL_BLOCK_RE = /^<skill name="([^"]+)" location="[^"]+">\n[\s\S]*?\n<\/skill>(?:\n\n([\s\S]+))?$/;

export default function (pi: ExtensionAPI) {
  let eligible = false;

  // Fresh sessions are eligible for auto-naming
  pi.on("session_start", (event) => {
    eligible = event.reason === "startup" || event.reason === "new";

    // If resuming and already has a name, not eligible
    if (pi.getSessionName()) {
      eligible = false;
    }
  });

  // After first successful agent response, generate name
  pi.on("agent_end", async (_event, ctx) => {
    if (!eligible) return;
    eligible = false; // Only once

    // Skip if name already set (by user or another extension)
    if (pi.getSessionName()) return;

    // Get first user message from branch, skipping slash-command instructions
    const branch = ctx.sessionManager.getBranch();
    let firstUserText = "";
    for (const entry of branch) {
      if (
        entry.type === "message" &&
        entry.message?.role === "user"
      ) {
        let text = "";
        const content = entry.message.content;
        if (typeof content === "string") {
          text = content;
        } else if (Array.isArray(content)) {
          for (const part of content) {
            if (part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part) {
              text += (part as any).text + " ";
            }
          }
        }
        text = text.trim();

        // If message contains a skill block, extract the user's actual text
        const skillMatch = text.match(SKILL_BLOCK_RE);
        if (skillMatch) {
          const userPart = skillMatch[2]?.trim();
          if (userPart) {
            // Use the user's text after the skill block
            text = userPart;
          } else {
            // Skill invoked with no user text — use skill name as fallback context
            text = skillMatch[1];
          }
        }

        firstUserText = text;
        break;
      }
    }

    firstUserText = firstUserText.trim();
    if (!firstUserText) return;

    // Truncate to ~500 chars for the naming call
    const truncated = firstUserText.slice(0, 500);

    try {
      const model = ctx.model;
      if (!model) return;

      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
      if (!auth?.ok || !auth.apiKey) return;

      const response = await completeSimple(
        model,
        {
          systemPrompt: SYSTEM_PROMPT,
          messages: [
            {
              role: "user" as const,
              content: [{ type: "text" as const, text: truncated }],
              timestamp: Date.now(),
            },
          ],
        },
        {
          apiKey: auth.apiKey,
          headers: auth.headers,
          reasoning: "none",
        },
      );

      const name = response.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("")
        .trim()
        .slice(0, 72);

      if (name && !pi.getSessionName()) {
        pi.setSessionName(name);
      }
    } catch (err) {
      // Fire-and-forget — silently fail
      console.error("[auto-session-name]", err);
    }
  });
}
