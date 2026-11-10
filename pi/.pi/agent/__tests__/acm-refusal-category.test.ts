// Behavior: on an Anthropic refusal, ACM appends stop_details.category to the
// assistant errorMessage (TUI + session log), so refusals can be classified.
// pi drops the category; ACM recovers it from provider_stream_event.
import { describe, it, expect, vi, beforeAll } from "vitest";

vi.mock("@earendil-works/pi-coding-agent", () => ({ estimateTokens: vi.fn(() => 0) }));
vi.mock("@earendil-works/pi-agent-core", () => ({}));
vi.mock("@sinclair/typebox", () => ({
	Type: new Proxy({}, { get: () => vi.fn((x?: any) => x ?? {}) }),
}));

import registerExtension from "../extensions/acm.ts";

const handlers: Record<string, Function> = {};
beforeAll(() => {
	registerExtension({
		on: vi.fn((event: string, handler: Function) => { handlers[event] = handler; }),
		appendEntry: vi.fn(),
		registerTool: vi.fn(),
		registerCommand: vi.fn(),
	} as any);
});

const refused = (errorMessage?: string) => ({
	role: "assistant", content: [], stopReason: "error", rawStopReason: "refusal",
	...(errorMessage ? { errorMessage } : {}),
});

async function turn(streamEvents: any[], message: any) {
	await handlers["message_start"]?.({ message }, {});
	for (const data of streamEvents) await handlers["provider_stream_event"]({ provider: "anthropic", api: "anthropic-messages", model: "m", data }, {});
	return handlers["message_end"]({ message }, {});
}

const delta = (stop_details: any) => ({ type: "message_delta", delta: { stop_reason: "refusal", stop_details }, usage: { output_tokens: 0 } });

describe("acm refusal category", () => {
	it("appends stop_details.category to a refusal errorMessage", async () => {
		const out = await turn([delta({ type: "refusal", category: "reasoning_extraction", explanation: "blocked by ToS" })], refused("blocked by ToS"));
		expect(out?.message.errorMessage).toBe("blocked by ToS [refusal category: reasoning_extraction]");
		expect(out?.message.rawStopReason).toBe("refusal");
	});

	it("leaves refusals without a category unchanged", async () => {
		const out = await turn([delta(null)], refused("The model refused to complete the request"));
		expect(out).toBeUndefined();
	});

	it("does not leak a category into the next message", async () => {
		await turn([delta({ category: "cyber", explanation: "x" })], refused("x"));
		const out = await turn([], refused("y"));
		expect(out).toBeUndefined();
	});

	it("ignores non-refusal assistant messages", async () => {
		const msg = { role: "assistant", content: [{ type: "text", text: "ok" }], stopReason: "stop", rawStopReason: "end_turn" };
		const out = await turn([{ type: "message_delta", delta: { stop_reason: "end_turn" } }], msg);
		expect(out).toBeUndefined();
	});
});
