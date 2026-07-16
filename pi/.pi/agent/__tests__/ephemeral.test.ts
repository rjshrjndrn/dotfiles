import { describe, it, expect } from "vitest";
import { collectEphemeralToolCallIds } from "../acm-lib/ephemeral.ts";

describe("collectEphemeralToolCallIds", () => {
  const ephemeral = new Set<string>(["acm_map"]);

  it("collects toolCallId of an ephemeral tool call (toolCall block)", () => {
    const messages = [
      { role: "assistant", content: [{ type: "toolCall", id: "tc-1", name: "acm_map" }] },
    ];
    expect(collectEphemeralToolCallIds(messages, ephemeral)).toEqual(["tc-1"]);
  });

  it("supports tool_use block shape and toolCallId field", () => {
    const messages = [
      { role: "assistant", content: [{ type: "tool_use", toolCallId: "tc-2", name: "acm_map" }] },
    ];
    expect(collectEphemeralToolCallIds(messages, ephemeral)).toEqual(["tc-2"]);
  });

  it("ignores non-ephemeral tool calls", () => {
    const messages = [
      { role: "assistant", content: [{ type: "toolCall", id: "tc-1", name: "bash" }] },
    ];
    expect(collectEphemeralToolCallIds(messages, ephemeral)).toEqual([]);
  });

  it("collects multiple across messages, in order", () => {
    const messages = [
      { role: "assistant", content: [{ type: "toolCall", id: "a", name: "acm_map" }] },
      { role: "assistant", content: [{ type: "toolCall", id: "b", name: "bash" }] },
      { role: "assistant", content: [{ type: "toolCall", id: "c", name: "acm_map" }] },
    ];
    expect(collectEphemeralToolCallIds(messages, ephemeral)).toEqual(["a", "c"]);
  });

  it("skips string content and blocks without id", () => {
    const messages = [
      { role: "assistant", content: "plain text" },
      { role: "assistant", content: [{ type: "toolCall", name: "acm_map" }] },
    ];
    expect(collectEphemeralToolCallIds(messages, ephemeral)).toEqual([]);
  });

  it("no-op with empty ephemeral set", () => {
    const messages = [
      { role: "assistant", content: [{ type: "toolCall", id: "tc-1", name: "acm_map" }] },
    ];
    expect(collectEphemeralToolCallIds(messages, new Set())).toEqual([]);
  });
});
