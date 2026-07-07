import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import {
  initGraph,
  closeGraph,
  insertToolResult,
  queryByKeyword,
  queryByFile,
  getRelated,
  getSequence,
  clearGraphData,
  deleteToolResults,
  getGraphStats,
  getGraphSummary,
  type GraphToolResult,
} from "../acm-lib/graph.ts";

describe("acm-graph", () => {
  beforeAll(async () => {
    await initGraph(":memory:");
  });

  afterAll(async () => {
    await closeGraph();
  });

  beforeEach(async () => {
    await clearGraphData();
  });

  describe("insertToolResult", () => {
    it("inserts a tool result and retrieves by keyword", async () => {
      await insertToolResult({
        id: "tr1",
        toolName: "read",
        keyTerms: "auth middleware token",
        filePaths: ["/src/auth.ts"],
        timestamp: 1000,
      });

      const results = await queryByKeyword("auth");
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("tr1");
      expect(results[0].toolName).toBe("read");
    });

    it("creates FilePath nodes and References edges", async () => {
      await insertToolResult({
        id: "tr1",
        toolName: "read",
        keyTerms: "auth",
        filePaths: ["/src/auth.ts", "/src/config.ts"],
        timestamp: 1000,
      });

      const byAuth = await queryByFile("/src/auth.ts");
      expect(byAuth).toHaveLength(1);
      expect(byAuth[0].id).toBe("tr1");

      const byConfig = await queryByFile("/src/config.ts");
      expect(byConfig).toHaveLength(1);
    });

    it("creates Follows edge to previous tool result", async () => {
      await insertToolResult({
        id: "tr1",
        toolName: "read",
        keyTerms: "auth",
        filePaths: ["/src/auth.ts"],
        timestamp: 1000,
      });
      await insertToolResult({
        id: "tr2",
        toolName: "edit",
        keyTerms: "auth fix",
        filePaths: ["/src/auth.ts"],
        timestamp: 1500,
      });

      const seq = await getSequence("tr1", "forward", 3);
      expect(seq).toHaveLength(1);
      expect(seq[0].id).toBe("tr2");
    });
  });

  describe("queryByKeyword", () => {
    it("returns empty for no matches", async () => {
      await insertToolResult({
        id: "tr1",
        toolName: "read",
        keyTerms: "auth middleware",
        filePaths: [],
        timestamp: 1000,
      });

      const results = await queryByKeyword("database");
      expect(results).toHaveLength(0);
    });

    it("matches multiple results", async () => {
      await insertToolResult({
        id: "tr1",
        toolName: "read",
        keyTerms: "auth middleware",
        filePaths: [],
        timestamp: 1000,
      });
      await insertToolResult({
        id: "tr2",
        toolName: "bash",
        keyTerms: "auth test grep",
        filePaths: [],
        timestamp: 2000,
      });
      await insertToolResult({
        id: "tr3",
        toolName: "read",
        keyTerms: "database config",
        filePaths: [],
        timestamp: 3000,
      });

      const results = await queryByKeyword("auth");
      expect(results).toHaveLength(2);
    });
  });

  describe("queryByFile", () => {
    it("finds all tool results that touched a file", async () => {
      await insertToolResult({
        id: "tr1",
        toolName: "read",
        keyTerms: "auth",
        filePaths: ["/src/auth.ts"],
        timestamp: 1000,
      });
      await insertToolResult({
        id: "tr2",
        toolName: "edit",
        keyTerms: "auth fix",
        filePaths: ["/src/auth.ts"],
        timestamp: 2000,
      });
      await insertToolResult({
        id: "tr3",
        toolName: "read",
        keyTerms: "config",
        filePaths: ["/src/config.ts"],
        timestamp: 3000,
      });

      const results = await queryByFile("/src/auth.ts");
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.id).sort()).toEqual(["tr1", "tr2"]);
    });
  });

  describe("getRelated (co-file neighbors)", () => {
    it("finds tool results that share files with given result", async () => {
      await insertToolResult({
        id: "tr1",
        toolName: "read",
        keyTerms: "auth",
        filePaths: ["/src/auth.ts"],
        timestamp: 1000,
      });
      await insertToolResult({
        id: "tr2",
        toolName: "edit",
        keyTerms: "auth fix bug",
        filePaths: ["/src/auth.ts", "/src/middleware.ts"],
        timestamp: 2000,
      });
      await insertToolResult({
        id: "tr3",
        toolName: "read",
        keyTerms: "middleware",
        filePaths: ["/src/middleware.ts"],
        timestamp: 3000,
      });

      // tr1 shares auth.ts with tr2
      const related1 = await getRelated("tr1");
      expect(related1.map((r) => r.id)).toContain("tr2");

      // tr3 shares middleware.ts with tr2
      const related3 = await getRelated("tr3");
      expect(related3.map((r) => r.id)).toContain("tr2");

      // tr1 and tr3 don't directly share files
      expect(related1.map((r) => r.id)).not.toContain("tr3");
    });
  });

  describe("getSequence (temporal traversal)", () => {
    it("traverses forward through Follows edges", async () => {
      await insertToolResult({ id: "tr1", toolName: "read", keyTerms: "a", filePaths: [], timestamp: 1000 });
      await insertToolResult({ id: "tr2", toolName: "edit", keyTerms: "b", filePaths: [], timestamp: 2000 });
      await insertToolResult({ id: "tr3", toolName: "bash", keyTerms: "c", filePaths: [], timestamp: 3000 });

      const fwd = await getSequence("tr1", "forward", 5);
      expect(fwd.map((r) => r.id)).toEqual(["tr2", "tr3"]);
    });

    it("traverses backward through Follows edges", async () => {
      await insertToolResult({ id: "tr1", toolName: "read", keyTerms: "a", filePaths: [], timestamp: 1000 });
      await insertToolResult({ id: "tr2", toolName: "edit", keyTerms: "b", filePaths: [], timestamp: 2000 });
      await insertToolResult({ id: "tr3", toolName: "bash", keyTerms: "c", filePaths: [], timestamp: 3000 });

      const bwd = await getSequence("tr3", "backward", 5);
      expect(bwd.map((r) => r.id)).toEqual(["tr2", "tr1"]);
    });

    it("respects depth limit", async () => {
      await insertToolResult({ id: "tr1", toolName: "a", keyTerms: "x", filePaths: [], timestamp: 1000 });
      await insertToolResult({ id: "tr2", toolName: "b", keyTerms: "x", filePaths: [], timestamp: 2000 });
      await insertToolResult({ id: "tr3", toolName: "c", keyTerms: "x", filePaths: [], timestamp: 3000 });
      await insertToolResult({ id: "tr4", toolName: "d", keyTerms: "x", filePaths: [], timestamp: 4000 });

      const fwd = await getSequence("tr1", "forward", 2);
      expect(fwd).toHaveLength(2);
      expect(fwd.map((r) => r.id)).toEqual(["tr2", "tr3"]);
    });
  });

  describe("persistence", () => {
    it("survives close and reopen with file-backed DB", async () => {
      const { mkdtempSync, rmSync } = await import("node:fs");
      const { tmpdir } = await import("node:os");
      const { join } = await import("node:path");
      const tmpDir = mkdtempSync(join(tmpdir(), "acm-graph-"));
      const dbPath = join(tmpDir, "test.lbug");

      // Close shared in-memory DB
      await closeGraph();

      // Open file-backed, insert, close
      await initGraph(dbPath);
      await insertToolResult({ id: "tr1", toolName: "read", keyTerms: "auth", filePaths: ["/src/auth.ts"], timestamp: 1000 });
      await closeGraph();

      // Reopen and query
      await initGraph(dbPath);
      const results = await queryByKeyword("auth");
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("tr1");

      const byFile = await queryByFile("/src/auth.ts");
      expect(byFile).toHaveLength(1);

      // Cleanup
      await closeGraph();
      rmSync(tmpDir, { recursive: true, force: true });

      // Re-init shared in-memory for remaining tests
      await initGraph(":memory:");
    });
  });

  describe("getGraphStats", () => {
    it("returns zero counts on empty graph", async () => {
      const stats = await getGraphStats();
      expect(stats.toolResults).toBe(0);
      expect(stats.filePaths).toBe(0);
    });

    it("returns correct counts after inserts", async () => {
      await insertToolResult({ id: "s1", toolName: "read", keyTerms: "foo", filePaths: ["/a.ts", "/b.ts"], timestamp: Date.now() });
      await insertToolResult({ id: "s2", toolName: "bash", keyTerms: "bar", filePaths: ["/b.ts"], timestamp: Date.now() });
      const stats = await getGraphStats();
      expect(stats.toolResults).toBe(2);
      expect(stats.filePaths).toBe(2); // /a.ts and /b.ts deduplicated
    });
  });

  describe("getGraphSummary", () => {
    it("returns empty on empty graph", async () => {
      const summary = await getGraphSummary();
      expect(summary.toolResults).toBe(0);
      expect(summary.filePaths).toEqual([]);
    });

    it("returns sorted unique file paths", async () => {
      await insertToolResult({ id: "g1", toolName: "read", keyTerms: "x", filePaths: ["/z.ts", "/a.ts"], timestamp: Date.now() });
      await insertToolResult({ id: "g2", toolName: "read", keyTerms: "y", filePaths: ["/a.ts", "/m.ts"], timestamp: Date.now() });
      const summary = await getGraphSummary();
      expect(summary.toolResults).toBe(2);
      expect(summary.filePaths).toEqual(["/a.ts", "/m.ts", "/z.ts"]);
    });
  });

  describe("slide summary integration", () => {
    it("getGraphSummary produces data suitable for slide head injection", async () => {
      await insertToolResult({ id: "sl1", toolName: "read", keyTerms: "auth middleware", filePaths: ["/src/auth.ts"], timestamp: Date.now() });
      await insertToolResult({ id: "sl2", toolName: "bash", keyTerms: "test config", filePaths: ["/src/auth.ts", "/src/config.ts"], timestamp: Date.now() });

      const gs = await getGraphSummary();
      expect(gs.toolResults).toBe(2);
      expect(gs.filePaths).toHaveLength(2);

      // Simulate what slide handler does: build context string
      const basenames = [...new Set(gs.filePaths.map((p: string) => p.split("/").slice(-2).join("/")))].slice(0, 20);
      let summary = "[Context before this point was slid away. Use acm_recall to search old context.]";
      summary += `\n\nGraph context (${gs.toolResults} cached results, ${gs.filePaths.length} files):`;
      summary += `\nFiles: ${basenames.join(", ")}`;

      expect(summary).toContain("Graph context");
      expect(summary).toContain("2 cached results");
      expect(summary).toContain("2 files");
      expect(summary).toContain("src/auth.ts");
      expect(summary).toContain("src/config.ts");
    });
  });

  describe("deleteToolResults", () => {
    it("deletes specific nodes and their edges", async () => {
      await insertToolResult({ id: "d1", toolName: "read", keyTerms: "auth token", filePaths: ["/auth.ts"], timestamp: Date.now() });
      await insertToolResult({ id: "d2", toolName: "bash", keyTerms: "test run", filePaths: ["/auth.ts", "/test.ts"], timestamp: Date.now() });
      await insertToolResult({ id: "d3", toolName: "edit", keyTerms: "config update", filePaths: ["/config.ts"], timestamp: Date.now() });

      const stats1 = await getGraphStats();
      expect(stats1.toolResults).toBe(3);

      const deleted = await deleteToolResults(["d1", "d2"]);
      expect(deleted).toBe(2);

      const stats2 = await getGraphStats();
      expect(stats2.toolResults).toBe(1);

      // d3 still queryable
      const results = await queryByKeyword("config");
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("d3");
    });

    it("cleans up orphaned FilePath nodes", async () => {
      await insertToolResult({ id: "o1", toolName: "read", keyTerms: "only ref", filePaths: ["/orphan.ts"], timestamp: Date.now() });
      await insertToolResult({ id: "o2", toolName: "read", keyTerms: "shared ref", filePaths: ["/shared.ts"], timestamp: Date.now() });

      await deleteToolResults(["o1"]);

      const stats = await getGraphStats();
      expect(stats.filePaths).toBe(1); // /orphan.ts removed, /shared.ts kept
    });

    it("returns 0 for empty array", async () => {
      const deleted = await deleteToolResults([]);
      expect(deleted).toBe(0);
    });

    it("handles non-existent IDs gracefully", async () => {
      const deleted = await deleteToolResults(["nonexistent"]);
      expect(deleted).toBe(1); // query succeeds, just no rows affected
    });
  });
});
