/**
 * System Prompt Override Extension
 *
 * Replaces pi's default system prompt with Claude Code-style format.
 *
 * Injects at before_agent_start:
 * 1. x-anthropic-billing-header (billing metadata)
 * 2. "You are Claude Code, Anthropic's official CLI for Claude."
 *
 * This completely overrides pi's generic harness message.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const CLAUDE_CODE_VERSION = "2.1.101.a50";
const CLAUDE_CODE_CCH = "dc237";

export default function (pi: ExtensionAPI) {
  // Replace system prompt before agent starts
  pi.on("before_agent_start", async (event) => {
    const customPrompt = `x-anthropic-billing-header: cc_version=${CLAUDE_CODE_VERSION}; cc_entrypoint=cli; cch=${CLAUDE_CODE_CCH};

You are Claude Code, Anthropic's official CLI for Claude.`;

    return {
      systemPrompt: customPrompt,
    };
  });

  console.log("[System Prompt Override] Extension loaded - using Claude Code format");
}
