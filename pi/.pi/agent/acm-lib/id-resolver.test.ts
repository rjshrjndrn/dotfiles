import { describe, it, expect } from "vitest";
import { resolveId } from "./id-resolver";

const branch = [
  { id: "abc12def", type: "message", message: { role: "user", content: "hello" } },
  { id: "abc99xyz", type: "message", message: { role: "assistant", content: "hi" } },
  { id: "def45678", type: "message", message: { role: "user", content: "bye" } },
  { id: "def45000", type: "message", message: { role: "user", content: "later" } },
];

describe("resolveId", () => {
  it("resolves exact match", () => {
    const result = resolveId("abc12def", branch);
    expect(result).toEqual({ ok: true, entry: branch[0] });
  });

  it("resolves unique prefix", () => {
    const result = resolveId("abc1", branch);
    expect(result).toEqual({ ok: true, entry: branch[0] });
  });

  it("resolves unique prefix for different entry", () => {
    const result = resolveId("abc9", branch);
    expect(result).toEqual({ ok: true, entry: branch[1] });
  });

  it("returns error when prefix is ambiguous", () => {
    const result = resolveId("abc", branch);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("ambiguous");
      expect(result.matches).toHaveLength(2);
    }
  });

  it("returns error when not found", () => {
    const result = resolveId("zzz", branch);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("not found");
    }
  });

  it("returns error on empty prefix", () => {
    const result = resolveId("", branch);
    expect(result.ok).toBe(false);
  });

  it("prefers exact match over prefix when ambiguous", () => {
    // "def45678" is exact match even though "def45" matches two entries
    const result = resolveId("def45678", branch);
    expect(result).toEqual({ ok: true, entry: branch[2] });
  });

  it("handles empty branch", () => {
    const result = resolveId("abc", []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("not found");
    }
  });
});
