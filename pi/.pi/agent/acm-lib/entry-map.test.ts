import { describe, it, expect } from "vitest";
import { buildEntryMap } from "./entry-map";

// Branch entries (full session history) — superset
const msg1 = { role: "user", content: "check the acm.ts file" };
const msg2 = { role: "assistant", content: [{ type: "text", text: "Found the bug in auth middleware. Token expiry check uses wrong operator." }] };
const msg3 = { role: "user", content: "pin doesn't work" };
const msg4 = { role: "user", content: [{ type: "text", text: "hello from array content" }] };
const msg5 = { role: "assistant", content: "this was slid away too" };

// msgEntryId built from branch (maps ALL branch message refs → entry IDs)
const msgEntryId = new Map<any, string>([
  [msg1, "abc12def-1234-5678"],
  [msg2, "def45678-abcd-9999"],
  [msg3, "ghi78901-0000-1111"],
  [msg4, "mno11111-4444-5555"],
  [msg5, "pqr22222-6666-7777"],
]);

// Context messages = only what LLM sees (msg1, msg2, msg5 slid away)
const contextMessages = [msg3, msg4];

describe("buildEntryMap", () => {
  it("returns rows with short ID, role, and preview", () => {
    const rows = buildEntryMap(contextMessages, msgEntryId);
    expect(rows.length).toBe(2);
    expect(rows[0]).toHaveProperty("id");
    expect(rows[0]).toHaveProperty("role");
    expect(rows[0]).toHaveProperty("preview");
  });

  it("uses first 8 chars as short ID", () => {
    const rows = buildEntryMap(contextMessages, msgEntryId);
    expect(rows[0].id).toBe("ghi78901");
  });

  it("only shows context messages, excludes slid-away ones", () => {
    const rows = buildEntryMap(contextMessages, msgEntryId);
    const ids = rows.map(r => r.id);
    // msg3 and msg4 are in context
    expect(ids).toContain("ghi78901");
    expect(ids).toContain("mno11111");
    // msg1, msg2, msg5 slid away — must NOT appear
    expect(ids).not.toContain("abc12def");
    expect(ids).not.toContain("def45678");
    expect(ids).not.toContain("pqr22222");
  });

  it("truncates preview to max length", () => {
    const rows = buildEntryMap(contextMessages, msgEntryId);
    rows.forEach((r) => {
      expect(r.preview.length).toBeLessThanOrEqual(60);
    });
  });

  it("extracts string content", () => {
    const rows = buildEntryMap(contextMessages, msgEntryId);
    expect(rows[0].preview).toBe("pin doesn't work");
  });

  it("extracts text from content array with type:text", () => {
    const rows = buildEntryMap(contextMessages, msgEntryId);
    expect(rows[1].preview).toBe("hello from array content");
  });

  it("skips messages without entry ID mapping", () => {
    const unknownMsg = { role: "user", content: "unknown" };
    const rows = buildEntryMap([...contextMessages, unknownMsg], msgEntryId);
    expect(rows).toHaveLength(2); // unknownMsg skipped, only msg3+msg4
  });

  it("handles empty messages", () => {
    expect(buildEntryMap([], msgEntryId)).toEqual([]);
  });
});
