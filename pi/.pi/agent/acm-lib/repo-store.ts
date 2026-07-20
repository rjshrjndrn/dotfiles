// RepoStore: repo-scoped, worktree-shared knowledge store backed by node:sqlite.
//
// Replaces the LadybugDB (Kuzu fork) engine, whose WAL corrupts on abrupt exit
// and gets wiped on next start. SQLite in WAL mode self-recovers after a crash,
// so no data-loss / "delete corrupt db" class exists here.
//
// All worktrees of a repo resolve to one db (see git-root.ts detectRepoRoot),
// giving a single shared, queryable knowledge base across sessions.

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS nodes (
  id        TEXT PRIMARY KEY,
  type      TEXT NOT NULL,          -- fact | file | concept | discussion | tool_result
  label     TEXT NOT NULL,
  body      TEXT NOT NULL DEFAULT '',
  session   TEXT,
  worktree  TEXT,
  ts        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS edges (
  src       TEXT NOT NULL,
  dst       TEXT NOT NULL,
  rel       TEXT NOT NULL,          -- references | follows | relates_to | derived_from
  session   TEXT,
  ts        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_edges_src ON edges(src, rel);
CREATE INDEX IF NOT EXISTS idx_edges_dst ON edges(dst, rel);

CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
  id UNINDEXED, label, body, tokenize='porter'
);
`;

export class RepoStore {
  private dbPath: string;
  private db: DatabaseSync | null = null;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  init(): void {
    if (this.db) return; // idempotent
    mkdirSync(dirname(this.dbPath), { recursive: true });
    const db = new DatabaseSync(this.dbPath);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec(SCHEMA);
    this.db = db;
  }

  isReady(): boolean {
    return this.db !== null;
  }

  close(): void {
    if (!this.db) return;
    // Checkpoint so the WAL folds back into the main db and no -wal/-shm linger.
    try {
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch {
      // best-effort
    }
    this.db.close();
    this.db = null;
  }
}
