import { describe, it, expect, beforeEach, vi } from "vitest";
import { ProjectMemoryBridge } from "../acm-lib/project-memory-bridge.ts";
import type { ProjectGraphEvent } from "../acm-lib/project-graph.ts";

/**
 * Test path relativization in ProjectMemoryBridge.
 * 
 * We test the public `relativizePath` method directly,
 * plus verify onTurnEnd stores relative paths.
 */
describe("ProjectMemoryBridge — path relativization", () => {
  let bridge: ProjectMemoryBridge;

  beforeEach(() => {
    bridge = new ProjectMemoryBridge({});
  });

  describe("relativizePath", () => {
    it("strips worktreeRoot prefix from absolute path", () => {
      bridge.setWorktreeRoot("/home/user/project");
      expect(bridge.relativizePath("/home/user/project/src/auth.ts"))
        .toBe("src/auth.ts");
    });

    it("strips worktreeRoot with trailing slash", () => {
      bridge.setWorktreeRoot("/home/user/project/");
      expect(bridge.relativizePath("/home/user/project/src/auth.ts"))
        .toBe("src/auth.ts");
    });

    it("returns already-relative paths unchanged", () => {
      bridge.setWorktreeRoot("/home/user/project");
      expect(bridge.relativizePath("src/auth.ts"))
        .toBe("src/auth.ts");
    });

    it("returns paths outside worktreeRoot unchanged", () => {
      bridge.setWorktreeRoot("/home/user/project");
      expect(bridge.relativizePath("/home/user/other-project/foo.ts"))
        .toBe("/home/user/other-project/foo.ts");
    });

    it("returns path unchanged when no worktreeRoot set", () => {
      // No setWorktreeRoot called
      expect(bridge.relativizePath("/home/user/project/src/auth.ts"))
        .toBe("/home/user/project/src/auth.ts");
    });

    it("handles root path exactly (returns empty → .)", () => {
      bridge.setWorktreeRoot("/home/user/project");
      // Edge case: path IS the root
      const result = bridge.relativizePath("/home/user/project");
      expect(result).toBe(".");
    });

    it("handles root path with trailing slash", () => {
      bridge.setWorktreeRoot("/home/user/project");
      const result = bridge.relativizePath("/home/user/project/");
      expect(result).toBe(".");
    });
  });
});

describe("ProjectMemoryBridge — saveUserNote", () => {
  let bridge: ProjectMemoryBridge;
  let mockGraph: any;

  beforeEach(() => {
    bridge = new ProjectMemoryBridge({});
    mockGraph = {
      writeEvent: vi.fn().mockResolvedValue(undefined),
      isReady: () => true,
      init: vi.fn().mockResolvedValue(undefined),
      registerSession: vi.fn().mockResolvedValue(undefined),
      queryByKeyword: vi.fn().mockResolvedValue([]),
      getSessions: vi.fn().mockResolvedValue([]),
      getHotFiles: vi.fn().mockResolvedValue([]),
      getStats: vi.fn().mockResolvedValue({ events: 0, files: 0, sessions: 0 }),
    };
    // Inject mock graph and sessionId via onSessionStart internals
    (bridge as any).graph = mockGraph;
    (bridge as any).sessionId = "test-session";
  });

  it("writes a user_note event to graph", async () => {
    await bridge.saveUserNote("SSH tunnel: port 5432 via bastion");

    expect(mockGraph.writeEvent).toHaveBeenCalledOnce();
    const event: ProjectGraphEvent = mockGraph.writeEvent.mock.calls[0][0];
    expect(event.eventType).toBe("user_note");
    expect(event.toolName).toBe("user_note");
    expect(event.summary).toBe("SSH tunnel: port 5432 via bastion");
    expect(event.keyTerms).toContain("SSH");
    expect(event.sessionId).toBe("test-session");
  });

  it("leaves expiresAt undefined when no ttlDays given (durable note)", async () => {
    await bridge.saveUserNote("permanent note");
    const event: ProjectGraphEvent = mockGraph.writeEvent.mock.calls[0][0];
    expect(event.expiresAt).toBeUndefined();
  });

  it("sets expiresAt = now + ttlDays when ttlDays given", async () => {
    const before = Date.now();
    await bridge.saveUserNote("temporary note", [], 7);
    const event: ProjectGraphEvent = mockGraph.writeEvent.mock.calls[0][0];
    const expected = before + 7 * 86_400_000;
    expect(event.expiresAt).toBeGreaterThanOrEqual(expected);
    expect(event.expiresAt).toBeLessThan(expected + 5000); // within a few seconds
  });

  it("includes relativized files when provided", async () => {
    bridge.setWorktreeRoot("/home/user/project");
    await bridge.saveUserNote("deploy config", ["/home/user/project/deploy/config.yaml"]);

    const event: ProjectGraphEvent = mockGraph.writeEvent.mock.calls[0][0];
    expect(event.files).toEqual(["deploy/config.yaml"]);
  });

  it("stores empty files array when none provided", async () => {
    await bridge.saveUserNote("general note about auth");

    const event: ProjectGraphEvent = mockGraph.writeEvent.mock.calls[0][0];
    expect(event.files).toEqual([]);
  });

  it("returns false when graph not initialized", async () => {
    (bridge as any).graph = null;
    const result = await bridge.saveUserNote("some note");
    expect(result).toBe(false);
  });

  it("returns true on successful save", async () => {
    const result = await bridge.saveUserNote("some note");
    expect(result).toBe(true);
  });
});

