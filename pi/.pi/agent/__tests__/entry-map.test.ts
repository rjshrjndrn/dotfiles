import { describe, it, expect } from "vitest";
import { buildEntryMap } from "../acm-lib/entry-map.ts";

// Messages as SDK provides them: only role/content/timestamp survive.
const msg1 = { role: "user", content: "check the acm.ts file", timestamp: 1000 };
const msg2 = { role: "assistant", content: [{ type: "text", text: "Found the bug in auth middleware." }], timestamp: 2000 };
const msg3 = { role: "user", content: "pin doesn't work", timestamp: 3000 };
const msg4 = { role: "user", content: [{ type: "text", text: "hello from array content" }], timestamp: 4000 };
const msg5 = { role: "assistant", content: "this was slid away too", timestamp: 5000 };

// tsToEntryId built from branch: message.timestamp -> entry.id
const tsToEntryId = new Map<number, string>([
  [1000, "abc12def-1234-5678"],
  [2000, "def45678-abcd-9999"],
  [3000, "ghi78901-0000-1111"],
  [4000, "mno11111-4444-5555"],
  [5000, "pqr22222-6666-7777"],
]);

// Context messages = only what LLM sees (msg1, msg2, msg5 slid away)
const contextMessages = [msg3, msg4];

describe("buildEntryMap", () => {
  it("returns rows with short ID, role, and preview", () => {
    const rows = buildEntryMap(contextMessages, tsToEntryId);
    expect(rows.length).toBe(2);
    expect(rows[0]).toHaveProperty("id");
    expect(rows[0]).toHaveProperty("role");
    expect(rows[0]).toHaveProperty("preview");
  });

  it("uses first 8 chars as short ID", () => {
    const rows = buildEntryMap(contextMessages, tsToEntryId);
    expect(rows[0].id).toBe("ghi78901");
  });

  it("only shows context messages, excludes slid-away ones", () => {
    const rows = buildEntryMap(contextMessages, tsToEntryId);
    const ids = rows.map(r => r.id);
    expect(ids).toContain("ghi78901");
    expect(ids).toContain("mno11111");
    expect(ids).not.toContain("abc12def");
    expect(ids).not.toContain("def45678");
    expect(ids).not.toContain("pqr22222");
  });

  it("truncates preview to max length", () => {
    const rows = buildEntryMap(contextMessages, tsToEntryId);
    rows.forEach((r) => {
      expect(r.preview.length).toBeLessThanOrEqual(60);
    });
  });

  it("extracts string content", () => {
    const rows = buildEntryMap(contextMessages, tsToEntryId);
    expect(rows[0].preview).toBe("pin doesn't work");
  });

  it("extracts text from content array with type:text", () => {
    const rows = buildEntryMap(contextMessages, tsToEntryId);
    expect(rows[1].preview).toBe("hello from array content");
  });

  it("skips messages whose timestamp has no entry ID mapping", () => {
    const unknownMsg = { role: "user", content: "unknown", timestamp: 99999 };
    const rows = buildEntryMap([...contextMessages, unknownMsg], tsToEntryId);
    expect(rows).toHaveLength(2); // unknownMsg skipped
  });

  it("resolves regardless of object ref (spread clone still matches by timestamp)", () => {
    // Simulate SDK rebuilding the message object — new ref, same timestamp
    const clone = { ...msg3 };
    expect(clone).not.toBe(msg3);
    const rows = buildEntryMap([clone], tsToEntryId);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("ghi78901");
  });

  it("handles empty messages", () => {
    expect(buildEntryMap([], tsToEntryId)).toEqual([]);
  });
});
