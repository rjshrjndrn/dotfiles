import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RepoStore } from "../acm-lib/repo-store.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;
let store: RepoStore;

const ev = (over: any = {}) => ({
  id: "e",
  toolName: "read",
  keyTerms: "",
  eventType: "tool_result",
  files: [] as string[],
  sessionId: "s1",
  timestamp: 0,
  summary: "",
  ...over,
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "repo-store-gc-"));
  store = new RepoStore(join(dir, "repo.db"));
  store.init();
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("collectGarbageByAge", () => {
  it("deletes tool_result events older than the cutoff, keeps recent ones", () => {
    store.writeEvent(ev({ id: "old", timestamp: 100, files: ["a.ts"] }));
    store.writeEvent(ev({ id: "new", timestamp: 900, files: ["b.ts"] }));

    const removed = store.collectGarbageByAge(500); // cutoff ts

    expect(removed).toBe(1);
    expect(store.getSessionEvents("s1").map((e) => e.id)).toEqual(["new"]);
  });

  it("NEVER deletes fact nodes, even when older than the cutoff", () => {
    store.addNode({ id: "f1", type: "fact", label: "durable note", timestamp: 1 });
    store.writeEvent(ev({ id: "old", timestamp: 1 }));

    const removed = store.collectGarbageByAge(500);

    expect(removed).toBe(1); // only the event
    expect(store.search("durable").map((n) => n.id)).toContain("f1");
  });

  it("cascades edge and file cleanup via deleteEvents", () => {
    store.writeEvent(ev({ id: "old", timestamp: 100, files: ["gone.ts"] }));
    store.collectGarbageByAge(500);
    // gone.ts had only this referrer -> orphan-cleaned
    expect(store.getHotFiles().some((h) => h.path === "gone.ts")).toBe(false);
  });

  it("returns 0 when nothing is older than the cutoff", () => {
    store.writeEvent(ev({ id: "new", timestamp: 900 }));
    expect(store.collectGarbageByAge(500)).toBe(0);
  });

  it("NEVER deletes user_note events (curated, durable), even when old", () => {
    store.writeEvent(ev({ id: "note", eventType: "user_note", keyTerms: "deploy via X", timestamp: 1 }));
    store.writeEvent(ev({ id: "old", eventType: "tool_result", timestamp: 1 }));

    const removed = store.collectGarbageByAge(500);

    expect(removed).toBe(1); // only the tool_result
    expect(store.queryByEventType("user_note").map((e) => e.id)).toEqual(["note"]);
  });
});

describe("collectGarbageOrphans", () => {
  it("deletes file nodes whose path no longer exists, keeps present ones", () => {
    store.writeEvent(ev({ id: "e1", files: ["gone.ts", "here.ts"], timestamp: 1 }));
    const present = new Set(["here.ts"]);

    const removed = store.collectGarbageOrphans((p) => present.has(p));

    expect(removed).toBe(1);
    const files = store.getHotFiles().map((h) => h.path);
    expect(files).toContain("here.ts");
    expect(files).not.toContain("gone.ts");
  });

  it("keeps events; only the dead file node + its reference edge go", () => {
    store.writeEvent(ev({ id: "e1", files: ["gone.ts"], timestamp: 1 }));
    store.collectGarbageOrphans(() => false);
    // the event itself survives, just loses the dangling file reference
    expect(store.getSessionEvents("s1").map((e) => e.id)).toEqual(["e1"]);
    expect(store.queryByFile("gone.ts")).toEqual([]);
  });

  it("#3: a file present in the main repo is NOT orphaned when a worktree dies", () => {
    // Path is worktree-relative ('src/a.ts'); the existence check resolves it
    // against the shared main repo root, where it still lives.
    store.writeEvent(ev({ id: "e1", files: ["src/a.ts"], timestamp: 1 }));
    const existsInMain = (p: string) => p === "src/a.ts"; // still on disk in main

    const removed = store.collectGarbageOrphans(existsInMain);

    expect(removed).toBe(0);
    expect(store.getHotFiles().map((h) => h.path)).toContain("src/a.ts");
  });

  it("returns 0 when every file still exists", () => {
    store.writeEvent(ev({ id: "e1", files: ["a.ts", "b.ts"], timestamp: 1 }));
    expect(store.collectGarbageOrphans(() => true)).toBe(0);
  });
});

