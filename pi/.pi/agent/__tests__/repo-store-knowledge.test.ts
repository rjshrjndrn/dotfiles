import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RepoStore } from "../acm-lib/repo-store.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;
let store: RepoStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "repo-store-kg-"));
  store = new RepoStore(join(dir, "repo.db"));
  store.init();
  // Facts organically unearthed across sessions
  store.addNode({ id: "f1", type: "fact", label: "ladybug corrupts on crash", body: "wal orphan wipes db" });
  store.addNode({ id: "f2", type: "fact", label: "sqlite wal is crash safe", body: "recovers after sigkill" });
  store.addNode({ id: "f3", type: "fact", label: "worktrees share one db", body: "git common dir" });
  store.addNode({ id: "c1", type: "concept", label: "crash safety" });
  store.addNode({ id: "c2", type: "concept", label: "concurrency" });
  store.addNode({ id: "file1", type: "file", label: "graph.ts" });
  // Relations
  store.addRelation("f1", "c1", "relates_to");
  store.addRelation("f2", "c1", "relates_to");
  store.addRelation("f2", "c2", "relates_to");
  store.addRelation("f3", "c2", "relates_to");
  store.addRelation("f1", "f2", "derived_from");
  store.addRelation("f1", "file1", "references");
  store.addRelation("f2", "file1", "references");
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("addNode / search (FTS, porter stemming)", () => {
  it("finds facts by stemmed term", () => {
    // 'corrupt' should match 'corrupts' via porter
    expect(store.search("corrupt").map((n) => n.id)).toContain("f1");
  });
  it("searches label and body", () => {
    expect(store.search("sigkill").map((n) => n.id)).toContain("f2"); // from body
  });
  it("filters by node type", () => {
    const r = store.search("crash", { types: ["fact"] });
    expect(r.every((n) => n.type === "fact")).toBe(true);
    expect(r.map((n) => n.id).sort()).toEqual(["f1", "f2"]);
  });
  it("honors limit", () => {
    expect(store.search("crash", { limit: 1 }).length).toBe(1);
  });
});

describe("addRelation / neighbors (1-hop)", () => {
  it("returns outgoing neighbors with their rel label", () => {
    const ns = store.neighbors("f1");
    expect(ns.map((n) => `${n.rel}:${n.id}`).sort()).toEqual([
      "derived_from:f2",
      "references:file1",
      "relates_to:c1",
    ]);
  });
  it("filters neighbors by rel", () => {
    expect(store.neighbors("f1", { rel: "relates_to" }).map((n) => n.id)).toEqual(["c1"]);
  });
  it("supports incoming direction", () => {
    // who points at c1 via relates_to?
    expect(store.neighbors("c1", { direction: "in", rel: "relates_to" }).map((n) => n.id).sort()).toEqual(["f1", "f2"]);
  });
});

describe("traverse (multi-hop transitive, cycle-safe)", () => {
  it("returns everything reachable up to maxDepth with depth tracking", () => {
    const r = store.traverse("f1", { maxDepth: 3 });
    const byId = Object.fromEntries(r.map((n) => [n.id, n.depth]));
    // f1 -> c1,f2,file1 at depth 1
    expect(byId["c1"]).toBe(1);
    expect(byId["f2"]).toBe(1);
    expect(byId["file1"]).toBe(1);
    // f1 -> f2 -> c2 at depth 2
    expect(byId["c2"]).toBe(2);
    expect(r.some((n) => n.id === "f1")).toBe(false); // excludes start
  });
  it("respects maxDepth cutoff", () => {
    const r = store.traverse("f1", { maxDepth: 1 });
    expect(r.some((n) => n.id === "c2")).toBe(false); // c2 is 2 hops away
  });
});

describe("cooccur (facts sharing a concept)", () => {
  it("finds nodes sharing a relates_to target with the given node", () => {
    // f1 relates_to c1; f2 also relates_to c1 => f2 co-occurs with f1
    expect(store.cooccur("f1", "relates_to").map((n) => n.id)).toEqual(["f2"]);
  });
});

describe("organic unearthing (search then expand)", () => {
  it("surfaces connections not directly queried: search 'crash', walk relations", () => {
    const hits = store.search("crash", { types: ["fact"] }); // f1, f2
    const connections = new Set<string>();
    for (const h of hits) for (const n of store.neighbors(h.id)) connections.add(n.id);
    // Unearthed: concepts c1,c2, fact f2, file graph.ts — none explicitly asked for
    expect(connections.has("c1")).toBe(true);
    expect(connections.has("c2")).toBe(true);
    expect(connections.has("file1")).toBe(true);
  });
});
