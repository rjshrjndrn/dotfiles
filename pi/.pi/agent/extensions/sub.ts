/**
 * /sub — Quick sub-agent delegation command.
 *
 * Usage: /sub create the proposal with this design
 *
 * Shows the user's prompt in history, then steers the LLM with hidden
 * instructions to spawn a sub-agent immediately.
 */

import type { ExtensionAPI } from "@anthropic-ai/claude-code";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("sub", {
		description: "Delegate task to a sub-agent",
		handler: async (args, ctx) => {
			const task = args.trim();
			if (!task) {
				ctx.ui.notify("Usage: /sub <task>", "warn");
				return;
			}

			// Visible user message — shows in history
			pi.sendUserMessage(`/sub ${task}`);

			// Hidden instructions — steered after user message, invisible in UI
			pi.sendMessage(
				{
					customType: "sub-agent-delegate",
					content: [
						`Spawn a sub-agent immediately for the task above. No planning, no confirmation.`,
						`Rules:`,
						`- Call spawn_agent right now. Do NOT ask for confirmation.`,
						`- agent_type: "explorer" for questions/research, "worker" for creating/building.`,
						`- Add brief context about current project/directory if relevant.`,
						`- After spawning, report agent ID and task in 1-3 lines max.`,
						`- Do NOT call wait_agent. Results arrive automatically.`,
						`- If a related agent already exists, use send_input instead.`,
					].join("\n"),
					display: false,
				},
				{
					deliverAs: "steer",
				},
			);
		},
	});
}
