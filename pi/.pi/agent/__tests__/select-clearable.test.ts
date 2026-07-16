import { describe, it, expect } from "vitest";
import { selectClearableToolResults } from "../acm-lib/helpers.ts";

// Branch entries as stored in the session tree: { type, id, message }.
function tr(id: string, toolCallId: string) {
  return { type: "message", id, message: { role: "toolResult", toolCallId, toolName: "bash", content: [{ type: "text", text: "x" }] } };
}

describe("selectClearableToolResults", () => {
  it("returns toolCallId of a plain old tool result", () => {
    const entries = [tr("e1", "tc1")];
    const ids = selectClearableToolResults(entries, { pinnedSet: new Set(), clearedSet: new Set(), protectedToolCallIds: new Set() });
    expect(ids).toEqual(["tc1"]);
  });

  it("skips already-cleared toolCallIds", () => {
    const entries = [tr("e1", "tc1"), tr("e2", "tc2")];
    const ids = selectClearableToolResults(entries, { pinnedSet: new Set(), clearedSet: new Set(["tc1"]), protectedToolCallIds: new Set() });
    expect(ids).toEqual(["tc2"]);
  });

  it("skips entries pinned by entry id", () => {
    const entries = [tr("e1", "tc1"), tr("e2", "tc2")];
    const ids = selectClearableToolResults(entries, { pinnedSet: new Set(["e1"]), clearedSet: new Set(), protectedToolCallIds: new Set() });
    expect(ids).toEqual(["tc2"]);
  });

  it("skips protected (recent) toolCallIds", () => {
    const entries = [tr("e1", "tc1"), tr("e2", "tc2")];
    const ids = selectClearableToolResults(entries, { pinnedSet: new Set(), clearedSet: new Set(), protectedToolCallIds: new Set(["tc2"]) });
    expect(ids).toEqual(["tc1"]);
  });

  it("ignores non-toolResult messages and entries without a toolCallId", () => {
    const entries = [
      { type: "message", id: "u1", message: { role: "user", content: "hi" } },
      { type: "message", id: "a1", message: { role: "assistant", content: [{ type: "text", text: "y" }] } },
      { type: "message", id: "e2", message: { role: "toolResult", toolName: "bash", content: [] } }, // no toolCallId
      { type: "compaction", id: "c1" },
      tr("e3", "tc3"),
    ];
    const ids = selectClearableToolResults(entries, { pinnedSet: new Set(), clearedSet: new Set(), protectedToolCallIds: new Set() });
    expect(ids).toEqual(["tc3"]);
  });

  it("returns empty for empty input", () => {
    expect(selectClearableToolResults([], { pinnedSet: new Set(), clearedSet: new Set(), protectedToolCallIds: new Set() })).toEqual([]);
  });
});
