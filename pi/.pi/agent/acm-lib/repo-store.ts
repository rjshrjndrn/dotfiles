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

export interface RepoEvent {
  id: string;
  toolName: string;
  keyTerms: string;
  eventType: string;
  files: string[];
  sessionId: string;
  timestamp: number;
  summary?: string;
  worktree?: string;
}

export interface RepoSession {
  id: string;
  startTime: number;
  cwd: string;
  gitRoot: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS nodes (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,          -- fact | file | concept | discussion | tool_result | session
  label       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  event_type  TEXT,                   -- tool_result events only
  summary     TEXT,
  session     TEXT,
  worktree    TEXT,
  ts          INTEGER NOT NULL
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
  private lastPerSession: Map<string, string> = new Map();

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  private conn(): DatabaseSync {
    if (!this.db) throw new Error("RepoStore not initialized");
    return this.db;
  }

  private upsertFts(id: string, label: string, body: string): void {
    const db = this.conn();
    db.prepare("DELETE FROM nodes_fts WHERE id = ?").run(id);
    db.prepare("INSERT INTO nodes_fts(id, label, body) VALUES(?, ?, ?)").run(id, label, body);
  }

  private fileNodeId(path: string): string {
    return "file::" + path;
  }

  registerSession(info: RepoSession): void {
    const db = this.conn();
    db.prepare(
      `INSERT INTO nodes(id, type, label, body, ts) VALUES(?, 'session', ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET label = excluded.label, body = excluded.body, ts = excluded.ts`,
    ).run(info.id, info.cwd, info.gitRoot, info.startTime);
  }

  writeEvent(event: RepoEvent): void {
    const db = this.conn();
    const prevId = this.lastPerSession.get(event.sessionId);
    this.lastPerSession.set(event.sessionId, event.id);

    // Upsert the tool_result node.
    db.prepare(
      `INSERT INTO nodes(id, type, label, body, event_type, summary, session, worktree, ts)
       VALUES(?, 'tool_result', ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         label = excluded.label, body = excluded.body, event_type = excluded.event_type,
         summary = excluded.summary, session = excluded.session,
         worktree = excluded.worktree, ts = excluded.ts`,
    ).run(
      event.id,
      event.toolName,
      event.keyTerms,
      event.eventType,
      event.summary ?? "",
      event.sessionId,
      event.worktree ?? null,
      event.timestamp,
    );
    this.upsertFts(event.id, event.toolName, event.keyTerms);

    // Rebuild file/session edges for this event (idempotent on re-write).
    db.prepare("DELETE FROM edges WHERE src = ? AND rel IN ('references', 'belongs_to')").run(event.id);
    for (const fp of event.files) {
      const fid = this.fileNodeId(fp);
      db.prepare(
        "INSERT INTO nodes(id, type, label, ts) VALUES(?, 'file', ?, ?) ON CONFLICT(id) DO NOTHING",
      ).run(fid, fp, event.timestamp);
      db.prepare(
        "INSERT INTO edges(src, dst, rel, session, ts) VALUES(?, ?, 'references', ?, ?)",
      ).run(event.id, fid, event.sessionId, event.timestamp);
    }
    db.prepare(
      "INSERT INTO edges(src, dst, rel, session, ts) VALUES(?, ?, 'belongs_to', ?, ?)",
    ).run(event.id, event.sessionId, event.sessionId, event.timestamp);

    // Chain within the same session only.
    if (prevId) {
      db.prepare(
        "INSERT INTO edges(src, dst, rel, session, ts) VALUES(?, ?, 'follows', ?, ?)",
      ).run(prevId, event.id, event.sessionId, event.timestamp);
    }
  }

  // Writes are immediate and durable under WAL; nothing to flush.
  flushWrites(): void {}

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
