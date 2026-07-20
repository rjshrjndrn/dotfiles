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

  private filesFor(id: string): string[] {
    return (
      this.conn()
        .prepare(
          `SELECT n.label AS label FROM edges e JOIN nodes n ON n.id = e.dst
           WHERE e.src = ? AND e.rel = 'references' ORDER BY n.label`,
        )
        .all(id) as any[]
    ).map((r) => r.label);
  }

  private toEvent(row: any): RepoEvent {
    return {
      id: row.id,
      toolName: row.label,
      keyTerms: row.body,
      eventType: row.event_type,
      files: this.filesFor(row.id),
      sessionId: row.session,
      timestamp: row.ts,
      summary: row.summary ?? "",
    };
  }

  queryByFile(filePath: string): RepoEvent[] {
    const rows = this.conn()
      .prepare(
        `SELECT n.* FROM nodes n JOIN edges e ON e.src = n.id
         WHERE e.rel = 'references' AND e.dst = ? AND n.type = 'tool_result'
         ORDER BY n.ts DESC`,
      )
      .all(this.fileNodeId(filePath)) as any[];
    return rows.map((r) => this.toEvent(r));
  }

  queryByKeyword(keyword: string): RepoEvent[] {
    const words = keyword.toLowerCase().split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) return [];
    const clause = words.map(() => "(lower(body) LIKE ? OR lower(summary) LIKE ?)").join(" OR ");
    const args: string[] = [];
    for (const w of words) args.push(`%${w}%`, `%${w}%`);
    const rows = this.conn()
      .prepare(`SELECT * FROM nodes WHERE type = 'tool_result' AND (${clause}) ORDER BY ts DESC`)
      .all(...args) as any[];
    return rows.map((r) => this.toEvent(r));
  }

  getRelated(id: string): RepoEvent[] {
    const rows = this.conn()
      .prepare(
        `SELECT DISTINCT n.* FROM nodes n JOIN edges e ON e.src = n.id
         WHERE e.rel = 'references' AND n.type = 'tool_result' AND n.id <> ?
           AND e.dst IN (SELECT dst FROM edges WHERE src = ? AND rel = 'references')
         ORDER BY n.ts DESC`,
      )
      .all(id, id) as any[];
    return rows.map((r) => this.toEvent(r));
  }

  getSequence(id: string, direction: "forward" | "backward" = "forward"): RepoEvent[] {
    const sql =
      direction === "forward"
        ? `SELECT n.* FROM nodes n JOIN edges e ON e.dst = n.id
           WHERE e.rel = 'follows' AND e.src = ? ORDER BY n.ts ASC`
        : `SELECT n.* FROM nodes n JOIN edges e ON e.src = n.id
           WHERE e.rel = 'follows' AND e.dst = ? ORDER BY n.ts DESC`;
    const rows = this.conn().prepare(sql).all(id) as any[];
    return rows.map((r) => this.toEvent(r));
  }

  getSessions(): RepoSession[] {
    return (
      this.conn().prepare("SELECT * FROM nodes WHERE type = 'session' ORDER BY ts DESC").all() as any[]
    ).map((r) => ({ id: r.id, startTime: r.ts, cwd: r.label, gitRoot: r.body }));
  }

  getSessionEvents(sessionId: string): RepoEvent[] {
    const rows = this.conn()
      .prepare("SELECT * FROM nodes WHERE type = 'tool_result' AND session = ? ORDER BY ts ASC")
      .all(sessionId) as any[];
    return rows.map((r) => this.toEvent(r));
  }

  queryByEventType(eventType: string, limit = 20): RepoEvent[] {
    const rows = this.conn()
      .prepare(
        "SELECT * FROM nodes WHERE type = 'tool_result' AND event_type = ? ORDER BY ts DESC LIMIT ?",
      )
      .all(eventType, limit) as any[];
    return rows.map((r) => this.toEvent(r));
  }

  precheckFile(filePath: string): {
    eventCount: number;
    lastTouched: number;
    sessions: string[];
    recentKeyTerms: string[];
  } {
    const events = this.queryByFile(filePath);
    if (events.length === 0) return { eventCount: 0, lastTouched: 0, sessions: [], recentKeyTerms: [] };
    return {
      eventCount: events.length,
      lastTouched: Math.max(...events.map((e) => e.timestamp)),
      sessions: [...new Set(events.map((e) => e.sessionId))],
      recentKeyTerms: events
        .slice(0, 5)
        .flatMap((e) => e.keyTerms.split(/\s+/))
        .filter((w, i, arr) => w.length > 0 && arr.indexOf(w) === i)
        .slice(0, 10),
    };
  }

  getStats(): { events: number; files: number; sessions: number } {
    const c = (t: string) =>
      (this.conn().prepare("SELECT count(*) AS c FROM nodes WHERE type = ?").get(t) as any).c as number;
    return { events: c("tool_result"), files: c("file"), sessions: c("session") };
  }

  getHotFiles(limit = 10): { path: string; refCount: number }[] {
    return (
      this.conn()
        .prepare(
          `SELECT n.label AS path, count(*) AS refCount
           FROM edges e JOIN nodes n ON n.id = e.dst
           WHERE e.rel = 'references' GROUP BY e.dst
           ORDER BY refCount DESC LIMIT ?`,
        )
        .all(limit) as any[]
    ).map((r) => ({ path: r.path, refCount: r.refCount }));
  }

  deleteEvents(ids: string[]): number {
    if (ids.length === 0) return 0;
    const db = this.conn();
    let deleted = 0;
    for (const id of ids) {
      db.prepare("DELETE FROM edges WHERE src = ? OR dst = ?").run(id, id);
      db.prepare("DELETE FROM nodes_fts WHERE id = ?").run(id);
      const res = db.prepare("DELETE FROM nodes WHERE id = ? AND type = 'tool_result'").run(id);
      if (Number(res.changes) > 0) {
        deleted++;
        this.lastPerSession.forEach((v, k) => {
          if (v === id) this.lastPerSession.delete(k);
        });
      }
    }
    // Orphan-clean file nodes no longer referenced by any event.
    db.prepare(
      `DELETE FROM nodes WHERE type = 'file'
       AND id NOT IN (SELECT dst FROM edges WHERE rel = 'references')`,
    ).run();
    return deleted;
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
