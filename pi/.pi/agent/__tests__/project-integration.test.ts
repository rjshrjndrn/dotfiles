/**
 * Integration test: full pipeline from turn_end → DecisionGate → ProjectGraph.
 *
 * Uses real LadybugDB + real DecisionGate. Simulates pi session lifecycle
 * with fake tool results to prove the wiring works end-to-end.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProjectGraph, type ProjectGraphEvent } from "../acm-lib/project-graph.ts";
import { DecisionGate, type TurnContext } from "../acm-lib/decision-gate.ts";
import { detectRepoRoot, projectDbPath, clearRootCache } from "../acm-lib/git-root.ts";

/**
 * Simulates the wiring that will exist in acm.ts.
 * Processes a turn_end event through the decision gate and writes to project graph.
 */
async function processTurnEnd(
  gate: DecisionGate,
  graph: ProjectGraph,
  turn: TurnContext
): Promise<{ promoted: number; buffered: number; skipped: number }> {
  const results = gate.evaluate(turn);
  let promoted = 0,
    buffered = 0,
    skipped = 0;

  for (const r of results) {
    switch (r.action) {
      case "promote":
        await graph.writeEvent(r.event);
        promoted++;
        break;
      case "buffer":
        buffered++;
        break;
      case "skip":
        skipped++;
        break;
    }
  }

  return { promoted, buffered, skipped };
}

