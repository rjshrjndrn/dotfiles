/**
 * Integration test: project memory wiring through pi extension hooks.
 *
 * Tests the glue code that will live in acm.ts:
 * - session_start → init ProjectGraph + register session
 * - tool_result → feed to session graph (existing)
 * - turn_end → DecisionGate → ProjectGraph
 * - session_shutdown → flush buffer + close
 *
 * Uses a ProjectMemoryBridge class that encapsulates the wiring logic,
 * testable without the full pi runtime.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ProjectMemoryBridge,
  type TurnEndEvent,
  type SessionStartEvent,
} from "../acm-lib/project-memory-bridge.ts";

describe("ProjectMemoryBridge", () => {
  let tmpDir: string;
  let bridge: ProjectMemoryBridge;
  const gitRoot = "/fake/project";

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "pm-bridge-"));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("session lifecycle", () => {
    it("initializes on session_start with git root", async () => {
      bridge = new ProjectMemoryBridge({
        dbDir: tmpDir,
        logFile: join(tmpDir, "bridge.log"),
      });

      await bridge.onSessionStart({
        sessionId: "test-sess-1",
        cwd: "/fake/project/src",
        gitRoot,
      });

      expect(bridge.isReady()).toBe(true);
    });

    it("registers session in project graph", async () => {
      const sessions = await bridge.getSessions();
      expect(sessions.some((s) => s.id === "test-sess-1")).toBe(true);
    });

    it("shuts down cleanly", async () => {
      await bridge.onSessionShutdown();
      expect(bridge.isReady()).toBe(false);
    });
  });

  describe("turn_end processing", () => {
    beforeAll(async () => {
      bridge = new ProjectMemoryBridge({
        dbDir: tmpDir,
        logFile: join(tmpDir, "bridge.log"),
      });
      await bridge.onSessionStart({
        sessionId: "test-sess-2",
        cwd: "/fake/project",
        gitRoot,
      });
    });

    afterAll(async () => {
      await bridge.onSessionShutdown();
    });

    it("promotes edit turn to project graph", async () => {
      await bridge.onTurnEnd({
        turnIndex: 1,
        message: "Fixed the token expiry check: changed < to <=",
        toolResults: [
          { toolName: "edit", toolCallId: "tc-1", input: { path: "src/auth.ts" }, isError: false },
        ],
      });

      const events = await bridge.queryByFile("src/auth.ts");
      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe("fix");
      expect(events[0].summary).toContain("token expiry");
    });

    it("skips ls exploration", async () => {
      const before = await bridge.getStats();
      await bridge.onTurnEnd({
        turnIndex: 2,
        message: "Checking directory",
        toolResults: [
          { toolName: "bash", toolCallId: "tc-2", input: { command: "ls -la src/" }, isError: false },
        ],
      });
      const after = await bridge.getStats();
      expect(after.events).toBe(before.events); // no new events
    });

    it("buffers read, promotes when same file edited", async () => {
      // Read
      await bridge.onTurnEnd({
        turnIndex: 3,
        message: "Reading the database module",
        toolResults: [
          { toolName: "read", toolCallId: "tc-3", input: { path: "src/db.ts" }, isError: false },
        ],
      });

      const afterRead = await bridge.getStats();
      const readEvents = await bridge.queryByFile("src/db.ts");
      expect(readEvents).toHaveLength(0); // buffered, not in graph yet

      // Edit same file → promotes both
      await bridge.onTurnEnd({
        turnIndex: 4,
        message: "Increased connection pool to 20",
        toolResults: [
          { toolName: "edit", toolCallId: "tc-4", input: { path: "src/db.ts" }, isError: false },
        ],
      });

      const dbEvents = await bridge.queryByFile("src/db.ts");
      expect(dbEvents).toHaveLength(2); // read (promoted) + edit
      expect(dbEvents.some((e) => e.eventType === "investigation")).toBe(true);
      expect(dbEvents.some((e) => e.eventType === "fix")).toBe(true);
    });

    it("promotes errors immediately", async () => {
      await bridge.onTurnEnd({
        turnIndex: 5,
        message: "Build failed: missing dependency lodash",
        toolResults: [
          { toolName: "bash", toolCallId: "tc-5", input: { command: "npm run build" }, isError: true },
        ],
      });

      const errors = await bridge.queryByKeyword("lodash");
      expect(errors).toHaveLength(1);
      expect(errors[0].eventType).toBe("error");
    });

    it("captures multi-file edits as organic relationships", async () => {
      await bridge.onTurnEnd({
        turnIndex: 6,
        message: "Refactoring middleware to use new auth pattern",
        toolResults: [
          { toolName: "edit", toolCallId: "tc-6a", input: { path: "src/auth.ts" }, isError: false },
          { toolName: "edit", toolCallId: "tc-6b", input: { path: "src/middleware.ts" }, isError: false },
        ],
      });

      const related = await bridge.queryByFile("src/middleware.ts");
      expect(related.some((e) => e.files.includes("src/auth.ts"))).toBe(true);
    });

    it("promotes git commit", async () => {
      await bridge.onTurnEnd({
        turnIndex: 7,
        message: "Committed the refactor",
        toolResults: [
          {
            toolName: "bash",
            toolCallId: "tc-7",
            input: { command: "git commit -m 'feat: refactor'" },
            isError: false,
          },
        ],
      });

      const stats = await bridge.getStats();
      expect(stats.events).toBeGreaterThanOrEqual(6);
    });
  });

  describe("cross-session visibility", () => {
    it("new session sees previous session data", async () => {
      // Previous tests wrote data as test-sess-2
      // Open new bridge (simulating new session)
      const bridge2 = new ProjectMemoryBridge({
        dbDir: tmpDir,
        logFile: join(tmpDir, "bridge2.log"),
      });
      await bridge2.onSessionStart({
        sessionId: "test-sess-3",
        cwd: "/fake/project",
        gitRoot,
      });

      // Can see session 2's data
      const authEvents = await bridge2.queryByFile("src/auth.ts");
      expect(authEvents.length).toBeGreaterThanOrEqual(1);

      const precheck = await bridge2.precheckFile("src/auth.ts");
      expect(precheck.sessions).toContain("test-sess-2");

      // Keyword search across sessions
      const results = await bridge2.queryByKeyword("token expiry");
      expect(results.length).toBeGreaterThanOrEqual(1);

      await bridge2.onSessionShutdown();
    });
  });

  describe("session start briefing", () => {
    it("generates a brief summary for session start", async () => {
      const bridge3 = new ProjectMemoryBridge({
        dbDir: tmpDir,
        logFile: join(tmpDir, "bridge3.log"),
      });
      await bridge3.onSessionStart({
        sessionId: "test-sess-4",
        cwd: "/fake/project",
        gitRoot,
      });

      const briefing = await bridge3.getSessionBriefing();
      expect(briefing).toBeDefined();
      expect(briefing.hotFiles.length).toBeGreaterThan(0);
      expect(briefing.recentSessions.length).toBeGreaterThan(0);
      expect(briefing.recentErrors.length).toBeGreaterThanOrEqual(0);

      await bridge3.onSessionShutdown();
    });
  });

  describe("no git root — graceful degradation", () => {
    it("operates without project graph when no git root", async () => {
      const bridge4 = new ProjectMemoryBridge({
        dbDir: tmpDir,
        logFile: join(tmpDir, "bridge4.log"),
      });
      await bridge4.onSessionStart({
        sessionId: "no-git-sess",
        cwd: "/tmp/random",
        gitRoot: null,
      });

      // Should be in degraded mode — no project graph
      expect(bridge4.isReady()).toBe(false);

      // turn_end should not throw
      await bridge4.onTurnEnd({
        turnIndex: 1,
        message: "editing something",
        toolResults: [
          { toolName: "edit", toolCallId: "tc-1", input: { path: "test.ts" }, isError: false },
        ],
      });

      await bridge4.onSessionShutdown();
    });
  });
});
