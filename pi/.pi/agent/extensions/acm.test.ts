import { describe, it, expect, vi } from "vitest";

// Mock external deps that acm.ts imports but tests don't need
vi.mock("@earendil-works/pi-ai", () => ({ complete: vi.fn() }));
vi.mock("@earendil-works/pi-coding-agent", () => ({
  convertToLlm: vi.fn(),
  estimateTokens: vi.fn(() => 0),
  serializeConversation: vi.fn(),
}));
vi.mock("@earendil-works/pi-agent-core", () => ({}));
vi.mock("@sinclair/typebox", () => ({
  Type: {
    Object: vi.fn(() => ({})),
    String: vi.fn(() => ({})),
    Number: vi.fn(() => ({})),
    Optional: vi.fn((x: any) => x),
    Array: vi.fn(() => ({})),
    Union: vi.fn(() => ({})),
    Literal: vi.fn(() => ({})),
  },
}));

import {
  extractKeywords,
  getBranchMessages,
  getTextPreview,
  extractEntryContent,
  compactMessage,
  findHybridCutoff,
  rehydrateStatePure,
  STOP_WORDS,
} from "./acm.ts";

// ── extractKeywords ──────────────────────────────────────────────────

describe("extractKeywords", () => {
  it("extracts words ≥4 chars, skips stop words", () => {
    const result = extractKeywords("this is a test function that reads files");
    expect(result).toBe("test, function, reads, files");
  });

  it("deduplicates case-insensitively", () => {
    const result = extractKeywords("Config config CONFIG setup");
    expect(result).toBe("Config, setup");
  });

  it("respects max limit", () => {
    const result = extractKeywords("alpha bravo charlie delta echo foxtrot", 3);
    expect(result).toBe("alpha, bravo, charlie");
  });

  it("returns empty for short/stop-only text", () => {
    expect(extractKeywords("the a an")).toBe("");
    expect(extractKeywords("")).toBe("");
  });

  it("preserves file paths and special chars", () => {
    const result = extractKeywords("reading /src/index.ts and ./config.json");
    expect(result).toContain("/src/index.ts");
    expect(result).toContain("./config.json");
  });

  it("stop words set contains expected words", () => {
    expect(STOP_WORDS.has("this")).toBe(true);
    expect(STOP_WORDS.has("would")).toBe(true);
    expect(STOP_WORDS.has("function")).toBe(false);
  });
});

// ── getBranchMessages ────────────────────────────────────────────────

describe("getBranchMessages", () => {
  it("extracts messages from branch entries", () => {
    const branch = [
      { type: "message", message: { role: "user", content: "hi" } },
      { type: "custom", data: {} },
      { type: "message", message: { role: "assistant", content: "hello" } },
      { type: "message", message: null },
    ];
    const msgs = getBranchMessages(branch);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("user");
    expect(msgs[1].role).toBe("assistant");
  });

  it("returns empty for empty branch", () => {
    expect(getBranchMessages([])).toEqual([]);
  });
});

// ── getTextPreview ───────────────────────────────────────────────────

describe("getTextPreview", () => {
  it("extracts first text block", () => {
    const msg = { content: [{ type: "text", text: "hello world" }] };
    expect(getTextPreview(msg)).toBe("hello world");
  });

  it("returns [image] for image blocks", () => {
    const msg = { content: [{ type: "image", data: "..." }] };
    expect(getTextPreview(msg)).toBe("[image]");
  });

  it("truncates to maxLen", () => {
    const msg = { content: [{ type: "text", text: "a".repeat(1000) }] };
    expect(getTextPreview(msg, 50)).toHaveLength(50);
  });

  it("returns empty for non-array content", () => {
    expect(getTextPreview({ content: "string" })).toBe("");
    expect(getTextPreview({})).toBe("");
  });
});

// ── extractEntryContent ──────────────────────────────────────────────

describe("extractEntryContent", () => {
  it("handles string content", () => {
    expect(extractEntryContent({ message: { content: "raw text" } })).toBe("raw text");
  });

  it("handles array content with text blocks", () => {
    const entry = { message: { content: [
      { type: "text", text: "line1" },
      { type: "text", text: "line2" },
    ] } };
    expect(extractEntryContent(entry)).toBe("line1\nline2");
  });

  it("handles image blocks", () => {
    const entry = { message: { content: [{ type: "image" }] } };
    expect(extractEntryContent(entry)).toBe("[image]");
  });

  it("falls back to JSON for unknown structure", () => {
    const entry = { foo: "bar" };
    expect(extractEntryContent(entry)).toBe(JSON.stringify(entry));
  });
});

// ── compactMessage ───────────────────────────────────────────────────

