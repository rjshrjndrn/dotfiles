import { describe, it, expect } from "vitest";
import { alignEntryIds } from "../acm-lib/context-mapping.ts";

// Branch entries: full history. Non-message entries interleaved.
function entry(id: string, role: string, content: any = "x") {
  return { id, type: "message", message: { role, content } };
}
const custom = (id: string) => ({ id, type: "custom", message: null });

describe("alignEntryIds — no slide", () => {
  it("aligns messages to branch message-entries by position", () => {
    const branch = [
      entry("e1", "user"),
      entry("e2", "assistant"),
      entry("e3", "toolResult"),
    ];
    // event.messages: SDK refs (different objects), same order/count
    const messages = [
      { role: "user", content: "x" },
      { role: "assistant", content: "y" },
      { role: "toolResult", content: "z" },
    ];
    expect(alignEntryIds(branch, messages, null)).toEqual(["e1", "e2", "e3"]);
  });

  it("skips non-message branch entries when aligning", () => {
    const branch = [
      custom("c0"),
      entry("e1", "user"),
      custom("c1"),
      entry("e2", "assistant"),
    ];
    const messages = [
      { role: "user", content: "x" },
      { role: "assistant", content: "y" },
    ];
    expect(alignEntryIds(branch, messages, null)).toEqual(["e1", "e2"]);
  });

  it("pushes null when messages exceed branch message-entries (guard)", () => {
    const branch = [entry("e1", "user")];
    const messages = [
      { role: "user", content: "x" },
      { role: "assistant", content: "unexpected" },
    ];
    expect(alignEntryIds(branch, messages, null)).toEqual(["e1", null]);
  });
});

describe("alignEntryIds — slide active", () => {
  it("maps messages[0] summary to null, rest to branch from cutoff", () => {
    const branch = [
      entry("e1", "user"),      // before cutoff (slid away)
      entry("e2", "assistant"), // before cutoff
      entry("e3", "user"),      // cutoff
      entry("e4", "assistant"),
      entry("e5", "toolResult"),
    ];
    // After slide: [summary, e3.msg, e4.msg, e5.msg]
    const messages = [
      { role: "user", content: [{ type: "text", text: "<summary>\n...\n</summary>" }] },
      { role: "user", content: "x" },
      { role: "assistant", content: "y" },
      { role: "toolResult", content: "z" },
    ];
    const slide = { cutoffEntryId: "e3", summary: "..." };
    expect(alignEntryIds(branch, messages, slide)).toEqual([null, "e3", "e4", "e5"]);
  });

  it("counts non-message entries before cutoff correctly", () => {
    const branch = [
      entry("e1", "user"),
      custom("c1"),            // non-message before cutoff
      entry("e2", "assistant"), // cutoff
      entry("e3", "toolResult"),
    ];
    const messages = [
      { role: "user", content: [{ type: "text", text: "<summary></summary>" }] },
      { role: "assistant", content: "y" },
      { role: "toolResult", content: "z" },
    ];
    const slide = { cutoffEntryId: "e2", summary: "s" };
    expect(alignEntryIds(branch, messages, slide)).toEqual([null, "e2", "e3"]);
  });

  it("falls back to no-slide alignment if cutoff not found in branch", () => {
    const branch = [entry("e1", "user"), entry("e2", "assistant")];
    const messages = [
      { role: "user", content: "x" },
      { role: "assistant", content: "y" },
    ];
    const slide = { cutoffEntryId: "GONE", summary: "s" };
    expect(alignEntryIds(branch, messages, slide)).toEqual(["e1", "e2"]);
  });
});
