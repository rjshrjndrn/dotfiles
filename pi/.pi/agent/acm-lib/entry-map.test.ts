import { describe, it, expect } from "vitest";
import { buildEntryMap } from "./entry-map";

// Simulate in-memory message objects (same refs as branch entries)
const msg1 = { role: "user", content: "check the acm.ts file" };
const msg2 = { role: "assistant", content: [{ type: "text", text: "Found the bug in auth middleware. Token expiry check uses wrong operator." }] };
const msg3 = { role: "user", content: "pin doesn't work" };
const msg4 = { role: "user", content: [{ type: "text", text: "hello from array content" }] };

// msgEntryId maps message object ref → entry ID
const msgEntryId = new Map<any, string>([
  [msg1, "abc12def-1234-5678"],
  [msg2, "def45678-abcd-9999"],
  [msg3, "ghi78901-0000-1111"],
  [msg4, "mno11111-4444-5555"],
]);

// Context messages = only what LLM sees (msg4 might be missing = slid away)
const contextMessages = [msg1, msg2, msg3, msg4];

describe("buildEntryMap", () => {
  it("returns rows with short ID, role, and preview", () => {
    const rows = buildEntryMap(contextMessages, msgEntryId);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveProperty("id");
    expect(rows[0]).toHaveProperty("role");
    expect(rows[0]).toHaveProperty("preview");
  });

  it("uses first 8 chars as short ID", () => {
    const rows = buildEntryMap(contextMessages, msgEntryId);
    expect(rows[0].id).toBe("abc12def");
  });

  it("truncates preview to max length", () => {
    const rows = buildEntryMap(contextMessages, msgEntryId);
    rows.forEach((r) => {
      expect(r.preview.length).toBeLessThanOrEqual(60);
    });
  });

  it("extracts string content", () => {
    const rows = buildEntryMap(contextMessages, msgEntryId);
    expect(rows[0].preview).toBe("check the acm.ts file");
  });

  it("extracts array content (text blocks)", () => {
    const rows = buildEntryMap(contextMessages, msgEntryId);
    const assistantRow = rows.find((r) => r.role === "assistant");
    expect(assistantRow?.preview).toContain("Found the bug");
  });

  it("extracts text from content array with type:text", () => {
    const rows = buildEntryMap(contextMessages, msgEntryId);
    const lastUser = rows.filter((r) => r.role === "user").pop();
    expect(lastUser?.preview).toBe("hello from array content");
  });

  it("skips messages without entry ID mapping", () => {
    const unknownMsg = { role: "user", content: "unknown" };
    const rows = buildEntryMap([...contextMessages, unknownMsg], msgEntryId);
    expect(rows).toHaveLength(4); // unknownMsg skipped
  });

  it("only shows context messages, not slid-away ones", () => {
    // Only msg1 and msg3 in context (msg2, msg4 slid away)
    const partial = [msg1, msg3];
    const rows = buildEntryMap(partial, msgEntryId);
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.id)).toEqual(["abc12def", "ghi78901"]);
  });

  it("handles empty messages", () => {
    expect(buildEntryMap([], msgEntryId)).toEqual([]);
  });
});
