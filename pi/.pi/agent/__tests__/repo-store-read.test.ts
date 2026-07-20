import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RepoStore } from "../acm-lib/repo-store.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;
let store: RepoStore;

const mk = (over: any = {}) => ({
  id: "e",
  toolName: "read",
  keyTerms: "",
  eventType: "tool_result",
  files: [],
  sessionId: "s1",
  timestamp: 0,
  summary: "",
  ...over,
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "repo-store-read-"));
  store = new RepoStore(join(dir, "repo.db"));
  store.init();
  store.registerSession({ id: "s1", startTime: 100, cwd: "/repo/wt-a", gitRoot: "/repo" });
  store.registerSession({ id: "s2", startTime: 200, cwd: "/repo/wt-b", gitRoot: "/repo" });
  // e1 read acm.ts ; e2 edit acm.ts+graph.ts ; e3 bash graph.ts (all s1, chained)
  store.writeEvent(mk({ id: "e1", toolName: "read", keyTerms: "load acm config", eventType: "tool_result", files: ["acm.ts"], timestamp: 10 }));
  store.writeEvent(mk({ id: "e2", toolName: "edit", keyTerms: "fix ladybug corruption", eventType: "edit", files: ["acm.ts", "graph.ts"], timestamp: 20 }));
  store.writeEvent(mk({ id: "e3", toolName: "bash", keyTerms: "run tests", eventType: "tool_result", files: ["graph.ts"], timestamp: 30 }));
  // e4 in s2 touches acm.ts
  store.writeEvent(mk({ id: "e4", toolName: "read", keyTerms: "acm again", eventType: "tool_result", files: ["acm.ts"], sessionId: "s2", timestamp: 40 }));
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("queryByFile", () => {
  it("returns all events touching a file, newest first, with full files list", () => {
    const r = store.queryByFile("acm.ts");
    expect(r.map((e) => e.id)).toEqual(["e4", "e2", "e1"]);
    const e2 = r.find((e) => e.id === "e2")!;
    expect([...e2.files].sort()).toEqual(["acm.ts", "graph.ts"]);
  });
});

describe("queryByKeyword", () => {
  it("matches keyTerms/summary case-insensitively, OR across words", () => {
    expect(store.queryByKeyword("corruption").map((e) => e.id)).toEqual(["e2"]);
    expect(store.queryByKeyword("LADYBUG").map((e) => e.id)).toEqual(["e2"]);
  });
  it("returns empty for blank query", () => {
    expect(store.queryByKeyword("   ")).toEqual([]);
  });
});

describe("getRelated", () => {
  it("returns other events sharing a file, excluding self", () => {
    const ids = store.getRelated("e1").map((e) => e.id).sort();
    expect(ids).toEqual(["e2", "e4"]); // all share acm.ts
    expect(store.getRelated("e1").some((e) => e.id === "e1")).toBe(false);
  });
});

describe("getSequence", () => {
  it("forward returns the immediate next event in the same session chain", () => {
    expect(store.getSequence("e1", "forward").map((e) => e.id)).toEqual(["e2"]);
  });
  it("backward returns the immediate previous event", () => {
    expect(store.getSequence("e2", "backward").map((e) => e.id)).toEqual(["e1"]);
  });
});

describe("getSessions", () => {
  it("returns sessions newest first", () => {
    const s = store.getSessions();
    expect(s.map((x) => x.id)).toEqual(["s2", "s1"]);
    expect(s[1]).toMatchObject({ id: "s1", startTime: 100, cwd: "/repo/wt-a", gitRoot: "/repo" });
  });
});

describe("getSessionEvents", () => {
  it("returns events of a session in chronological order", () => {
    expect(store.getSessionEvents("s1").map((e) => e.id)).toEqual(["e1", "e2", "e3"]);
  });
});

describe("queryByEventType", () => {
  it("filters by event type, newest first, honoring limit", () => {
    expect(store.queryByEventType("edit").map((e) => e.id)).toEqual(["e2"]);
    expect(store.queryByEventType("tool_result", 2).map((e) => e.id)).toEqual(["e4", "e3"]);
  });
});

describe("precheckFile", () => {
  it("summarizes activity on a file", () => {
    const p = store.precheckFile("acm.ts");
    expect(p.eventCount).toBe(3);
    expect(p.lastTouched).toBe(40);
    expect([...p.sessions].sort()).toEqual(["s1", "s2"]);
    expect(p.recentKeyTerms.length).toBeGreaterThan(0);
  });
  it("returns zeros for an untouched file", () => {
    expect(store.precheckFile("nope.ts")).toEqual({ eventCount: 0, lastTouched: 0, sessions: [], recentKeyTerms: [] });
  });
});

describe("getStats", () => {
  it("counts events, files, sessions", () => {
    expect(store.getStats()).toEqual({ events: 4, files: 2, sessions: 2 });
  });
});

describe("getHotFiles", () => {
  it("ranks files by reference count", () => {
    const h = store.getHotFiles();
    expect(h[0]).toEqual({ path: "acm.ts", refCount: 3 });
    expect(h.find((x) => x.path === "graph.ts")!.refCount).toBe(2);
  });
});

describe("deleteEvents", () => {
  it("removes events, their edges, FTS entries, and orphaned files", () => {
    const n = store.deleteEvents(["e3"]);
    expect(n).toBe(1);
    expect(store.getSessionEvents("s1").map((e) => e.id)).toEqual(["e1", "e2"]);
    expect(store.queryByKeyword("run tests")).toEqual([]); // FTS cleaned
    // graph.ts still referenced by e2, so it must NOT be orphan-deleted
    expect(store.getHotFiles().some((h) => h.path === "graph.ts")).toBe(true);
  });
  it("orphan-deletes a file once its last referencing event is gone", () => {
    store.deleteEvents(["e2", "e3"]); // graph.ts loses all referrers
    expect(store.getHotFiles().some((h) => h.path === "graph.ts")).toBe(false);
  });
  it("returns 0 for empty input", () => {
    expect(store.deleteEvents([])).toBe(0);
  });
});