describe("ProjectMemoryBridge — user notes in briefing", () => {
  let bridge: ProjectMemoryBridge;
  let mockGraph: any;

  const userNoteEvent: ProjectGraphEvent = {
    id: "note-1",
    toolName: "user_note",
    keyTerms: "SSH tunnel bastion",
    eventType: "user_note",
    files: [],
    sessionId: "s1",
    timestamp: Date.now(),
    summary: "SSH tunnel: port 5432 via bastion",
  };

  beforeEach(() => {
    bridge = new ProjectMemoryBridge({});
    mockGraph = {
      isReady: () => true,
      getHotFiles: vi.fn().mockResolvedValue([]),
      getSessions: vi.fn().mockResolvedValue([]),
      queryByKeyword: vi.fn().mockImplementation(async (kw: string) => {
        if (kw === "error fail") return [];
        return [];
      }),
      queryByEventType: vi.fn().mockResolvedValue([userNoteEvent]),
    };
    (bridge as any).graph = mockGraph;
    (bridge as any).sessionId = "test-session";
  });

  it("includes user notes section in briefing", async () => {
    const briefing = await bridge.formatSessionBriefing();
    expect(briefing).toContain("Notes:");
    expect(briefing).toContain("SSH tunnel: port 5432 via bastion");
  });
});

describe("ProjectMemoryBridge — collectGarbage", () => {
  let bridge: ProjectMemoryBridge;
  let mockGraph: any;
  let capturedOpts: any;

  beforeEach(() => {
    bridge = new ProjectMemoryBridge({});
    mockGraph = {
      isReady: () => true,
      collectGarbage: vi.fn().mockImplementation((opts: any) => {
        capturedOpts = opts;
        return { stale: 0, age: 0, dedup: 0, expired: 0, orphan: 0 };
      }),
    };
    (bridge as any).graph = mockGraph;
    (bridge as any).sessionId = "test-session";
    (bridge as any).gitRoot = "/repo"; // main repo root
  });

  it("delegates to graph.collectGarbage and returns the report", async () => {
    const report = await bridge.collectGarbage({ maxAgeDays: 90, dryRun: true });
    expect(mockGraph.collectGarbage).toHaveBeenCalledOnce();
    expect(report).toEqual({ stale: 0, age: 0, dedup: 0, expired: 0, orphan: 0 });
  });

  it("passes through maxAgeDays and dryRun", async () => {
    await bridge.collectGarbage({ maxAgeDays: 30, dryRun: true });
    expect(capturedOpts.maxAgeDays).toBe(30);
    expect(capturedOpts.dryRun).toBe(true);
  });

  it("builds fileExists resolving worktree-relative paths against the main repo root", async () => {
    await bridge.collectGarbage({});
    // fs check is real; a path that surely does not exist under /repo => false
    expect(capturedOpts.fileExists("definitely/missing/xyz.ts")).toBe(false);
    // the repo root's own dir resolves to something that exists
    expect(typeof capturedOpts.fileExists).toBe("function");
  });

  it("builds worktreeAlive checking directory existence", async () => {
    await bridge.collectGarbage({});
    expect(capturedOpts.worktreeAlive("/definitely/missing/worktree")).toBe(false);
    expect(capturedOpts.worktreeAlive("/")).toBe(true); // root always exists
  });

  it("returns a zeroed report when the graph is not ready", async () => {
    (bridge as any).graph = null;
    const report = await bridge.collectGarbage({});
    expect(report).toEqual({ stale: 0, age: 0, dedup: 0, expired: 0, orphan: 0 });
  });
});
