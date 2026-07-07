import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  initGraph,
  closeGraph,
  insertToolResult,
  clearGraphData,
  ftsSearch,
  ftsRebuild,
  ftsDirty,
  type GraphToolResult,
  type FtsSearchResult,
} from "../acm-lib/graph.ts";

/**
 * FTS (Full-Text Search) Behavior Tests
 *
 * These tests define the contract for FTS on LadybugDB:
 * 1. FTS extension loaded on initGraph
 * 2. insertToolResult sets dirty flag
 * 3. ftsSearch rebuilds lazily when dirty, then queries
 * 4. Results are BM25-scored and ranked
 * 5. Empty table / no matches → [] (no crash)
 * 6. Manual ftsRebuild for async pre-warming
 * 7. Fallback: ftsSearch returns [] when no match; caller does CONTAINS fallback
 */

describe("FTS Search", () => {
  beforeAll(async () => {
    await initGraph(":memory:");
  });

  afterAll(async () => {
    await closeGraph();
  });

  beforeEach(async () => {
    await clearGraphData();
  });

  // ── Dirty tracking ────────────────────────────────────────────────

  describe("dirty tracking", () => {
    it("starts clean after init (no data to index)", () => {
      // After clearGraphData, dirty should be false (nothing to index)
      expect(ftsDirty()).toBe(false);
    });

    it("marks dirty after insertToolResult", async () => {
      await insertToolResult({
        id: "d1",
        toolName: "read",
        keyTerms: "authentication middleware",
        filePaths: ["/src/auth.ts"],
        timestamp: 1000,
      });
      expect(ftsDirty()).toBe(true);
    });

    it("clears dirty after ftsRebuild", async () => {
      await insertToolResult({
        id: "d2",
        toolName: "read",
        keyTerms: "some terms",
        filePaths: [],
        timestamp: 1000,
      });
      expect(ftsDirty()).toBe(true);
      await ftsRebuild();
      expect(ftsDirty()).toBe(false);
    });

    it("clears dirty after ftsSearch (lazy rebuild)", async () => {
      await insertToolResult({
        id: "d3",
        toolName: "read",
        keyTerms: "token validation",
        filePaths: [],
        timestamp: 1000,
      });
      expect(ftsDirty()).toBe(true);
      await ftsSearch("token");
      expect(ftsDirty()).toBe(false);
    });
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
      // s2a should score higher (more "auth" occurrences, shorter doc)
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
      // "quantum machine" should match both (OR)
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

  // ── Lazy rebuild ──────────────────────────────────────────────────

  describe("lazy rebuild", () => {
    it("picks up newly inserted data on next search", async () => {
      await insertToolResult({
        id: "lr1",
        toolName: "read",
        keyTerms: "first batch data",
        filePaths: [],
        timestamp: 1000,
      });
      await ftsRebuild();

      // Insert more data after rebuild
      await insertToolResult({
        id: "lr2",
        toolName: "edit",
        keyTerms: "second batch data",
        filePaths: [],
        timestamp: 2000,
      });

      // Search should trigger lazy rebuild and find both
      const results = await ftsSearch("batch");
      expect(results.length).toBe(2);
    });

    it("skips rebuild when not dirty", async () => {
      await insertToolResult({
        id: "sk1",
        toolName: "read",
        keyTerms: "skip rebuild test",
        filePaths: [],
        timestamp: 1000,
      });
      // First search triggers rebuild
      await ftsSearch("skip");
      expect(ftsDirty()).toBe(false);

      // Second search — no rebuild needed, still works
      const results = await ftsSearch("skip");
      expect(results.length).toBe(1);
      expect(ftsDirty()).toBe(false);
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
      // Should not crash
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
      // "the" and "a" are stopwords — may return empty or all
      const results = await ftsSearch("the a");
      // Should not crash, results may be empty
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
      await ftsRebuild();

      await clearGraphData();

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
