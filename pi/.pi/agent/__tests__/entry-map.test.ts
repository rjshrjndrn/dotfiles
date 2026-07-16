import { describe, it, expect } from "vitest";
import { buildEntryMap } from "../acm-lib/entry-map.ts";

// Final LLM-visible messages + parallel entryIds (from alignEntryIds/prependPinned).
const messages = [
  { role: "user", content: "pin doesn't work" },
  { role: "assistant", content: [{ type: "text", text: "Found the bug in auth middleware." }] },
  { role: "toolResult", content: [{ type: "text", text: "[cleared: bash | 42 lines]" }] },
  { role: "user", content: [{ type: "text", text: "hello from array content" }] },
];
const entryIds: (string | null)[] = [
  "ghi78901-0000-1111",
  "def45678-abcd-9999",
  "c3bca4ee-2222-3333",
  "mno11111-4444-5555",
];

describe("buildEntryMap", () => {
  it("returns one row per message with short ID, role, preview", () => {
    const rows = buildEntryMap(messages, entryIds);
    expect(rows.length).toBe(4);
    expect(rows[0]).toHaveProperty("id");
    expect(rows[0]).toHaveProperty("role");
    expect(rows[0]).toHaveProperty("preview");
  });

  it("uses first 8 chars as short ID", () => {
    const rows = buildEntryMap(messages, entryIds);
    expect(rows[0].id).toBe("ghi78901");
    expect(rows[2].id).toBe("c3bca4ee");
  });

  it("shows null entry ID as em dash (non-pinnable, e.g. slide summary)", () => {
    const msgs = [{ role: "user", content: [{ type: "text", text: "<summary>...</summary>" }] }];
    const rows = buildEntryMap(msgs, [null]);
    expect(rows[0].id).toBe("—");
  });

  it("truncates preview to max length", () => {
    const rows = buildEntryMap(messages, entryIds);
    rows.forEach((r) => expect(r.preview.length).toBeLessThanOrEqual(60));
  });

  it("extracts string content", () => {
    const rows = buildEntryMap(messages, entryIds);
    expect(rows[0].preview).toBe("pin doesn't work");
  });

  it("extracts text from array content", () => {
    const rows = buildEntryMap(messages, entryIds);
    expect(rows[1].preview).toContain("Found the bug");
    expect(rows[3].preview).toBe("hello from array content");
  });

  it("shows processed content (cleared stub) as preview", () => {
    const rows = buildEntryMap(messages, entryIds);
    expect(rows[2].preview).toContain("[cleared: bash");
  });

  it("falls back to block-type list when no text block", () => {
    const msgs = [{ role: "assistant", content: [{ type: "toolCall", id: "t1" }] }];
    const rows = buildEntryMap(msgs, ["abc12def"]);
    expect(rows[0].preview).toBe("[toolCall]");
  });

  it("handles empty messages", () => {
    expect(buildEntryMap([], [])).toEqual([]);
  });
});
