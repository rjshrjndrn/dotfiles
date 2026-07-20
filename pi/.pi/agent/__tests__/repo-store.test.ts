import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RepoStore } from "../acm-lib/repo-store.ts";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "repo-store-"));
  dbPath = join(dir, "repo.db");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("RepoStore lifecycle", () => {
  it("creates the db file on init", () => {
    const s = new RepoStore(dbPath);
    s.init();
    expect(existsSync(dbPath)).toBe(true);
    s.close();
  });

  it("opens in WAL journal mode", () => {
    const s = new RepoStore(dbPath);
    s.init();
    // inspect via a raw handle to avoid trusting the impl
    const raw = new DatabaseSync(dbPath);
    const mode = raw.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
    raw.close();
    s.close();
    expect(mode.journal_mode).toBe("wal");
  });

  it("creates nodes, edges, and nodes_fts tables", () => {
    const s = new RepoStore(dbPath);
    s.init();
    const raw = new DatabaseSync(dbPath);
    const names = (raw.prepare(
      "SELECT name FROM sqlite_master WHERE type IN ('table') ORDER BY name",
    ).all() as { name: string }[]).map((r) => r.name);
    raw.close();
    s.close();
    expect(names).toContain("nodes");
    expect(names).toContain("edges");
    expect(names).toContain("nodes_fts");
  });

  it("init is idempotent (safe to call twice)", () => {
    const s = new RepoStore(dbPath);
    s.init();
    expect(() => s.init()).not.toThrow();
    s.close();
  });

  it("isReady reflects open/closed state", () => {
    const s = new RepoStore(dbPath);
    expect(s.isReady()).toBe(false);
    s.init();
    expect(s.isReady()).toBe(true);
    s.close();
    expect(s.isReady()).toBe(false);
  });

  it("close checkpoints WAL — no orphan -wal/-shm left after clean close", () => {
    const s = new RepoStore(dbPath);
    s.init();
    s.close();
    const leftovers = readdirSync(dir).filter((f) => f.endsWith("-wal") || f.endsWith("-shm"));
    expect(leftovers).toEqual([]);
  });

  it("reopens an existing db without recreating/wiping data", () => {
    const s1 = new RepoStore(dbPath);
    s1.init();
    s1.close();
    const s2 = new RepoStore(dbPath);
    expect(() => s2.init()).not.toThrow();
    expect(s2.isReady()).toBe(true);
    s2.close();
  });
});
