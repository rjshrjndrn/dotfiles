import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from "vitest";

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

import registerExtension, {
  extractKeywords,
  extractToolCallPaths,
  FILE_PATH_PARAMS,
  MAX_EVICTED_PATHS,
  getBranchMessages,
  getTextPreview,
  extractEntryContent,
  compactMessage,
  findHybridCutoff,
  rehydrateStatePure,
  STOP_WORDS,
  FAULT_PIN_TTL,
  _resetState,
  localToolSet,
  discoverLocalTools,
  isExternalTool,
  loadAcmConfig,
  acmConfig,
  getCacheDir,
  writeCacheFile,
  extractToolResultText,
  buildCachedStub,
  getCacheStats,
} from "../extensions/acm.ts";

import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

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

// ── extractToolCallPaths ──────────────────────────────────────────────

describe("extractToolCallPaths", () => {
  it("extracts common file path params", () => {
    expect(extractToolCallPaths({ path: "/src/a.ts" })).toEqual(["/src/a.ts"]);
    expect(extractToolCallPaths({ file: "b.ts" })).toEqual(["b.ts"]);
    expect(extractToolCallPaths({ file_path: "c.ts" })).toEqual(["c.ts"]);
    expect(extractToolCallPaths({ filePath: "d.ts" })).toEqual(["d.ts"]);
    expect(extractToolCallPaths({ filename: "e.ts" })).toEqual(["e.ts"]);
    expect(extractToolCallPaths({ file_name: "f.ts" })).toEqual(["f.ts"]);
  });

  it("extracts multiple paths from one args object", () => {
    const paths = extractToolCallPaths({ path: "/a.ts", file: "/b.ts" });
    expect(paths).toContain("/a.ts");
    expect(paths).toContain("/b.ts");
    expect(paths).toHaveLength(2);
  });

  it("ignores non-string and empty values", () => {
    expect(extractToolCallPaths({ path: 42 })).toEqual([]);
    expect(extractToolCallPaths({ path: "" })).toEqual([]);
    expect(extractToolCallPaths({ path: null })).toEqual([]);
  });

  it("handles null/undefined/non-object args", () => {
    expect(extractToolCallPaths(null as any)).toEqual([]);
    expect(extractToolCallPaths(undefined as any)).toEqual([]);
    expect(extractToolCallPaths("string" as any)).toEqual([]);
  });

  it("ignores unknown param names", () => {
    expect(extractToolCallPaths({ command: "ls -la", query: "search" })).toEqual([]);
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

  it("returns 0 for short sessions with defaults (no old entries)", () => {
    // 5 recent user messages, all within 30min default window
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

  it("time-only: slides even with few user messages", () => {
    // 2 user messages + 50 tool calls, all old except last 5 entries
    const branch = [
      mkEntry("message", "user", hour),
      ...Array.from({ length: 45 }, () => mkEntry("message", "assistant", hour)),
      mkEntry("message", "user", 2 * 60 * 1000), // 2 min ago
      ...Array.from({ length: 4 }, () => mkEntry("message", "assistant", 60 * 1000)),
    ];
    // keepMinutes=5 → should slide old stuff even though only 2 user messages
    const cutoff = findHybridCutoff(branch, { keepMinutes: 5 });
    expect(cutoff).toBeGreaterThan(0); // Old bug: returned 0 because <10 user messages
  });

  it("respects keepMessages override (counts user messages)", () => {
    // 20 entries: user, assistant, user, assistant, ...
    // = 10 user messages total
    const branch = Array.from({ length: 20 }, (_, i) =>
      mkEntry("message", i % 2 === 0 ? "user" : "assistant", 0),
    );
    // keepMessages=5 → keep last 5 user msgs
    const cut5 = findHybridCutoff(branch, { keepMessages: 5 });
    const keptUsers = branch.slice(cut5).filter((e: any) => e.message?.role === "user").length;
    expect(keptUsers).toBe(5);

    // keepMessages=3 → keep last 3 user msgs
    const cut3 = findHybridCutoff(branch, { keepMessages: 3 });
    const keptUsers3 = branch.slice(cut3).filter((e: any) => e.message?.role === "user").length;
    expect(keptUsers3).toBe(3);

    // keepMessages=10 → keep all 10 user msgs → cutoff at 0
    const cutAll = findHybridCutoff(branch, { keepMessages: 10 });
    expect(cutAll).toBe(0);
  });

  it("respects keepMinutes override", () => {
    const branch = Array.from({ length: 20 }, (_, i) =>
      mkEntry("message", "user", (20 - i) * 5 * 60 * 1000),
    );
    const cut10 = findHybridCutoff(branch, { keepMinutes: 10 });
    const cut120 = findHybridCutoff(branch, { keepMinutes: 120 });
    expect(cut10).toBeGreaterThanOrEqual(cut120);
  });

  it("union semantics: keeps if in EITHER window (Math.min)", () => {
    // 30 user messages, each 2 min apart. Total span = 58 min.
    // Entry 0 = 58 min ago, Entry 29 = 0 min ago.
    const branch = Array.from({ length: 30 }, (_, i) =>
      mkEntry("message", "user", (29 - i) * 2 * 60 * 1000),
    );
    // keepMinutes=10 → timeCutoff keeps last ~5 entries
    // keepMessages=20 → msgCutoff keeps last 20 entries
    // Union (Math.min) → should keep 20 (the more conservative of the two)
    const cutoff = findHybridCutoff(branch, { keepMinutes: 10, keepMessages: 20 });
    const kept = branch.length - cutoff;
    expect(kept).toBeGreaterThanOrEqual(20); // union keeps the larger window
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

  it("restores lastAutoClearUserCount from clear state", () => {
    const entries = [{
      type: "custom",
      customType: "acm-clear-state",
      data: {
        clearedToolCallIds: [],
        toolCallIdToEntryId: {},
        totalTokensSaved: 0,
        compactedEntryIds: [],
        lastAutoClearUserCount: 42,
      },
    }];
    const state = rehydrateStatePure(entries);
    expect(state.lastAutoClearUserCount).toBe(42);
  });

  it("defaults lastAutoClearUserCount to 0 when missing", () => {
    const entries = [{
      type: "custom",
      customType: "acm-clear-state",
      data: { clearedToolCallIds: [], toolCallIdToEntryId: {}, totalTokensSaved: 0 },
    }];
    const state = rehydrateStatePure(entries);
    expect(state.lastAutoClearUserCount).toBe(0);
  });

  it("restores fault-pin TTL from pin events", () => {
    const entries = [
      { type: "custom", customType: "acm-pin", data: { entryId: "e1", action: "pin", isFault: true, pinnedAtTurn: 10 } },
      { type: "custom", customType: "acm-pin", data: { entryId: "e2", action: "pin" } }, // manual pin, no isFault
    ];
    const state = rehydrateStatePure(entries);
    expect(state.pinnedSet.size).toBe(2);
    expect(state.faultPinTurns.size).toBe(1);
    expect(state.faultPinTurns.get("e1")).toBe(10);
    expect(state.faultPinTurns.has("e2")).toBe(false);
  });

  it("clears fault-pin TTL on unpin", () => {
    const entries = [
      { type: "custom", customType: "acm-pin", data: { entryId: "e1", action: "pin", isFault: true, pinnedAtTurn: 5 } },
      { type: "custom", customType: "acm-pin", data: { entryId: "e1", action: "unpin" } },
    ];
    const state = rehydrateStatePure(entries);
    expect(state.pinnedSet.size).toBe(0);
    expect(state.faultPinTurns.size).toBe(0);
  });
});

// ── Context handler: turn-boundary pruning & fault-driven pinning ────

describe("context handler — eviction strategy", () => {
  const handlers: Record<string, Function> = {};
  let mockAppendEntry: ReturnType<typeof vi.fn>;
  let notifications: string[];

  function buildBranch(messages: any[]): any[] {
    return messages.map((m, i) => ({
      type: "message",
      id: `e${i}`,
      message: m,
    }));
  }

  function createCtx(branch: any[]) {
    return {
      sessionManager: {
        getBranch: () => branch,
        getEntries: () => [],
        getSessionDir: () => join(tmpdir(), `acm-test-ctx-${Date.now()}`),
      },
      ui: {
        notify: (msg: string) => notifications.push(msg),
        setStatus: vi.fn(),
      },
      getContextUsage: () => ({ percent: 50 }),
    };
  }

  /** Build a conversation with N padding turns after initial content. */
  function paddingTurns(n: number): any[] {
    const msgs: any[] = [];
    for (let i = 0; i < n; i++) {
      msgs.push({ role: "user", content: `padding turn ${i}` });
      msgs.push({ role: "assistant", content: [{ type: "text", text: "ok" }] });
    }
    return msgs;
  }

  // Register extension once — handlers persist, state resets via _resetState
  beforeAll(() => {
    mockAppendEntry = vi.fn();
    const mockPi = {
      on: vi.fn((event: string, handler: Function) => {
        handlers[event] = handler;
      }),
      appendEntry: mockAppendEntry,
      registerTool: vi.fn(),
    };
    registerExtension(mockPi);
  });

  beforeEach(() => {
    _resetState();
    discoverLocalTools([
      { name: "Read" }, { name: "Write" }, { name: "Edit" }, { name: "Bash" },
      { name: "web_fetch" }, { name: "mcp" },
    ], { cacheTools: ["web_fetch"] });
    notifications = [];
    mockAppendEntry.mockClear();
  });

  it("auto-clears old tool results at turn boundary", () => {
    // Turn 1: file read (will be old with 5 user messages)
    // Turns 2-5: padding to push turn 1 beyond recentThreshold (3 turns)
    const messages = [
      { role: "user", content: "read file A" },
      { role: "assistant", content: [
        { type: "toolCall", id: "tc1", name: "Read", arguments: { path: "/src/a.ts" } },
      ] },
      { role: "toolResult", toolCallId: "tc1", toolName: "Read",
        content: [{ type: "text", text: "file A content" }] },
      ...paddingTurns(4),
    ];
    const branch = buildBranch(messages);

    const result = handlers["context"]({ messages }, createCtx(branch));

    // tc1 should be auto-cleared (beyond recentThreshold)
    expect(notifications.some(n => n.includes("Auto-cleared"))).toBe(true);

    // Stubs apply in SAME turn (auto-clear runs before message mapping)
    const tc1Msg = result.messages.find((m: any) => m.toolCallId === "tc1");
    expect(tc1Msg.content[0].text).toMatch(/\[cleared:/);
  });

  it("does NOT auto-clear mid-turn (same user count)", () => {
    const messages = [
      { role: "user", content: "read file A" },
      { role: "assistant", content: [
        { type: "toolCall", id: "tc1", name: "Read", arguments: { path: "/src/a.ts" } },
      ] },
      { role: "toolResult", toolCallId: "tc1", toolName: "Read",
        content: [{ type: "text", text: "file A content" }] },
      ...paddingTurns(4),
    ];
    const branch = buildBranch(messages);
    const ctx = createCtx(branch);

    // First call: turn boundary fires (0 → 5 user messages)
    handlers["context"]({ messages }, ctx);
    expect(notifications.some(n => n.includes("Auto-cleared"))).toBe(true);

    // LLM continues working (adds tool calls, no new user message)
    const midTurnMessages = [
      ...messages,
      { role: "assistant", content: [
        { type: "toolCall", id: "tc-mid", name: "Read", arguments: { path: "/src/b.ts" } },
      ] },
      { role: "toolResult", toolCallId: "tc-mid", toolName: "Read",
        content: [{ type: "text", text: "file B content" }] },
    ];
    const midBranch = buildBranch(midTurnMessages);

    notifications = [];
    handlers["context"]({ messages: midTurnMessages }, createCtx(midBranch));

    // No auto-clear: user count unchanged
    expect(notifications.filter(n => n.includes("Auto-cleared"))).toHaveLength(0);
  });

  it("fault-pins when LLM re-reads an evicted file", () => {
    // Turn 1: read /src/a.ts (will be evicted)
    // Turns 2-5: padding
    const messages = [
      { role: "user", content: "read file A" },
      { role: "assistant", content: [
        { type: "toolCall", id: "tc1", name: "Read", arguments: { path: "/src/a.ts" } },
      ] },
      { role: "toolResult", toolCallId: "tc1", toolName: "Read",
        content: [{ type: "text", text: "file A content" }] },
      ...paddingTurns(4),
    ];
    const branch = buildBranch(messages);

    // Evict tc1
    handlers["context"]({ messages }, createCtx(branch));
    expect(notifications.some(n => n.includes("Auto-cleared"))).toBe(true);

    // Turn 6: re-read /src/a.ts with new toolCallId
    const messages2 = [
      ...messages,
      { role: "user", content: "read A again" },
      { role: "assistant", content: [
        { type: "toolCall", id: "tc-reread", name: "Read", arguments: { path: "/src/a.ts" } },
      ] },
      { role: "toolResult", toolCallId: "tc-reread", toolName: "Read",
        content: [{ type: "text", text: "file A content again" }] },
    ];
    const branch2 = buildBranch(messages2);

    notifications = [];
    handlers["context"]({ messages: messages2 }, createCtx(branch2));

    // Fault-pin should fire for /src/a.ts
    expect(notifications.some(n =>
      n.includes("Fault-pin") && n.includes("/src/a.ts")
    )).toBe(true);
  });

  it("fault-pin expires after FAULT_PIN_TTL turns", () => {
    // Setup: evict + re-read to create fault-pin
    const baseMessages = [
      { role: "user", content: "read file A" },
      { role: "assistant", content: [
        { type: "toolCall", id: "tc1", name: "Read", arguments: { path: "/src/a.ts" } },
      ] },
      { role: "toolResult", toolCallId: "tc1", toolName: "Read",
        content: [{ type: "text", text: "file A content" }] },
      ...paddingTurns(4),
    ];

    // Call 1: evict tc1
    handlers["context"]({ messages: baseMessages }, createCtx(buildBranch(baseMessages)));

    // Call 2: re-read → fault-pin
    const rereadMessages = [
      ...baseMessages,
      { role: "user", content: "read A again" },
      { role: "assistant", content: [
        { type: "toolCall", id: "tc-reread", name: "Read", arguments: { path: "/src/a.ts" } },
      ] },
      { role: "toolResult", toolCallId: "tc-reread", toolName: "Read",
        content: [{ type: "text", text: "file A content again" }] },
    ];
    handlers["context"]({ messages: rereadMessages }, createCtx(buildBranch(rereadMessages)));
    expect(notifications.some(n => n.includes("Fault-pin") && n.includes("/src/a.ts"))).toBe(true);

    // Now advance FAULT_PIN_TTL more user turns
    let currentMessages = [...rereadMessages];
    for (let i = 0; i < FAULT_PIN_TTL; i++) {
      currentMessages = [
        ...currentMessages,
        { role: "user", content: `advance turn ${i}` },
        { role: "assistant", content: [{ type: "text", text: "ok" }] },
      ];
    }

    notifications = [];
    handlers["context"]({ messages: currentMessages }, createCtx(buildBranch(currentMessages)));

    // Fault-pin should have expired
    expect(notifications.some(n => n.includes("Fault-pin expired"))).toBe(true);
  });

  it("manual pins survive beyond FAULT_PIN_TTL", () => {
    // Setup: create a tool result and manually pin it via session_start rehydration
    const pinEntries = [
      { type: "custom", customType: "acm-pin", data: { entryId: "e2", action: "pin" } },
    ];
    const sessionStartCtx = {
      sessionManager: { getEntries: () => pinEntries, getSessionDir: () => join(tmpdir(), "acm-test") },
      ui: { notify: vi.fn(), setStatus: vi.fn() },
    };
    handlers["session_start"]({}, sessionStartCtx);

    // Build conversation: e2 is a tool result in turn 1 (old, would be cleared)
    const messages = [
      { role: "user", content: "turn 1" },
      { role: "assistant", content: [
        { type: "toolCall", id: "tc-pinned", name: "Read", arguments: { path: "/pinned.ts" } },
      ] },
      { role: "toolResult", toolCallId: "tc-pinned", toolName: "Read",
        content: [{ type: "text", text: "pinned content" }] },
      // Enough padding to push turn 1 beyond threshold
      ...paddingTurns(4 + FAULT_PIN_TTL),
    ];
    const branch = buildBranch(messages);

    handlers["context"]({ messages }, createCtx(branch));

    // e2 (tc-pinned) should NOT be cleared — it's manually pinned
    expect(notifications.some(n => n.includes("Fault-pin expired"))).toBe(false);
    // The auto-clear should have skipped it
    const result = handlers["context"]({ messages }, createCtx(branch));
    const pinnedMsg = result.messages.find((m: any) => m.toolCallId === "tc-pinned");
    // Content should NOT be a stub — pin protects it
    expect(pinnedMsg.content[0].text).not.toMatch(/\[cleared:/);
  });

  it("fault-pin persisted with isFault flag on appendEntry", () => {
    // Setup: evict + re-read to create fault-pin
    const messages = [
      { role: "user", content: "read file A" },
      { role: "assistant", content: [
        { type: "toolCall", id: "tc1", name: "Read", arguments: { path: "/src/a.ts" } },
      ] },
      { role: "toolResult", toolCallId: "tc1", toolName: "Read",
        content: [{ type: "text", text: "file A content" }] },
      ...paddingTurns(4),
    ];

    // Evict
    handlers["context"]({ messages }, createCtx(buildBranch(messages)));

    // Re-read → fault-pin
    const messages2 = [
      ...messages,
      { role: "user", content: "read A again" },
      { role: "assistant", content: [
        { type: "toolCall", id: "tc-reread", name: "Read", arguments: { path: "/src/a.ts" } },
      ] },
      { role: "toolResult", toolCallId: "tc-reread", toolName: "Read",
        content: [{ type: "text", text: "file A content again" }] },
    ];
    handlers["context"]({ messages: messages2 }, createCtx(buildBranch(messages2)));

    // Check appendEntry was called with isFault + pinnedAtTurn
    const pinCalls = mockAppendEntry.mock.calls.filter(
      ([type, data]: any) => type === "acm-pin" && data?.action === "pin" && data?.isFault === true
    );
    expect(pinCalls.length).toBeGreaterThanOrEqual(1);
    const pinData = pinCalls[0][1];
    expect(pinData.isFault).toBe(true);
    expect(typeof pinData.pinnedAtTurn).toBe("number");
  });

  it("fault-pin survives rehydration and expires correctly", () => {
    // Simulate restart: rehydrate with fault-pin at turn 3
    const pinEntries = [
      { type: "custom", customType: "acm-pin", data: { entryId: "e2", action: "pin", isFault: true, pinnedAtTurn: 3 } },
      { type: "custom", customType: "acm-clear-state", data: {
        clearedToolCallIds: ["tc-old"],
        toolCallIdToEntryId: { "tc-old": "e0" },
        totalTokensSaved: 100,
        compactedEntryIds: [],
        lastAutoClearUserCount: 5,
      } },
    ];
    const sessionStartCtx = {
      sessionManager: { getEntries: () => pinEntries, getSessionDir: () => join(tmpdir(), "acm-test") },
      ui: { notify: vi.fn(), setStatus: vi.fn() },
    };
    handlers["session_start"]({}, sessionStartCtx);

    // Build conversation with enough turns to expire the fault-pin
    // pinnedAtTurn=3, FAULT_PIN_TTL=5, so need currentUserCount >= 8
    const messages = [
      { role: "user", content: "turn 1" },
      { role: "assistant", content: [
        { type: "toolCall", id: "tc-pinned", name: "Read", arguments: { path: "/fp.ts" } },
      ] },
      { role: "toolResult", toolCallId: "tc-pinned", toolName: "Read",
        content: [{ type: "text", text: "fault pinned content" }] },
      // Need 7 more user turns to reach count 8 (>= 3 + 5)
      ...paddingTurns(7),
    ];
    const branch = buildBranch(messages);

    notifications = [];
    handlers["context"]({ messages }, createCtx(branch));

    // Fault-pin from rehydration should have expired
    expect(notifications.some(n => n.includes("Fault-pin expired"))).toBe(true);
  });

  it("lastAutoClearUserCount rehydration prevents mass eviction on restart", () => {
    // Rehydrate with lastAutoClearUserCount = 5
    const entries = [
      { type: "custom", customType: "acm-clear-state", data: {
        clearedToolCallIds: [],
        toolCallIdToEntryId: {},
        totalTokensSaved: 0,
        compactedEntryIds: [],
        lastAutoClearUserCount: 5,
      } },
    ];
    const sessionStartCtx = {
      sessionManager: { getEntries: () => entries, getSessionDir: () => join(tmpdir(), "acm-test") },
      ui: { notify: vi.fn(), setStatus: vi.fn() },
    };
    handlers["session_start"]({}, sessionStartCtx);

    // Send context with exactly 5 user messages (same count — no turn boundary)
    const messages = [
      { role: "user", content: "old turn 1" },
      { role: "assistant", content: [
        { type: "toolCall", id: "tc1", name: "Read", arguments: { path: "/a.ts" } },
      ] },
      { role: "toolResult", toolCallId: "tc1", toolName: "Read",
        content: [{ type: "text", text: "content A" }] },
      ...paddingTurns(4), // 4 more user msgs = 5 total
    ];
    const branch = buildBranch(messages);

    notifications = [];
    handlers["context"]({ messages }, createCtx(branch));

    // Should NOT auto-clear: currentUserCount (5) === lastAutoClearUserCount (5)
    expect(notifications.filter(n => n.includes("Auto-cleared"))).toHaveLength(0);
  });

  it("detects fault via filePath param (not just path)", () => {
    // Turn 1: read via filePath param
    const messages = [
      { role: "user", content: "read file" },
      { role: "assistant", content: [
        { type: "toolCall", id: "tc1", name: "CustomRead", arguments: { filePath: "/src/x.ts" } },
      ] },
      { role: "toolResult", toolCallId: "tc1", toolName: "CustomRead",
        content: [{ type: "text", text: "file x content" }] },
      ...paddingTurns(4),
    ];

    // Evict
    handlers["context"]({ messages }, createCtx(buildBranch(messages)));

    // Re-read via filePath
    const messages2 = [
      ...messages,
      { role: "user", content: "read x again" },
      { role: "assistant", content: [
        { type: "toolCall", id: "tc-reread", name: "CustomRead", arguments: { filePath: "/src/x.ts" } },
      ] },
      { role: "toolResult", toolCallId: "tc-reread", toolName: "CustomRead",
        content: [{ type: "text", text: "file x content again" }] },
    ];

    notifications = [];
    handlers["context"]({ messages: messages2 }, createCtx(buildBranch(messages2)));

    // Fault-pin should fire for /src/x.ts (detected via filePath param)
    expect(notifications.some(n =>
      n.includes("Fault-pin") && n.includes("/src/x.ts")
    )).toBe(true);
  });
});

// ── External Tool Detection ──────────────────────────────────────────

describe("isExternalTool", () => {
  beforeEach(() => {
    // Simulate boot: discover local tools with config
    discoverLocalTools([
      { name: "Read" }, { name: "Write" }, { name: "Edit" }, { name: "Bash" },
      { name: "grep" }, { name: "find" }, { name: "ls" },
      { name: "gitnexus_query" }, { name: "gitnexus_context" },
      { name: "memory_search" }, { name: "memory_save" },
      { name: "acm_status" }, { name: "acm_recall" },
      { name: "spawn_agent" }, { name: "web_fetch" },
      { name: "mcp" },
    ], { cacheTools: ["web_fetch"] });
  });

  it("local tools discovered at boot are NOT external", () => {
    expect(isExternalTool("Read")).toBe(false);
    expect(isExternalTool("Write")).toBe(false);
    expect(isExternalTool("Bash")).toBe(false);
    expect(isExternalTool("gitnexus_query")).toBe(false);
    expect(isExternalTool("memory_search")).toBe(false);
  });

  it("web_fetch is external via cacheTools config", () => {
    expect(isExternalTool("web_fetch")).toBe(true);
  });

  it("MCP sub-tool calls are always external (API calls)", () => {
    expect(isExternalTool("mcp", { tool: "exa_web_search_exa", args: '{}' })).toBe(true);
    expect(isExternalTool("mcp", { tool: "yahoo_get_quote", args: '{}' })).toBe(true);
    expect(isExternalTool("mcp", { tool: "cc_query-docs", args: '{}' })).toBe(true);
  });

  it("MCP meta calls (no sub-tool) are NOT external", () => {
    expect(isExternalTool("mcp", { search: "query" })).toBe(false);
    expect(isExternalTool("mcp", { describe: "tool" })).toBe(false);
    expect(isExternalTool("mcp")).toBe(false);
  });

  it("unknown tools default to NOT caching", () => {
    expect(isExternalTool("some_random_tool")).toBe(false);
  });

  it("discoverLocalTools populates localToolSet", () => {
    expect(localToolSet.has("Read")).toBe(true);
    expect(localToolSet.has("mcp")).toBe(true);
    expect(localToolSet.has("nonexistent")).toBe(false);
  });

  it("config localTools forces unknown tools as local", () => {
    discoverLocalTools([], { localTools: ["my_custom_tool"] });
    expect(isExternalTool("my_custom_tool")).toBe(false);
  });

  it("config cacheTools forces registered tools as external", () => {
    discoverLocalTools(
      [{ name: "my_api" }],
      { cacheTools: ["my_api"] },
    );
    expect(isExternalTool("my_api")).toBe(true);
  });

  it("loadAcmConfig returns empty for missing file", () => {
    const config = loadAcmConfig("/nonexistent/path");
    expect(config).toEqual({});
  });

  it("loadAcmConfig reads valid config", () => {
    const testDir = join(tmpdir(), `acm-config-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "acm.json"), JSON.stringify({
      cacheTools: ["web_fetch", "custom_api"],
      localTools: ["my_tool"],
    }));
    const config = loadAcmConfig(testDir);
    expect(config.cacheTools).toEqual(["web_fetch", "custom_api"]);
    expect(config.localTools).toEqual(["my_tool"]);
    rmSync(testDir, { recursive: true, force: true });
  });
});

// ── extractToolResultText ────────────────────────────────────────────

describe("extractToolResultText", () => {
  it("extracts from string content", () => {
    expect(extractToolResultText({ content: "raw text" })).toBe("raw text");
  });

  it("extracts from array content with text blocks", () => {
    const msg = { content: [
      { type: "text", text: "line1" },
      { type: "text", text: "line2" },
    ] };
    expect(extractToolResultText(msg)).toBe("line1\nline2");
  });

  it("skips non-text blocks", () => {
    const msg = { content: [
      { type: "text", text: "hello" },
      { type: "image", data: "..." },
    ] };
    expect(extractToolResultText(msg)).toBe("hello");
  });

  it("falls back to JSON for unknown content", () => {
    const msg = { content: { custom: true } };
    expect(extractToolResultText(msg)).toBe('{"custom":true}');
  });
});

// ── File Caching ─────────────────────────────────────────────────────

describe("file caching", () => {
  const testDir = join(tmpdir(), `acm-test-${Date.now()}`);

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch {}
  });

  it("getCacheDir returns correct path", () => {
    expect(getCacheDir("/sessions/abc")).toBe("/sessions/abc/.acm/cache");
  });

  it("writeCacheFile creates file with content", () => {
    const path = writeCacheFile(testDir, "web_fetch", "tc_123", "Hello world");
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf-8")).toBe("Hello world");
    expect(path).toContain("web_fetch-tc_123");
    expect(path).toMatch(/\.md$/);
  });

  it("writeCacheFile uses .json extension for JSON content", () => {
    const path = writeCacheFile(testDir, "exa_web_search_exa", "tc_456", '{"results": []}');
    expect(path).toMatch(/\.json$/);
    expect(readFileSync(path, "utf-8")).toBe('{"results": []}');
  });

  it("writeCacheFile truncates at 100KB", () => {
    const bigContent = "x".repeat(200 * 1024);
    const path = writeCacheFile(testDir, "web_fetch", "tc_big", bigContent);
    const saved = readFileSync(path, "utf-8");
    expect(saved.length).toBeLessThan(bigContent.length);
    expect(saved).toContain("[...truncated at 100KB]");
  });

  it("writeCacheFile sanitizes toolCallId for filename", () => {
    const path = writeCacheFile(testDir, "web_fetch", "tc/with:special!chars", "test");
    expect(existsSync(path)).toBe(true);
    // Filename part should have no special chars (path separators OK in directory)
    const filename = path.split("/").pop()!;
    expect(filename).not.toMatch(/[/:!]/);
  });

  it("getCacheStats returns correct counts", () => {
    // Empty dir
    expect(getCacheStats(testDir)).toEqual({ files: 0, totalBytes: 0 });

    // Write some files
    writeCacheFile(testDir, "web_fetch", "tc1", "hello");
    writeCacheFile(testDir, "exa_search", "tc2", "world");

    const stats = getCacheStats(testDir);
    expect(stats.files).toBe(2);
    expect(stats.totalBytes).toBeGreaterThan(0);
  });

  it("buildCachedStub includes filepath and keywords", () => {
    const stub = buildCachedStub("web_fetch", "/cache/web_fetch-tc1.md", "InfiAgent paper file-centric");
    expect(stub).toContain("/cache/web_fetch-tc1.md");
    expect(stub).toContain("web_fetch");
    expect(stub).toMatch(/^\[cached:/);
  });
});

// ── Context handler: external tool caching ────────────────────────────

describe("context handler — external tool caching", () => {
  const handlers: Record<string, Function> = {};
  let mockAppendEntry: ReturnType<typeof vi.fn>;
  let notifications: string[];
  const testSessionDir = join(tmpdir(), `acm-cache-test-${Date.now()}`);

  function buildBranch(messages: any[]): any[] {
    return messages.map((m, i) => ({
      type: "message",
      id: `e${i}`,
      message: m,
    }));
  }

  function createCtx(branch: any[]) {
    return {
      sessionManager: {
        getBranch: () => branch,
        getEntries: () => [],
        getSessionDir: () => testSessionDir,
      },
      ui: {
        notify: (msg: string) => notifications.push(msg),
        setStatus: vi.fn(),
      },
      getContextUsage: () => ({ percent: 50 }),
    };
  }

  function paddingTurns(n: number): any[] {
    const msgs: any[] = [];
    for (let i = 0; i < n; i++) {
      msgs.push({ role: "user", content: `padding turn ${i}` });
      msgs.push({ role: "assistant", content: [{ type: "text", text: "ok" }] });
    }
    return msgs;
  }

  beforeAll(() => {
    mockAppendEntry = vi.fn();
    const mockPi = {
      on: vi.fn((event: string, handler: Function) => {
        handlers[event] = handler;
      }),
      appendEntry: mockAppendEntry,
      registerTool: vi.fn(),
    };
    registerExtension(mockPi);
  });

  beforeEach(() => {
    _resetState();
    discoverLocalTools([
      { name: "Read" }, { name: "Write" }, { name: "Edit" }, { name: "Bash" },
      { name: "web_fetch" }, { name: "mcp" },
      { name: "gitnexus_query" }, { name: "memory_search" },
    ], { cacheTools: ["web_fetch"] });
    notifications = [];
    mockAppendEntry.mockClear();
    try { rmSync(testSessionDir, { recursive: true, force: true }); } catch {}
  });

  afterAll(() => {
    try { rmSync(testSessionDir, { recursive: true, force: true }); } catch {}
  });

  it("caches external tool (web_fetch) at tool_result, never enters context", async () => {
    const ctx = createCtx([]);
    const result = await handlers["tool_result"]({
      toolName: "web_fetch",
      toolCallId: "tc-web",
      input: { url: "https://example.com" },
      content: [{ type: "text", text: "Example Domain\n" + "x".repeat(2100) }],
    }, ctx);

    // Should have cached to disk
    expect(notifications.some(n => n.includes("💾") && n.includes("web_fetch"))).toBe(true);
    const cacheStats = getCacheStats(testSessionDir);
    expect(cacheStats.files).toBe(1);

    // Result should be a stub, not the full content
    expect(result).toBeDefined();
    expect(result.content[0].text).toMatch(/^\[cached:/);
    // Preview includes first 1000 chars, but full content is on disk
    expect(result.content[0].text).toContain("---preview");
    expect(result.content[0].text).toContain("Example Domain");
  });

  it("does NOT cache local tool (Read) at tool_result", async () => {
    const ctx = createCtx([]);
    const result = await handlers["tool_result"]({
      toolName: "Read",
      toolCallId: "tc-read",
      input: { path: "/src/a.ts" },
      content: [{ type: "text", text: "file content here" }],
    }, ctx);

    // Should pass through — no caching, no modification
    expect(result).toBeUndefined();
    expect(notifications.some(n => n.includes("💾"))).toBe(false);
    const cacheStats = getCacheStats(testSessionDir);
    expect(cacheStats.files).toBe(0);
  });

  it("caches MCP sub-tool (exa) at tool_result", async () => {
    const ctx = createCtx([]);
    const result = await handlers["tool_result"]({
      toolName: "mcp",
      toolCallId: "tc-exa",
      input: { tool: "exa_web_search_exa", args: '{"query": "test"}' },
      content: [{ type: "text", text: '{"results": [{"title": "Test", "url": "https://test.com"}]}' + "x".repeat(2100) }],
    }, ctx);

    expect(notifications.some(n => n.includes("💾") && n.includes("mcp"))).toBe(true);
    expect(result).toBeDefined();
    expect(result.content[0].text).toMatch(/^\[cached:/);
    const cacheStats = getCacheStats(testSessionDir);
    expect(cacheStats.files).toBe(1);
  });

  it("skips caching for small external tool results (<2000 chars)", async () => {
    const ctx = createCtx([]);
    const result = await handlers["tool_result"]({
      toolName: "web_fetch",
      toolCallId: "tc-small",
      input: { url: "https://example.com" },
      content: [{ type: "text", text: "Short page content under 2000 chars" }],
    }, ctx);

    // Should pass through — no caching, no replacement
    expect(result).toBeUndefined();
    expect(getCacheStats(testSessionDir).files).toBe(0);
  });

  it("does NOT cache MCP meta calls (no sub-tool)", async () => {
    const ctx = createCtx([]);
    const result = await handlers["tool_result"]({
      toolName: "mcp",
      toolCallId: "tc-meta",
      input: { describe: "some_tool" },
      content: [{ type: "text", text: "tool description..." }],
    }, ctx);

    expect(result).toBeUndefined();
    expect(getCacheStats(testSessionDir).files).toBe(0);
  });
});
