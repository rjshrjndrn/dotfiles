import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RepoStore } from "../acm-lib/repo-store.ts";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "repo-store-mig-"));
  dbPath = join(dir, "repo.db");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function columns(): string[] {
  const raw = new DatabaseSync(dbPath);
  const cols = (raw.prepare("PRAGMA table_info(nodes)").all() as any[]).map((r) => r.name);
  raw.close();
  return cols;
}

describe("schema: expires_at column for fact TTL", () => {
  it("a freshly created db has the expires_at column", () => {
    const s = new RepoStore(dbPath);
    s.init();
    s.close();
    expect(columns()).toContain("expires_at");
  });

  it("migrates an old db that predates the column (idempotent ALTER on init)", () => {
    // Simulate a pre-TTL db: create the nodes table WITHOUT expires_at.
    const raw = new DatabaseSync(dbPath);
    raw.exec(`CREATE TABLE nodes (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, label TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '', event_type TEXT, summary TEXT,
      session TEXT, worktree TEXT, ts INTEGER NOT NULL
    )`);
    raw.prepare("INSERT INTO nodes(id,type,label,ts) VALUES('n1','fact','keep me',1)").run();
    raw.close();
    expect(columns()).not.toContain("expires_at"); // precondition

    const s = new RepoStore(dbPath);
    s.init(); // must ALTER TABLE ADD COLUMN, not throw, not wipe
    s.close();

    expect(columns()).toContain("expires_at");
    // existing row survives, new column defaults to null
    const raw2 = new DatabaseSync(dbPath);
    const row = raw2.prepare("SELECT id, expires_at FROM nodes WHERE id='n1'").get() as any;
    raw2.close();
    expect(row.id).toBe("n1");
    expect(row.expires_at).toBeNull();
  });

  it("init is safe to run twice on an already-migrated db", () => {
    const s = new RepoStore(dbPath);
    s.init();
    s.close();
    const s2 = new RepoStore(dbPath);
    expect(() => s2.init()).not.toThrow();
    s2.close();
    expect(columns()).toContain("expires_at");
  });
});

describe("addNode persists expiresAt", () => {
  it("stores an explicit expiry on a fact node", () => {
    const s = new RepoStore(dbPath);
    s.init();
    s.addNode({ id: "f1", type: "fact", label: "deploy via X", expiresAt: 5000 });
    s.close();
    const raw = new DatabaseSync(dbPath);
    const row = raw.prepare("SELECT expires_at FROM nodes WHERE id='f1'").get() as any;
    raw.close();
    expect(row.expires_at).toBe(5000);
  });

  it("leaves expires_at null when no expiry given", () => {
    const s = new RepoStore(dbPath);
    s.init();
    s.addNode({ id: "f2", type: "fact", label: "permanent note" });
    s.close();
    const raw = new DatabaseSync(dbPath);
    const row = raw.prepare("SELECT expires_at FROM nodes WHERE id='f2'").get() as any;
    raw.close();
    expect(row.expires_at).toBeNull();
  });
});
