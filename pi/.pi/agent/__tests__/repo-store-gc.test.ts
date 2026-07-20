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