describe("Project Memory Integration", () => {
  let tmpDir: string;
  let dbPath: string;
  let graph: ProjectGraph;
  let gate: DecisionGate;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "proj-int-"));
    dbPath = join(tmpDir, "memory.lbug");
    graph = new ProjectGraph(dbPath);
    await graph.init();
    gate = new DecisionGate();

    // Register session
    await graph.registerSession({
      id: "sess-integration",
      startTime: Date.now(),
      cwd: "/project",
      gitRoot: "/project",
    });
  });

  afterAll(async () => {
    await graph.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("scenario 1: read → edit promotes both to project graph", async () => {
    // Turn 1: read auth.ts (investigation → buffered)
    const r1 = await processTurnEnd(gate, graph, {
      turnIndex: 1,
      assistantText: "Let me check the auth implementation",
      toolResults: [
        { toolName: "read", toolCallId: "tc-1", input: { path: "src/auth.ts" }, isError: false },
      ],
      sessionId: "sess-integration",
      timestamp: 1000,
    });
    expect(r1.buffered).toBe(1);
    expect(r1.promoted).toBe(0);

    // Turn 2: edit auth.ts (mutation → promotes self + linked read)
    const r2 = await processTurnEnd(gate, graph, {
      turnIndex: 2,
      assistantText: "Fixed token expiry: changed < to <=",
      toolResults: [
        { toolName: "edit", toolCallId: "tc-2", input: { path: "src/auth.ts" }, isError: false },
      ],
      sessionId: "sess-integration",
      timestamp: 2000,
    });
    expect(r2.promoted).toBe(2); // edit + linked read

    // Verify both in project graph
    const events = await graph.queryByFile("src/auth.ts");
    expect(events).toHaveLength(2);
    expect(events.some((e) => e.eventType === "fix")).toBe(true);
    expect(events.some((e) => e.eventType === "investigation")).toBe(true);
  });

  it("scenario 2: ls is skipped, never enters project graph", async () => {
    const r = await processTurnEnd(gate, graph, {
      turnIndex: 3,
      assistantText: "Let me see the directory",
      toolResults: [
        { toolName: "bash", toolCallId: "tc-3", input: { command: "ls -la src/" }, isError: false },
      ],
      sessionId: "sess-integration",
      timestamp: 3000,
    });
    expect(r.skipped).toBe(1);
    expect(r.promoted).toBe(0);
  });

  it("scenario 3: error gets promoted immediately", async () => {
    const r = await processTurnEnd(gate, graph, {
      turnIndex: 4,
      assistantText: "Build failed: cannot find module 'lodash'",
      toolResults: [
        { toolName: "bash", toolCallId: "tc-4", input: { command: "npm run build" }, isError: true },
      ],
      sessionId: "sess-integration",
      timestamp: 4000,
    });
    expect(r.promoted).toBe(1);

    // Verify in graph by keyword
    const errors = await graph.queryByKeyword("lodash");
    expect(errors).toHaveLength(1);
    expect(errors[0].eventType).toBe("error");
  });

  it("scenario 4: multi-file edit creates organic relationships", async () => {
    await processTurnEnd(gate, graph, {
      turnIndex: 5,
      assistantText: "Refactoring auth to use middleware pattern",
      toolResults: [
        { toolName: "edit", toolCallId: "tc-5a", input: { path: "src/auth.ts" }, isError: false },
        { toolName: "edit", toolCallId: "tc-5b", input: { path: "src/middleware.ts" }, isError: false },
        { toolName: "edit", toolCallId: "tc-5c", input: { path: "src/config.ts" }, isError: false },
      ],
      sessionId: "sess-integration",
      timestamp: 5000,
    });

    // All three files should be related via same ToolResult
    const related = await graph.queryByFile("src/middleware.ts");
    expect(related.some((e) => e.files.includes("src/auth.ts"))).toBe(true);
    expect(related.some((e) => e.files.includes("src/config.ts"))).toBe(true);
  });

  it("scenario 5: git commit gets promoted", async () => {
    const r = await processTurnEnd(gate, graph, {
      turnIndex: 6,
      assistantText: "Committed the auth refactor",
      toolResults: [
        {
          toolName: "bash",
          toolCallId: "tc-6",
          input: { command: "git add . && git commit -m 'feat: auth refactor'" },
          isError: false,
        },
      ],
      sessionId: "sess-integration",
      timestamp: 6000,
    });
    expect(r.promoted).toBe(1);
  });

  it("scenario 6: unrelated reads stay buffered, not promoted", async () => {
    // Read a file that is never edited
    await processTurnEnd(gate, graph, {
      turnIndex: 7,
      assistantText: "Checking the README",
      toolResults: [
        { toolName: "read", toolCallId: "tc-7", input: { path: "README.md" }, isError: false },
      ],
      sessionId: "sess-integration",
      timestamp: 7000,
    });

    // Should not be in project graph
    const readmeEvents = await graph.queryByFile("README.md");
    expect(readmeEvents).toHaveLength(0);

    // Should still be in gate buffer
    expect(gate.getBufferedFiles()).toContain("README.md");
  });

  it("scenario 7: flush at session end returns buffered events", () => {
    const flushed = gate.flush();
    expect(flushed.length).toBeGreaterThanOrEqual(1);
    expect(flushed.some((e) => e.files.includes("README.md"))).toBe(true);
    expect(gate.getBufferedFiles()).toHaveLength(0);
  });

  it("scenario 8: summary captures LLM reasoning", async () => {
    const events = await graph.queryByKeyword("token expiry");
    const fixEvent = events.find((e) => e.eventType === "fix" && e.summary);
    expect(fixEvent).toBeDefined();
    expect(fixEvent!.summary).toContain("token expiry");
  });

  it("scenario 9: cross-session — second session sees first session's data", async () => {
    // Close and reopen with new session (simulates new pi session)
    await graph.close();

    const graph2 = new ProjectGraph(dbPath);
    await graph2.init();

    await graph2.registerSession({
      id: "sess-2",
      startTime: Date.now(),
      cwd: "/project",
      gitRoot: "/project",
    });

    // Can see session 1's data
    const history = await graph2.queryByFile("src/auth.ts");
    expect(history.length).toBeGreaterThanOrEqual(2);

    const precheck = await graph2.precheckFile("src/auth.ts");
    expect(precheck.sessions).toContain("sess-integration");
    expect(precheck.eventCount).toBeGreaterThanOrEqual(2);

    // Can see sessions
    const sessions = await graph2.getSessions();
    expect(sessions.some((s) => s.id === "sess-integration")).toBe(true);
    expect(sessions.some((s) => s.id === "sess-2")).toBe(true);

    // Stats
    const stats = await graph2.getStats();
    expect(stats.events).toBeGreaterThanOrEqual(4);
    expect(stats.files).toBeGreaterThanOrEqual(3);
    expect(stats.sessions).toBe(2);

    // Hot files
    const hot = await graph2.getHotFiles(5);
    expect(hot[0].path).toBe("src/auth.ts"); // most referenced

    await graph2.close();

    // Reopen original for afterAll cleanup
    graph = new ProjectGraph(dbPath);
    await graph.init();
  });

  it("scenario 10: keyword search finds across sessions", async () => {
    // Add event from "session 2" perspective
    const gate2 = new DecisionGate();
    await processTurnEnd(gate2, graph, {
      turnIndex: 1,
      assistantText: "Database connection pool exhausted, increasing max to 20",
      toolResults: [
        { toolName: "edit", toolCallId: "tc-s2-1", input: { path: "src/db.ts" }, isError: false },
      ],
      sessionId: "sess-2",
      timestamp: 10000,
    });

    // Search should find events from both sessions
    const authResults = await graph.queryByKeyword("auth");
    expect(authResults.length).toBeGreaterThanOrEqual(1);

    const dbResults = await graph.queryByKeyword("database pool");
    expect(dbResults.length).toBeGreaterThanOrEqual(1);
  });
});

describe("Git root caching", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "git-cache-"));
    clearRootCache();
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    clearRootCache();
  });

  it("creates .pi/git-root.cache on first detection", async () => {
    const { execSync } = await import("node:child_process");
    const repo = join(tmpDir, "cacherepo");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(repo, { recursive: true });
    execSync("git init", { cwd: repo });

    const root = detectRepoRoot(repo);
    expect(root).toBeTruthy();

    // Cache file should exist
    const cacheFile = join(root!, ".pi", "git-root.cache");
    expect(existsSync(cacheFile)).toBe(true);
  });

  it("uses cached value on second call (no subprocess)", async () => {
    const { execSync } = await import("node:child_process");
    const repo = join(tmpDir, "cacherepo2");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(repo, { recursive: true });
    execSync("git init", { cwd: repo });

    // First call
    const root1 = detectRepoRoot(repo);
    // Clear in-memory cache to test file cache
    clearRootCache();
    // Second call should use file cache
    const root2 = detectRepoRoot(repo);
    expect(root2).toBe(root1);
  });
});
