/**
 * Tests for surfacing project memory to pi — the "read" side.
 *
 * 1. Session briefing: formatted summary injected at session start
 * 2. File precheck: warning text before editing a file
 * 3. Project recall: keyword search across sessions for acm_recall
 *
 * Uses ProjectMemoryBridge with pre-seeded data.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProjectMemoryBridge } from "../acm-lib/project-memory-bridge.ts";

describe("Project memory surfacing", () => {
  let tmpDir: string;
  let bridge: ProjectMemoryBridge;
  const gitRoot = "/fake/project";

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "pm-surface-"));

    // Seed data: simulate two prior sessions
    const seeder = new ProjectMemoryBridge({ dbDir: tmpDir });
    await seeder.onSessionStart({ sessionId: "old-sess-1", cwd: gitRoot, gitRoot });

    // Session 1: auth refactor with an error
    await seeder.onTurnEnd({
      turnIndex: 1,
      message: "Reading auth module to understand token flow",
      toolResults: [
        { toolName: "read", toolCallId: "tc-1", input: { path: "src/auth.ts" }, isError: false },
      ],
    });
    await seeder.onTurnEnd({
      turnIndex: 2,
      message: "Fixed JWT token expiry: changed < to <= in isExpired check",
      toolResults: [
        { toolName: "edit", toolCallId: "tc-2", input: { path: "src/auth.ts" }, isError: false },
      ],
    });
    await seeder.onTurnEnd({
      turnIndex: 3,
      message: "Tests failing: auth mock not being reset between runs",
      toolResults: [
        { toolName: "bash", toolCallId: "tc-3", input: { command: "npm test" }, isError: true },
      ],
    });
    await seeder.onTurnEnd({
      turnIndex: 4,
      message: "Fixed mock reset in beforeEach, all tests pass now",
      toolResults: [
        { toolName: "edit", toolCallId: "tc-4", input: { path: "src/auth.test.ts" }, isError: false },
        { toolName: "edit", toolCallId: "tc-4b", input: { path: "src/auth.ts" }, isError: false },
      ],
    });
    await seeder.onSessionShutdown();

    // Session 2: database work
    const seeder2 = new ProjectMemoryBridge({ dbDir: tmpDir });
    await seeder2.onSessionStart({ sessionId: "old-sess-2", cwd: gitRoot, gitRoot });
    await seeder2.onTurnEnd({
      turnIndex: 1,
      message: "Increased connection pool from 5 to 20 for better throughput",
      toolResults: [
        { toolName: "edit", toolCallId: "tc-5", input: { path: "src/db.ts" }, isError: false },
      ],
    });
    await seeder2.onTurnEnd({
      turnIndex: 2,
      message: "Added retry logic for transient database errors",
      toolResults: [
        { toolName: "edit", toolCallId: "tc-6", input: { path: "src/db.ts" }, isError: false },
        { toolName: "edit", toolCallId: "tc-6b", input: { path: "src/middleware.ts" }, isError: false },
      ],
    });
    await seeder2.onSessionShutdown();

    // Now open as a "new session" that will surface the data
    bridge = new ProjectMemoryBridge({ dbDir: tmpDir });
    await bridge.onSessionStart({ sessionId: "current-sess", cwd: gitRoot, gitRoot });
  });

  afterAll(async () => {
    await bridge.onSessionShutdown();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── 1. Session start briefing ────────────────────────────────────

  describe("formatSessionBriefing", () => {
    it("returns formatted string with hot files", async () => {
      const text = await bridge.formatSessionBriefing();
      expect(text).toContain("src/auth.ts");
      expect(text).toContain("src/db.ts");
    });

    it("mentions prior session count", async () => {
      const text = await bridge.formatSessionBriefing();
      // Should reference that there were prior sessions
      expect(text).toMatch(/2.*session|session.*2/i);
    });

    it("surfaces recent errors", async () => {
      const text = await bridge.formatSessionBriefing();
      expect(text).toMatch(/mock.*reset|auth.*fail/i);
    });

    it("returns empty string when no project graph", async () => {
      const empty = new ProjectMemoryBridge({ dbDir: tmpDir });
      await empty.onSessionStart({ sessionId: "no-git", cwd: "/tmp", gitRoot: null });
      const text = await empty.formatSessionBriefing();
      expect(text).toBe("");
      await empty.onSessionShutdown();
    });
  });

  // ── 2. File precheck before edit ─────────────────────────────────

  describe("formatFilePrecheck", () => {
    it("returns warning for frequently edited file", async () => {
      const text = await bridge.formatFilePrecheck("src/auth.ts");
      expect(text).toContain("src/auth.ts");
      // Should mention prior edits or sessions
      expect(text).toMatch(/edit|session|prior|histor/i);
    });

    it("includes session IDs that touched the file", async () => {
      const text = await bridge.formatFilePrecheck("src/auth.ts");
      expect(text).toContain("old-sess-1");
    });

    it("includes key terms from prior edits", async () => {
      const text = await bridge.formatFilePrecheck("src/auth.ts");
      expect(text).toMatch(/jwt|token|expir/i);
    });

    it("shows error history for the file", async () => {
      const text = await bridge.formatFilePrecheck("src/auth.ts");
      expect(text).toMatch(/error|fail|mock/i);
    });

    it("returns empty for untouched file", async () => {
      const text = await bridge.formatFilePrecheck("src/never-seen.ts");
      expect(text).toBe("");
    });

    it("returns empty when no project graph", async () => {
      const empty = new ProjectMemoryBridge({ dbDir: tmpDir });
      await empty.onSessionStart({ sessionId: "no-git-2", cwd: "/tmp", gitRoot: null });
      const text = await empty.formatFilePrecheck("src/auth.ts");
      expect(text).toBe("");
      await empty.onSessionShutdown();
    });
  });

  // ── 3. Project recall for acm_recall ─────────────────────────────

  describe("searchProjectMemory", () => {
    it("finds events by keyword", async () => {
      const results = await bridge.searchProjectMemory("jwt token");
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.summary.match(/jwt|token/i))).toBe(true);
    });

    it("finds events by file path", async () => {
      const results = await bridge.searchProjectMemory("db.ts");
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.files.includes("src/db.ts"))).toBe(true);
    });

    it("returns formatted text for injection", async () => {
      const text = await bridge.formatProjectRecall("connection pool");
      expect(text).toContain("src/db.ts");
      expect(text).toMatch(/pool|connection/i);
      // Should include session ID for traceability
      expect(text).toContain("old-sess-2");
    });

    it("returns empty for no matches", async () => {
      const results = await bridge.searchProjectMemory("kubernetes helm deploy");
      expect(results).toHaveLength(0);
    });

    it("returns empty string format for no matches", async () => {
      const text = await bridge.formatProjectRecall("kubernetes helm deploy");
      expect(text).toBe("");
    });

    it("returns empty when no project graph", async () => {
      const empty = new ProjectMemoryBridge({ dbDir: tmpDir });
      await empty.onSessionStart({ sessionId: "no-git-3", cwd: "/tmp", gitRoot: null });
      const results = await empty.searchProjectMemory("auth");
      expect(results).toHaveLength(0);
      await empty.onSessionShutdown();
    });
  });
});
