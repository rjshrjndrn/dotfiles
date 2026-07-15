import { describe, it, expect } from "vitest";
import { buildEntryMap } from "./entry-map";

const branch = [
  { id: "abc12def-1234-5678", type: "message", message: { role: "user", content: "check the acm.ts file" } },
  { id: "def45678-abcd-9999", type: "message", message: { role: "assistant", content: [{ type: "text", text: "Found the bug in auth middleware. Token expiry check uses wrong operator." }] } },
  { id: "ghi78901-0000-1111", type: "message", message: { role: "user", content: "pin doesn't work" } },
  { id: "jkl00000-2222-3333", type: "tool_result", message: null },
  { id: "mno11111-4444-5555", type: "message", message: { role: "user", content: [{ type: "text", text: "hello from array content" }] } },
];

describe("buildEntryMap", () => {
  it("returns rows with short ID, role, and preview", () => {
    const rows = buildEntryMap(branch);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveProperty("id");
    expect(rows[0]).toHaveProperty("role");
    expect(rows[0]).toHaveProperty("preview");
  });

  it("uses first 8 chars as short ID", () => {
    const rows = buildEntryMap(branch);
    expect(rows[0].id).toBe("abc12def");
  });

  it("truncates preview to max length", () => {
    const rows = buildEntryMap(branch);
    rows.forEach((r) => {
      expect(r.preview.length).toBeLessThanOrEqual(60);
    });
  });

  it("extracts string content", () => {
    const rows = buildEntryMap(branch);
    expect(rows[0].preview).toBe("check the acm.ts file");
  });

  it("extracts array content (text blocks)", () => {
    const rows = buildEntryMap(branch);
    const assistantRow = rows.find((r) => r.role === "assistant");
    expect(assistantRow?.preview).toContain("Found the bug");
  });

  it("extracts text from content array with type:text", () => {
    const rows = buildEntryMap(branch);
    const lastUser = rows.filter((r) => r.role === "user").pop();
    expect(lastUser?.preview).toBe("hello from array content");
  });

  it("skips non-message entries", () => {
    const rows = buildEntryMap(branch);
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain("jkl00000");
  });

  it("handles empty branch", () => {
    expect(buildEntryMap([])).toEqual([]);
  });
});