describe("collectGarbageStale", () => {
  it("deletes sessions whose worktree dir is gone, plus their events", () => {
    store.registerSession({ id: "live", startTime: 1, cwd: "/repo", gitRoot: "/repo" });
    store.registerSession({ id: "dead", startTime: 2, cwd: "/repo/wt-x", gitRoot: "/repo" });
    store.writeEvent(ev({ id: "e-live", sessionId: "live", timestamp: 10 }));
    store.writeEvent(ev({ id: "e-dead", sessionId: "dead", timestamp: 20 }));

    const alive = (cwd: string) => cwd === "/repo"; // wt-x removed

    const removed = store.collectGarbageStale(alive);

    expect(removed).toBe(1); // one session
    expect(store.getSessions().map((s) => s.id)).toEqual(["live"]);
    expect(store.getSessionEvents("dead")).toEqual([]);
    expect(store.getSessionEvents("live").map((e) => e.id)).toEqual(["e-live"]);
  });

  it("cascades file cleanup for the dead session's events", () => {
    store.registerSession({ id: "dead", startTime: 1, cwd: "/repo/wt-x", gitRoot: "/repo" });
    store.writeEvent(ev({ id: "e-dead", sessionId: "dead", files: ["only.ts"], timestamp: 1 }));
    store.collectGarbageStale(() => false);
    expect(store.getHotFiles().some((h) => h.path === "only.ts")).toBe(false);
  });

  it("returns 0 when all worktrees are alive", () => {
    store.registerSession({ id: "s1", startTime: 1, cwd: "/repo", gitRoot: "/repo" });
    expect(store.collectGarbageStale(() => true)).toBe(0);
  });
});

describe("collectGarbageDedup", () => {
  it("collapses identical events, keeping the newest by timestamp", () => {
    // same toolName + keyTerms + files + eventType => duplicates
    store.writeEvent(ev({ id: "d1", toolName: "read", keyTerms: "same", files: ["a.ts"], timestamp: 100 }));
    store.writeEvent(ev({ id: "d2", toolName: "read", keyTerms: "same", files: ["a.ts"], timestamp: 300 }));
    store.writeEvent(ev({ id: "d3", toolName: "read", keyTerms: "same", files: ["a.ts"], timestamp: 200 }));

    const removed = store.collectGarbageDedup();

    expect(removed).toBe(2);
    expect(store.getSessionEvents("s1").map((e) => e.id)).toEqual(["d2"]); // newest kept
  });

  it("treats file order as irrelevant (sorted key)", () => {
    store.writeEvent(ev({ id: "x1", toolName: "edit", keyTerms: "k", files: ["a.ts", "b.ts"], timestamp: 10 }));
    store.writeEvent(ev({ id: "x2", toolName: "edit", keyTerms: "k", files: ["b.ts", "a.ts"], timestamp: 20 }));
    expect(store.collectGarbageDedup()).toBe(1);
    expect(store.getSessionEvents("s1").map((e) => e.id)).toEqual(["x2"]);
  });

  it("leaves distinct events untouched", () => {
    store.writeEvent(ev({ id: "a", toolName: "read", keyTerms: "one", files: ["a.ts"], timestamp: 1 }));
    store.writeEvent(ev({ id: "b", toolName: "bash", keyTerms: "one", files: ["a.ts"], timestamp: 2 }));
    store.writeEvent(ev({ id: "c", toolName: "read", keyTerms: "two", files: ["a.ts"], timestamp: 3 }));
    expect(store.collectGarbageDedup()).toBe(0);
    expect(store.getSessionEvents("s1").length).toBe(3);
  });
});

describe("collectGarbageExpired", () => {
  it("deletes facts whose expires_at is in the past", () => {
    store.addNode({ id: "f1", type: "fact", label: "temporary", expiresAt: 100 });
    store.addNode({ id: "f2", type: "fact", label: "future", expiresAt: 900 });

    const removed = store.collectGarbageExpired(500); // now = 500

    expect(removed).toBe(1);
    expect(store.search("temporary").map((n) => n.id)).not.toContain("f1");
    expect(store.search("future").map((n) => n.id)).toContain("f2");
  });

  it("NEVER deletes facts with no expiry (null = permanent)", () => {
    store.addNode({ id: "perm", type: "fact", label: "permanent note" });
    expect(store.collectGarbageExpired(1e18)).toBe(0);
    expect(store.search("permanent").map((n) => n.id)).toContain("perm");
  });

  it("only targets facts, never tool_result events", () => {
    store.writeEvent(ev({ id: "e1", timestamp: 1 }));
    expect(store.collectGarbageExpired(1e18)).toBe(0);
    expect(store.getSessionEvents("s1").map((e) => e.id)).toEqual(["e1"]);
  });

  it("cleans FTS and relations for an expired fact", () => {
    store.addNode({ id: "f1", type: "fact", label: "gone concept", expiresAt: 1 });
    store.addNode({ id: "c1", type: "concept", label: "topic" });
    store.addRelation("f1", "c1", "relates_to");
    store.collectGarbageExpired(500);
    expect(store.search("gone")).toEqual([]);
    expect(store.neighbors("f1")).toEqual([]);
  });

  it("also expires ttl'd user_note events (any expirable node)", () => {
    store.writeEvent(ev({ id: "note", eventType: "user_note", keyTerms: "temp note", timestamp: 1, expiresAt: 100 }));
    store.writeEvent(ev({ id: "perm", eventType: "user_note", keyTerms: "keep note", timestamp: 1 }));

    const removed = store.collectGarbageExpired(500);

    expect(removed).toBe(1);
    expect(store.queryByEventType("user_note").map((e) => e.id)).toEqual(["perm"]);
  });
});

