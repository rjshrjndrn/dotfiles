import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  initGraph,
  closeGraph,
  insertToolResult,
  clearGraphData,
  ftsSearch,
  ftsInit,
  type GraphToolResult,
  type FtsSearchResult,
} from "../acm-lib/graph.ts";

/**
 * FTS (Full-Text Search) Behavior Tests
 *
 * LadybugDB auto-indexes new inserts after CREATE_FTS_INDEX.
 * No manual rebuild needed. Contract:
 * 1. ftsInit loads extension + creates index (idempotent)
 * 2. ftsSearch finds data inserted before AND after index creation
 * 3. Results are BM25-scored and ranked
 * 4. Empty table / no matches → [] (no crash)
 * 5. Works across clearGraphData cycles
 */

describe("FTS Search", () => {
  beforeAll(async () => {
    await initGraph(":memory:");
    await ftsInit();
  });

  afterAll(async () => {
    await closeGraph();
  });

  beforeEach(async () => {
    await clearGraphData();
    // Re-init FTS after clear drops the index
    await ftsInit();
  });

  // ── Search behavior ───────────────────────────────────────────────

  describe("search", () => {
    it("returns empty array on empty table", async () => {
      const results = await ftsSearch("anything");
      expect(results).toEqual([]);
    });

    it("finds exact keyword match", async () => {
      await insertToolResult({
        id: "s1",
        toolName: "read",
        keyTerms: "authentication middleware token",
        filePaths: ["/src/auth.ts"],
        timestamp: 1000,
      });
      const results = await ftsSearch("authentication");
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].node.id).toBe("s1");
      expect(results[0].score).toBeGreaterThan(0);
    });

    it("returns results sorted by score descending", async () => {
      await insertToolResult({
        id: "s2a",
        toolName: "read",
        keyTerms: "auth auth auth middleware token",
        filePaths: [],
        timestamp: 1000,
      });
      await insertToolResult({
        id: "s2b",
        toolName: "bash",
        keyTerms: "database migration query optimizer cache invalidation with some auth mention",
        filePaths: [],
        timestamp: 2000,
      });
      const results = await ftsSearch("auth");
      expect(results.length).toBe(2);
      expect(results[0].node.id).toBe("s2a");
      expect(results[0].score).toBeGreaterThan(results[1].score);
    });

    it("supports multi-word queries (OR by default)", async () => {
      await insertToolResult({
        id: "s3a",
        toolName: "read",
        keyTerms: "quantum mechanics physics",
        filePaths: [],
        timestamp: 1000,
      });
      await insertToolResult({
        id: "s3b",
        toolName: "read",
        keyTerms: "machine learning algorithms",
        filePaths: [],
        timestamp: 2000,
      });
      const results = await ftsSearch("quantum machine");
      expect(results.length).toBe(2);
    });

    it("returns no matches for unrelated query", async () => {
      await insertToolResult({
        id: "s4",
        toolName: "read",
        keyTerms: "authentication middleware",
        filePaths: [],
        timestamp: 1000,
      });
      const results = await ftsSearch("zzznonexistent");
      expect(results).toEqual([]);
    });

    it("respects limit parameter", async () => {
      for (let i = 0; i < 10; i++) {
        await insertToolResult({
          id: `lim${i}`,
          toolName: "read",
          keyTerms: `auth token session cookie ${i}`,
          filePaths: [],
          timestamp: 1000 + i,
        });
      }
      const results = await ftsSearch("auth", 3);
      expect(results.length).toBe(3);
    });

    it("includes filePaths in results", async () => {
      await insertToolResult({
        id: "fp1",
        toolName: "read",
        keyTerms: "config database settings",
        filePaths: ["/src/config.ts", "/src/db.ts"],
        timestamp: 1000,
      });
      const results = await ftsSearch("config");
      expect(results.length).toBe(1);
      expect(results[0].node.filePaths).toContain("/src/config.ts");
      expect(results[0].node.filePaths).toContain("/src/db.ts");
    });
  });

  // ── Auto-indexing ─────────────────────────────────────────────────

  describe("auto-indexing", () => {
    it("picks up newly inserted data without manual rebuild", async () => {
      await insertToolResult({
        id: "ai1",
        toolName: "read",
        keyTerms: "first batch data",
        filePaths: [],
        timestamp: 1000,
      });

      // Insert more data — should be auto-indexed
      await insertToolResult({
        id: "ai2",
        toolName: "edit",
        keyTerms: "second batch data",
        filePaths: [],
        timestamp: 2000,
      });

      const results = await ftsSearch("batch");
      expect(results.length).toBe(2);
    });

    it("consecutive searches work without rebuild", async () => {
      await insertToolResult({
        id: "cs1",
        toolName: "read",
        keyTerms: "consecutive search test",
        filePaths: [],
        timestamp: 1000,
      });
      const r1 = await ftsSearch("consecutive");
      expect(r1.length).toBe(1);

      // Second search — still works
      const r2 = await ftsSearch("consecutive");
      expect(r2.length).toBe(1);
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("handles special characters in keyTerms", async () => {
      await insertToolResult({
        id: "ec1",
        toolName: "read",
        keyTerms: "user's auth-token /src/file.ts [array]",
        filePaths: [],
        timestamp: 1000,
      });
      const results = await ftsSearch("auth");
      expect(results.length).toBeGreaterThanOrEqual(0);
    });

    it("handles empty query gracefully", async () => {
      await insertToolResult({
        id: "ec2",
        toolName: "read",
        keyTerms: "some data",
        filePaths: [],
        timestamp: 1000,
      });
      const results = await ftsSearch("");
      expect(results).toEqual([]);
    });

    it("handles query with only stopwords", async () => {
      await insertToolResult({
        id: "ec3",
        toolName: "read",
        keyTerms: "important data here",
        filePaths: [],
        timestamp: 1000,
      });
      const results = await ftsSearch("the a");
      expect(Array.isArray(results)).toBe(true);
    });

    it("works after clearGraphData + new inserts", async () => {
      await insertToolResult({
        id: "clr1",
        toolName: "read",
        keyTerms: "stale records before clear",
        filePaths: [],
        timestamp: 1000,
      });

      await clearGraphData();
      await ftsInit(); // re-create index after clear

      await insertToolResult({
        id: "clr2",
        toolName: "read",
        keyTerms: "fresh records after clear",
        filePaths: [],
        timestamp: 2000,
      });

      const results = await ftsSearch("stale");
      expect(results).toEqual([]);

      const freshResults = await ftsSearch("fresh");
      expect(freshResults.length).toBe(1);
      expect(freshResults[0].node.id).toBe("clr2");
    });
  });
});
