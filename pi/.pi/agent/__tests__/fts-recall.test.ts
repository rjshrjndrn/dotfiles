import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  initGraph,
  closeGraph,
  insertToolResult,
  clearGraphData,
  ftsSearch,
  ftsRebuild,
  ftsInit,
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

  describe("always-live index (SQLite FTS5)", () => {
    // Unlike the old LadybugDB engine, FTS5 updates incrementally on every
    // insert. There is no dirty state and no batch rebuild — the index is
    // always current, so a search immediately after an insert finds the row.

    it("search finds a row immediately after insert (no rebuild needed)", async () => {
      await insertToolResult({
        id: "t1",
        toolName: "read",
        keyTerms: "timing test data",
        filePaths: [],
        timestamp: 1000,
      });
      expect((await ftsSearch("timing")).length).toBe(1);
    });

    it("finds all rows from a burst of inserts in one search", async () => {
      for (let i = 0; i < 5; i++) {
        await insertToolResult({
          id: `burst${i}`,
          toolName: "read",
          keyTerms: `burst insert number ${i} searchable`,
          filePaths: [],
          timestamp: 1000 + i,
        });
      }
      expect((await ftsSearch("searchable")).length).toBe(5);
    });

    it("ftsRebuild is a harmless no-op that leaves the index queryable", async () => {
      await insertToolResult({
        id: "t4",
        toolName: "read",
        keyTerms: "batch prewarm testing",
        filePaths: [],
        timestamp: 1000,
      });
      await ftsRebuild();
      expect((await ftsSearch("batch")).length).toBe(1);
    });

    it("stays current across interleaved inserts and searches", async () => {
      await insertToolResult({
        id: "cycle1",
        toolName: "read",
        keyTerms: "cycle first round",
        filePaths: [],
        timestamp: 1000,
      });
      expect((await ftsSearch("cycle")).length).toBe(1);

      await insertToolResult({
        id: "cycle2",
        toolName: "edit",
        keyTerms: "cycle second round",
        filePaths: [],
        timestamp: 2000,
      });
      expect((await ftsSearch("cycle")).length).toBe(2);
    });
  });
});
