import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RepoStore } from "../acm-lib/repo-store.ts";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;
let dbPath: string;
let store: RepoStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "repo-store-write-"));
  dbPath = join(dir, "repo.db");
  store = new RepoStore(dbPath);
  store.init();
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

function raw() {
  return new DatabaseSync(dbPath);
}

const ev = (over: Partial<any> = {}) => ({
  id: "e1",
  toolName: "read",
  keyTerms: "acm ladybug sqlite",
  eventType: "tool_result",
  files: ["acm.ts"],
  sessionId: "s1",
  timestamp: 1000,
  summary: "read the acm file",
  ...over,
});

describe("RepoStore.registerSession", () => {
  it("stores a session node with cwd, gitRoot, startTime", () => {
    store.registerSession({ id: "s1", startTime: 500, cwd: "/repo/wt-a", gitRoot: "/repo" });
    const db = raw();
    const row = db.prepare("SELECT * FROM nodes WHERE type='session' AND id='s1'").get() as any;
    db.close();
    expect(row).toBeTruthy();
    expect(row.ts).toBe(500);
  });
});

describe("RepoStore.writeEvent", () => {
  it("upserts a tool_result node carrying all event fields", () => {
    store.writeEvent(ev());
    const db = raw();
    const n = db.prepare("SELECT * FROM nodes WHERE id='e1'").get() as any;
    db.close();
    expect(n.type).toBe("tool_result");
    expect(n.label).toBe("read");
    expect(n.body).toBe("acm ladybug sqlite");
    expect(n.event_type).toBe("tool_result");
    expect(n.summary).toBe("read the acm file");
    expect(n.session).toBe("s1");
    expect(n.ts).toBe(1000);
  });

  it("MERGE semantics: re-writing same id updates, not duplicates", () => {
    store.writeEvent(ev());
    store.writeEvent(ev({ toolName: "bash", summary: "changed" }));
    const db = raw();
    const cnt = db.prepare("SELECT count(*) c FROM nodes WHERE id='e1'").get() as any;
    const n = db.prepare("SELECT * FROM nodes WHERE id='e1'").get() as any;
    db.close();
    expect(cnt.c).toBe(1);
    expect(n.label).toBe("bash");
    expect(n.summary).toBe("changed");
  });

  it("creates a file node + References edge per file", () => {
    store.writeEvent(ev({ files: ["a.ts", "b.ts"] }));
    const db = raw();
    const files = (db.prepare("SELECT label FROM nodes WHERE type='file' ORDER BY label").all() as any[]).map((r) => r.label);
    const refs = db.prepare("SELECT count(*) c FROM edges WHERE src='e1' AND rel='references'").get() as any;
    db.close();
    expect(files).toEqual(["a.ts", "b.ts"]);
    expect(refs.c).toBe(2);
  });

  it("links the event to its session via belongs_to edge", () => {
    store.registerSession({ id: "s1", startTime: 500, cwd: "/repo", gitRoot: "/repo" });
    store.writeEvent(ev());
    const db = raw();
    const e = db.prepare("SELECT * FROM edges WHERE src='e1' AND dst='s1' AND rel='belongs_to'").get() as any;
    db.close();
    expect(e).toBeTruthy();
  });

  it("chains consecutive events in the same session with a follows edge", () => {
    store.writeEvent(ev({ id: "e1" }));
    store.writeEvent(ev({ id: "e2" }));
    const db = raw();
    const f = db.prepare("SELECT * FROM edges WHERE src='e1' AND dst='e2' AND rel='follows'").get() as any;
    db.close();
    expect(f).toBeTruthy();
  });

  it("does NOT chain across different sessions", () => {
    store.writeEvent(ev({ id: "e1", sessionId: "s1" }));
    store.writeEvent(ev({ id: "e2", sessionId: "s2" }));
    const db = raw();
    const f = db.prepare("SELECT count(*) c FROM edges WHERE rel='follows'").get() as any;
    db.close();
    expect(f.c).toBe(0);
  });

  it("indexes keyTerms into FTS for later search", () => {
    store.writeEvent(ev({ id: "e1", keyTerms: "corruption recovery" }));
    const db = raw();
    const hit = db.prepare("SELECT id FROM nodes_fts WHERE nodes_fts MATCH 'corruption'").all() as any[];
    db.close();
    expect(hit.map((h) => h.id)).toContain("e1");
  });

  it("records worktree provenance when provided", () => {
    store.writeEvent(ev({ id: "e1", worktree: "/repo/wt-a" }));
    const db = raw();
    const n = db.prepare("SELECT worktree FROM nodes WHERE id='e1'").get() as any;
    db.close();
    expect(n.worktree).toBe("/repo/wt-a");
  });
});

describe("RepoStore.flushWrites", () => {
  it("is a no-op that never throws (writes are immediate)", () => {
    store.writeEvent(ev());
    expect(() => store.flushWrites()).not.toThrow();
  });
});
