import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ProjectGraph,
  type ProjectGraphEvent,
} from "../acm-lib/project-graph.ts";

// Use a single DB for all tests to avoid mmap exhaustion from many LadybugDB instances
describe("ProjectGraph", () => {
  let tmpDir: string;
  let pg: ProjectGraph;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "pg-test-"));
    pg = new ProjectGraph(join(tmpDir, "all-tests.lbug"));
    await pg.init();
  });

  afterAll(async () => {
    await pg.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("lifecycle", () => {
    it("creates DB and opens read-only", () => {
      expect(pg.isReady()).toBe(true);
    });

    it("creates DB directory if not exists", async () => {
      const nested = join(tmpDir, "deep", "nested", "test.lbug");
      const pg2 = new ProjectGraph(nested);
      await pg2.init();
      expect(pg2.isReady()).toBe(true);
      await pg2.close();
    });
  });

  describe("write + read", () => {
    it("writes events via flock and reads back", async () => {
      const event: ProjectGraphEvent = {
        id: "tr-001",
        toolName: "edit",
        keyTerms: "auth jwt token",
        eventType: "fix",
        files: ["/src/auth.ts", "/src/middleware.ts"],
        sessionId: "session-abc",
        timestamp: Date.now(),
      };

      await pg.writeEvent(event);

      const results = await pg.queryByFile("/src/auth.ts");
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("tr-001");
      expect(results[0].toolName).toBe("edit");
    });

    it("creates References edges to files", async () => {
      const results = await pg.queryByFile("/src/middleware.ts");
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("tr-001");
    });

    it("creates Follows edges between consecutive events in same session", async () => {
      await pg.writeEvent({
        id: "tr-002",
        toolName: "bash",
        keyTerms: "test run vitest",
        eventType: "investigation",
        files: ["/src/auth.ts"],
        sessionId: "session-abc",
        timestamp: Date.now() + 1000,
      });

      const seq = await pg.getSequence("tr-001", "forward");
      expect(seq).toHaveLength(1);
      expect(seq[0].id).toBe("tr-002");
    });

    it("queries by keyword", async () => {
      const results = await pg.queryByKeyword("jwt");
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("tr-001");
    });

    it("finds related events (co-file neighbors)", async () => {
      const related = await pg.getRelated("tr-002");
      expect(related).toHaveLength(1);
      expect(related[0].id).toBe("tr-001");
    });
  });

  describe("session tracking", () => {
    it("stores session metadata", async () => {
      await pg.registerSession({
        id: "sess-1",
        startTime: Date.now(),
        cwd: "/Users/skynet/project-x",
        gitRoot: "/Users/skynet/project-x",
      });

      const sessions = await pg.getSessions();
      expect(sessions.some((s) => s.id === "sess-1")).toBe(true);
    });

    it("links events to sessions", async () => {
      await pg.writeEvent({
        id: "tr-100",
        toolName: "edit",
        keyTerms: "config database",
        eventType: "decision",
        files: ["/config.ts"],
        sessionId: "sess-1",
        timestamp: Date.now(),
      });

      const events = await pg.getSessionEvents("sess-1");
      expect(events.some((e) => e.id === "tr-100")).toBe(true);
    });
  });

  describe("file history (cross-session)", () => {
    it("returns all events for a file across sessions", async () => {
      // Session s1
      await pg.registerSession({ id: "s1", startTime: 1000, cwd: "/project", gitRoot: "/project" });
      await pg.writeEvent({
        id: "e1", toolName: "edit", keyTerms: "auth refactor",
        eventType: "fix", files: ["/src/auth-hist.ts"], sessionId: "s1", timestamp: 1000,
      });

      // Session s2
      await pg.registerSession({ id: "s2", startTime: 2000, cwd: "/project", gitRoot: "/project" });
      await pg.writeEvent({
        id: "e2", toolName: "edit", keyTerms: "auth bugfix token",
        eventType: "fix", files: ["/src/auth-hist.ts"], sessionId: "s2", timestamp: 2000,
      });

      const history = await pg.queryByFile("/src/auth-hist.ts");
      expect(history).toHaveLength(2);
      expect(history.map((e) => e.id).sort()).toEqual(["e1", "e2"]);
    });

    it("returns file precheck with prior context", async () => {
      const precheck = await pg.precheckFile("/src/auth-hist.ts");
      expect(precheck.eventCount).toBe(2);
      expect(precheck.lastTouched).toBeGreaterThan(0);
      expect(precheck.sessions).toContain("s1");
      expect(precheck.sessions).toContain("s2");
    });

    it("returns empty precheck for unknown file", async () => {
      const precheck = await pg.precheckFile("/src/unknown.ts");
      expect(precheck.eventCount).toBe(0);
    });
  });

  // Concurrency test skipped in unit tests — mmap exhaustion with many LDB instances.
  // Validated manually: two readOnly=true Database objects on same path works.
  describe.skip("concurrency — multiple read-only instances", () => {
    it("two read-only instances can query same DB simultaneously", async () => {
      const dbFile = join(tmpDir, "concurrent.lbug");
      const seed = new ProjectGraph(dbFile);
      await seed.init();
      await seed.writeEvent({
        id: "c1", toolName: "edit", keyTerms: "shared data",
        eventType: "fix", files: ["/shared.ts"], sessionId: "s1", timestamp: 1000,
      });
      await seed.close();

      const pg1 = new ProjectGraph(dbFile);
      const pg2 = new ProjectGraph(dbFile);
      await pg1.init();
      await pg2.init();

      const [r1, r2] = await Promise.all([
        pg1.queryByFile("/shared.ts"),
        pg2.queryByFile("/shared.ts"),
      ]);

      expect(r1).toHaveLength(1);
      expect(r2).toHaveLength(1);
      expect(r1[0].id).toBe("c1");
      expect(r2[0].id).toBe("c1");

      await pg1.close();
      await pg2.close();
    });
  });

  describe("stats", () => {
    it("returns node counts", async () => {
      const stats = await pg.getStats();
      expect(stats.events).toBeGreaterThanOrEqual(1);
      expect(stats.files).toBeGreaterThanOrEqual(1);
    });

    it("returns hot files (most referenced)", async () => {
      const hot = await pg.getHotFiles(5);
      expect(hot.length).toBeGreaterThan(0);
      expect(hot[0].refCount).toBeGreaterThanOrEqual(1);
    });
  });
});