describe("writeEvent expiresAt", () => {
  it("persists an explicit expiry on an event", () => {
    store.writeEvent(ev({ id: "e1", eventType: "user_note", timestamp: 1, expiresAt: 7777 }));
    // round-trips through the store: expired after its expiry, kept before
    expect(store.collectGarbageExpired(7000, true)).toBe(0); // not yet expired
    expect(store.collectGarbageExpired(8000, true)).toBe(1); // now expired
  });
});

describe("vacuum", () => {
  it("reclaims free pages after deletes (freelist drops to 0)", () => {
    // Fill, then delete most, creating free pages.
    for (let i = 0; i < 500; i++) {
      store.writeEvent(ev({ id: "e" + i, keyTerms: "bulk " + i, files: ["f" + i + ".ts"], timestamp: i }));
    }
    store.collectGarbageByAge(499); // delete all but the last

    const before = store.freelistCount();
    store.vacuum();
    const after = store.freelistCount();

    expect(before).toBeGreaterThan(0);
    expect(after).toBe(0);
  });

  it("leaves the db fully queryable after vacuum", () => {
    store.writeEvent(ev({ id: "keep", keyTerms: "survivor", files: ["a.ts"], timestamp: 1 }));
    store.vacuum();
    expect(store.queryByFile("a.ts").map((e) => e.id)).toEqual(["keep"]);
    expect(store.search("survivor").length).toBeGreaterThanOrEqual(0);
  });
});

describe("dryRun counts without deleting", () => {
  it("each category reports candidate count but leaves data intact", () => {
    store.writeEvent(ev({ id: "old", timestamp: 100 }));
    store.addNode({ id: "f1", type: "fact", label: "temp", expiresAt: 100 });

    expect(store.collectGarbageByAge(500, true)).toBe(1);
    expect(store.collectGarbageExpired(500, true)).toBe(1);

    // nothing actually removed
    expect(store.getSessionEvents("s1").map((e) => e.id)).toEqual(["old"]);
    expect(store.search("temp").map((n) => n.id)).toContain("f1");
  });
});

describe("collectGarbage orchestrator", () => {
  function seed() {
    store.registerSession({ id: "live", startTime: 1, cwd: "/repo", gitRoot: "/repo" });
    store.registerSession({ id: "dead", startTime: 2, cwd: "/repo/wt-x", gitRoot: "/repo" });
    store.writeEvent(ev({ id: "e-old", sessionId: "live", keyTerms: "old one", files: ["keep.ts"], timestamp: 100 }));
    store.writeEvent(ev({ id: "e-new", sessionId: "live", keyTerms: "new one", files: ["keep.ts", "gone.ts"], timestamp: 9000 }));
    store.writeEvent(ev({ id: "e-dup1", sessionId: "live", toolName: "read", keyTerms: "dup", files: ["keep.ts"], timestamp: 9100 }));
    store.writeEvent(ev({ id: "e-dup2", sessionId: "live", toolName: "read", keyTerms: "dup", files: ["keep.ts"], timestamp: 9200 }));
    store.writeEvent(ev({ id: "e-dead", sessionId: "dead", timestamp: 9300 }));
    store.addNode({ id: "f-exp", type: "fact", label: "expired fact", expiresAt: 100 });
    store.addNode({ id: "f-perm", type: "fact", label: "permanent fact" });
  }

  const opts = () => ({
    now: 5000,
    maxAgeDays: 0, // cutoff = now => e-old (ts 100) is "old", e-new/dups (>5000) kept
    worktreeAlive: (cwd: string) => cwd === "/repo",
    fileExists: (p: string) => p !== "gone.ts",
    dedup: true,
    vacuum: false,
  });

  it("dryRun reports per-category counts and deletes NOTHING", () => {
    seed();
    const before = store.getStats();
    const report = store.collectGarbage({ ...opts(), dryRun: true });

    expect(report).toMatchObject({ stale: 1, expired: 1 });
    expect(report.dedup).toBeGreaterThanOrEqual(1);
    expect(store.getStats()).toEqual(before); // untouched
  });

  it("real run deletes and the counts match what changed", () => {
    seed();
    const report = store.collectGarbage(opts());

    // stale: dead session gone
    expect(store.getSessions().map((s) => s.id)).toEqual(["live"]);
    expect(report.stale).toBe(1);
    // expired fact gone, permanent kept
    expect(store.search("expired")).toEqual([]);
    expect(store.search("permanent").map((n) => n.id)).toContain("f-perm");
    expect(report.expired).toBe(1);
    // dedup collapsed the two reads
    expect(report.dedup).toBe(1);
    // orphan: gone.ts removed, keep.ts stays
    const files = store.getHotFiles().map((h) => h.path);
    expect(files).toContain("keep.ts");
    expect(files).not.toContain("gone.ts");
    expect(report.orphan).toBe(1);
  });

  it("skips categories whose predicate is omitted", () => {
    seed();
    const report = store.collectGarbage({ now: 5000, dryRun: true });
    // no worktreeAlive, no fileExists, no maxAgeDays => those categories 0
    expect(report.stale).toBe(0);
    expect(report.orphan).toBe(0);
    expect(report.age).toBe(0);
    // expired still runs off `now`
    expect(report.expired).toBe(1);
  });
});
