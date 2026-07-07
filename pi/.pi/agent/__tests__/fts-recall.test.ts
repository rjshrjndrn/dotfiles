import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  initGraph,
  closeGraph,
  insertToolResult,
  clearGraphData,
  ftsSearch,
  ftsRebuild,
  ftsInit,
  ftsDirty,
  queryByKeyword,
} from "../acm-lib/graph.ts";

/**
 * FTS Recall Integration Tests
 *
 * Tests the FTS search behavior as it will be used in acm_recall:
 * 1. FTS is primary search — returns scored results
 * 2. CONTAINS fallback when FTS returns 0
 * 3. No per-insert rebuild — only lazy (on search) or explicit batch
 * 4. Batch rebuild pre-warms index for instant search
 */

describe("FTS Recall Integration", () => {
  beforeAll(async () => {
    await initGraph(":memory:");
    await ftsInit();
  });

  afterAll(async () => {
    await closeGraph();
  });

  beforeEach(async () => {
    await clearGraphData();
  });

  // ── Primary search: FTS over CONTAINS ──────────────────────────────

  describe("FTS as primary search", () => {
    it("FTS returns scored results that CONTAINS also finds", async () => {
      await insertToolResult({
        id: "r1",
        toolName: "read",
        keyTerms: "authentication middleware token validation",
        filePaths: ["/src/auth.ts"],
        timestamp: 1000,
      });

      const ftsResults = await ftsSearch("authentication");
      const containsResults = await queryByKeyword("authentication");

      // Both find the same result
      expect(ftsResults.length).toBe(1);
      expect(containsResults.length).toBe(1);
      expect(ftsResults[0].node.id).toBe(containsResults[0].id);

      // FTS has score, CONTAINS doesn't
      expect(ftsResults[0].score).toBeGreaterThan(0);
    });

    it("FTS ranks better than CONTAINS for multi-word queries", async () => {
      await insertToolResult({
        id: "r1",
        toolName: "read",
        keyTerms: "authentication middleware token validation security",
        filePaths: ["/src/auth.ts"],
        timestamp: 1000,
      });
      await insertToolResult({
        id: "r2",
        toolName: "bash",
        keyTerms: "database migration schema update rollback",
        filePaths: ["/src/db.ts"],
        timestamp: 2000,
      });
      await insertToolResult({
        id: "r3",
        toolName: "read",
        keyTerms: "authentication token refresh expiry handling",
        filePaths: ["/src/token.ts"],
        timestamp: 3000,
      });

      const ftsResults = await ftsSearch("authentication token");

      // FTS returns only relevant results, ranked
      expect(ftsResults.length).toBe(2); // r1 and r3, not r2
      expect(ftsResults.every(r => r.score > 0)).toBe(true);
      // Both auth-related results, db result excluded
      const ids = ftsResults.map(r => r.node.id);
      expect(ids).toContain("r1");
      expect(ids).toContain("r3");
      expect(ids).not.toContain("r2");
    });
  });

  // ── Fallback behavior ──────────────────────────────────────────────

  describe("CONTAINS fallback", () => {
    it("CONTAINS finds substring matches that FTS stemming might miss", async () => {
      await insertToolResult({
        id: "f1",
        toolName: "read",
        keyTerms: "setupAuthMiddleware configureTokenRefresh",
        filePaths: ["/src/setup.ts"],
        timestamp: 1000,
      });

      // FTS may or may not find camelCase substrings — depends on tokenizer
      const ftsResults = await ftsSearch("setupAuthMiddleware");
      const containsResults = await queryByKeyword("setupAuthMiddleware");

      // CONTAINS always finds exact substring
      expect(containsResults.length).toBe(1);
      // FTS might find it too (exact match), but CONTAINS is guaranteed
      // This test documents the fallback use case
    });

    it("caller can fall back when FTS returns empty", async () => {
      await insertToolResult({
        id: "f2",
        toolName: "read",
        keyTerms: "myCustomFunctionName",
        filePaths: ["/src/custom.ts"],
        timestamp: 1000,
      });

      // Simulate the acm_recall pattern: FTS first, CONTAINS fallback
      const ftsResults = await ftsSearch("zzz_nonexistent");
      let finalResults;
      if (ftsResults.length === 0) {
        finalResults = await queryByKeyword("myCustomFunctionName");
      } else {
        finalResults = ftsResults.map(r => r.node);
      }

      expect(finalResults.length).toBe(1);
      expect(finalResults[0].id).toBe("f2");
    });
  });

  // ── Rebuild timing ─────────────────────────────────────────────────

  describe("rebuild timing", () => {
    it("insert marks dirty but does NOT rebuild", async () => {
      await insertToolResult({
        id: "t1",
        toolName: "read",
        keyTerms: "timing test data",
        filePaths: [],
        timestamp: 1000,
      });

      // Dirty after insert
      expect(ftsDirty()).toBe(true);

      // Insert more — still dirty, no auto-rebuild happened
      await insertToolResult({
        id: "t2",
        toolName: "edit",
        keyTerms: "more timing data",
        filePaths: [],
        timestamp: 2000,
      });
      expect(ftsDirty()).toBe(true);
    });

    it("lazy rebuild: first search after inserts triggers rebuild", async () => {
      await insertToolResult({
        id: "t3",
        toolName: "read",
        keyTerms: "lazy rebuild verification",
        filePaths: [],
        timestamp: 1000,
      });
      expect(ftsDirty()).toBe(true);

      // Search triggers lazy rebuild
      const results = await ftsSearch("lazy");
      expect(ftsDirty()).toBe(false);
      expect(results.length).toBe(1);
    });

    it("batch rebuild pre-warms: search after rebuild is instant (no dirty)", async () => {
      await insertToolResult({
        id: "t4",
        toolName: "read",
        keyTerms: "batch prewarm testing",
        filePaths: [],
        timestamp: 1000,
      });
      expect(ftsDirty()).toBe(true);

      // Explicit batch rebuild (like after acm_clear)
      await ftsRebuild();
      expect(ftsDirty()).toBe(false);

      // Search should work without needing another rebuild
      const results = await ftsSearch("batch");
      expect(ftsDirty()).toBe(false); // still clean
      expect(results.length).toBe(1);
    });

    it("multiple inserts then one search = one rebuild", async () => {
      // Simulate burst of inserts (like acm_clear flushing)
      for (let i = 0; i < 5; i++) {
        await insertToolResult({
          id: `burst${i}`,
          toolName: "read",
          keyTerms: `burst insert number ${i} searchable`,
          filePaths: [],
          timestamp: 1000 + i,
        });
      }
      expect(ftsDirty()).toBe(true);

      // Single search triggers one rebuild, finds all 5
      const results = await ftsSearch("searchable");
      expect(results.length).toBe(5);
      expect(ftsDirty()).toBe(false);
    });

    it("insert after search re-dirties, next search rebuilds again", async () => {
      await insertToolResult({
        id: "cycle1",
        toolName: "read",
        keyTerms: "cycle first round",
        filePaths: [],
        timestamp: 1000,
      });

      // Search 1: rebuilds
      await ftsSearch("cycle");
      expect(ftsDirty()).toBe(false);

      // New insert: dirty again
      await insertToolResult({
        id: "cycle2",
        toolName: "edit",
        keyTerms: "cycle second round",
        filePaths: [],
        timestamp: 2000,
      });
      expect(ftsDirty()).toBe(true);

      // Search 2: rebuilds again, finds both
      const results = await ftsSearch("cycle");
      expect(results.length).toBe(2);
      expect(ftsDirty()).toBe(false);
    });
  });
});
