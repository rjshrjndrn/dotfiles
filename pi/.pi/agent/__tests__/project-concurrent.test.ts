/**
 * Concurrency tests for ProjectGraph shared mode.
 *
 * Uses a single DB to minimize mmap pressure from LadybugDB (which doesn't
 * release mmap on close within same process).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProjectGraph } from "../acm-lib/project-graph.ts";

describe("ProjectGraph shared mode", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pg-shared-"));
    dbPath = join(tmpDir, "shared.lbug");
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("sequential sessions: write → close → reopen → read → write", async () => {
    // Session 1: write
    const pg1 = new ProjectGraph(dbPath, "shared");
    await pg1.init();
    await pg1.registerSession({ id: "s1", startTime: 1000, cwd: "/p", gitRoot: "/p" });
    await pg1.writeEvent({
      id: "e1", toolName: "edit", keyTerms: "auth fix jwt",
      eventType: "fix", files: ["src/auth.ts"], sessionId: "s1", timestamp: 1000,
      summary: "Fixed JWT token expiry check",
    });
    await pg1.close();

    // Session 2: reads s1's data + writes own
    const pg2 = new ProjectGraph(dbPath, "shared");
    await pg2.init();

    // Cross-session read
    const history = await pg2.queryByFile("src/auth.ts");
    expect(history).toHaveLength(1);
    expect(history[0].id).toBe("e1");
    expect(history[0].sessionId).toBe("s1");

    // Precheck before editing same file
    const precheck = await pg2.precheckFile("src/auth.ts");
    expect(precheck.eventCount).toBe(1);
    expect(precheck.sessions).toContain("s1");

    // Write own event
    await pg2.registerSession({ id: "s2", startTime: 2000, cwd: "/p", gitRoot: "/p" });
    await pg2.writeEvent({
      id: "e2", toolName: "edit", keyTerms: "db pool connection",
      eventType: "fix", files: ["src/db.ts"], sessionId: "s2", timestamp: 2000,
      summary: "Increased connection pool to 20",
    });

    // Stats reflect both sessions
    const stats = await pg2.getStats();
    expect(stats.events).toBe(2);
    expect(stats.sessions).toBe(2);
    expect(stats.files).toBe(2);

    // Keyword search across sessions
    const jwtResults = await pg2.queryByKeyword("jwt");
    expect(jwtResults).toHaveLength(1);
    expect(jwtResults[0].sessionId).toBe("s1");

    const poolResults = await pg2.queryByKeyword("pool");
    expect(poolResults).toHaveLength(1);
    expect(poolResults[0].sessionId).toBe("s2");

    // Search by summary
    const summaryResults = await pg2.queryByKeyword("token expiry");
    expect(summaryResults).toHaveLength(1);

    // Error event from s1 (add via s2)
    await pg2.writeEvent({
      id: "e3", toolName: "bash", keyTerms: "test fail auth mock",
      eventType: "error", files: ["src/auth.ts"], sessionId: "s2", timestamp: 3000,
      summary: "Auth test failing: mock not reset",
    });

    // Session 3: sees everything
    await pg2.close();
    const pg3 = new ProjectGraph(dbPath, "shared");
    await pg3.init();

    const allAuth = await pg3.queryByFile("src/auth.ts");
    expect(allAuth).toHaveLength(2); // e1 fix + e3 error
    expect(allAuth.some((e) => e.eventType === "fix")).toBe(true);
    expect(allAuth.some((e) => e.eventType === "error")).toBe(true);

    const hotFiles = await pg3.getHotFiles(5);
    expect(hotFiles[0].path).toBe("src/auth.ts");
    expect(hotFiles[0].refCount).toBe(2);

    await pg3.close();
  });
});