describe("compactMessage", () => {
  const longText = "x".repeat(500);

  it("returns null for small messages", () => {
    const msg = { content: [{ type: "text", text: "short" }] };
    expect(compactMessage(msg, "e1")).toBeNull();
  });

  it("returns null for non-array content", () => {
    expect(compactMessage({ content: "string" }, "e1")).toBeNull();
  });

  it("compacts large text-only message", () => {
    const msg = { content: [{ type: "text", text: longText + " " + longText + " extra_keyword" }] };
    const result = compactMessage(msg, "entry-42");
    expect(result).not.toBeNull();
    expect(result!.content).toHaveLength(1);
    expect(result!.content[0].text).toMatch(/\[compacted:.*\| id: entry-42\]/);
    expect(result!.saved).toBeGreaterThan(0);
  });

  it("compacts thinking blocks", () => {
    const msg = { content: [{ type: "thinking", thinking: longText + longText }] };
    const result = compactMessage(msg, "e2");
    expect(result).not.toBeNull();
    expect(result!.content).toHaveLength(1);
    expect(result!.content[0].text).toMatch(/\[compacted:/);
  });

  it("preserves tool call blocks", () => {
    const msg = { content: [
      { type: "text", text: longText + longText },
      { type: "toolCall", id: "tc1", name: "read", arguments: {} },
      { type: "thinking", thinking: "deep thoughts" },
    ] };
    const result = compactMessage(msg, "e3");
    expect(result).not.toBeNull();
    const types = result!.content.map((b: any) => b.type);
    expect(types).toContain("toolCall");
    expect(types).toContain("text");
    expect(types.filter((t: string) => t === "text")).toHaveLength(1);
  });
});

// ── findHybridCutoff ─────────────────────────────────────────────────

describe("findHybridCutoff", () => {
  const now = Date.now();
  const hour = 60 * 60 * 1000;

  function mkEntry(type: string, role?: string, ageMs = 0) {
    return {
      type,
      message: role ? { role } : undefined,
      timestamp: now - ageMs,
    };
  }

  it("returns 0 for short sessions (<10)", () => {
    const branch = Array.from({ length: 5 }, () => mkEntry("message", "user"));
    expect(findHybridCutoff(branch)).toBe(0);
  });

  it("returns 0 when no valid cut points", () => {
    const branch = Array.from({ length: 15 }, () => mkEntry("message"));
    expect(findHybridCutoff(branch)).toBe(0);
  });

  it("finds cutoff for old entries", () => {
    const branch = [
      ...Array.from({ length: 10 }, () => mkEntry("message", "user", hour)),
      ...Array.from({ length: 10 }, () => mkEntry("message", "user", 0)),
    ];
    const cutoff = findHybridCutoff(branch);
    expect(cutoff).toBeGreaterThan(0);
    expect(cutoff).toBeLessThan(branch.length);
  });

  it("keeps at least 10 recent entries", () => {
    const branch = Array.from({ length: 30 }, (_, i) =>
      mkEntry("message", "user", (30 - i) * 5 * 60 * 1000),
    );
    const cutoff = findHybridCutoff(branch);
    expect(branch.length - cutoff).toBeGreaterThanOrEqual(10);
  });

  it("snaps to valid cut point", () => {
    const branch = [
      mkEntry("message", "user", hour),
      mkEntry("message", "assistant", hour),
      ...Array.from({ length: 5 }, () => ({ type: "message", message: { role: "toolResult" }, timestamp: now - hour })),
      mkEntry("message", "user", hour),
      ...Array.from({ length: 12 }, () => mkEntry("message", "user", 0)),
    ];
    const cutoff = findHybridCutoff(branch);
    const entry = branch[cutoff];
    if (entry.type === "message" && entry.message) {
      expect(["user", "assistant"]).toContain(entry.message.role);
    }
  });
});

// ── rehydrateStatePure ───────────────────────────────────────────────

describe("rehydrateStatePure", () => {
  it("returns empty state for no entries", () => {
    const state = rehydrateStatePure([]);
    expect(state.clearSet.size).toBe(0);
    expect(state.pinnedSet.size).toBe(0);
    expect(state.totalTokensSaved).toBe(0);
  });

  it("restores clear state", () => {
    const entries = [{
      type: "custom",
      customType: "acm-clear-state",
      data: {
        clearedToolCallIds: ["tc1", "tc2"],
        toolCallIdToEntryId: { tc1: "e1", tc2: "e2" },
        totalTokensSaved: 5000,
        compactedEntryIds: ["e3"],
      },
    }];
    const state = rehydrateStatePure(entries);
    expect(state.clearSet.size).toBe(2);
    expect(state.clearSet.has("tc1")).toBe(true);
    expect(state.toolCallIdToEntryId.get("tc1")).toBe("e1");
    expect(state.totalTokensSaved).toBe(5000);
    expect(state.compactSet.has("e3")).toBe(true);
  });

  it("restores recall index", () => {
    const entries = [{
      type: "custom",
      customType: "acm-recall-index",
      data: {
        entries: [{ toolCallId: "tc1", toolName: "read", keyTerms: "file.ts", filePaths: ["/a.ts"] }],
      },
    }];
    const state = rehydrateStatePure(entries);
    expect(state.recallIndex.size).toBe(1);
    expect(state.recallIndex.get("tc1")?.toolName).toBe("read");
  });

  it("handles pin/unpin sequence", () => {
    const entries = [
      { type: "custom", customType: "acm-pin", data: { entryId: "e1", action: "pin" } },
      { type: "custom", customType: "acm-pin", data: { entryId: "e2", action: "pin" } },
      { type: "custom", customType: "acm-pin", data: { entryId: "e1", action: "unpin" } },
    ];
    const state = rehydrateStatePure(entries);
    expect(state.pinnedSet.size).toBe(1);
    expect(state.pinnedSet.has("e2")).toBe(true);
    expect(state.pinnedSet.has("e1")).toBe(false);
  });

  it("uses last clear state (overwrites previous)", () => {
    const entries = [
      { type: "custom", customType: "acm-clear-state", data: { clearedToolCallIds: ["old"], toolCallIdToEntryId: {}, totalTokensSaved: 100 } },
      { type: "custom", customType: "acm-clear-state", data: { clearedToolCallIds: ["new1", "new2"], toolCallIdToEntryId: {}, totalTokensSaved: 500 } },
    ];
    const state = rehydrateStatePure(entries);
    expect(state.clearSet.size).toBe(2);
    expect(state.clearSet.has("old")).toBe(false);
    expect(state.totalTokensSaved).toBe(500);
  });

  it("ignores non-custom entries", () => {
    const entries = [
      { type: "message", customType: "acm-clear-state", data: { clearedToolCallIds: ["tc1"] } },
    ];
    const state = rehydrateStatePure(entries);
    expect(state.clearSet.size).toBe(0);
  });
});
