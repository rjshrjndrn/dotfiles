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
  ts          INTEGER NOT NULL,
  expires_at  INTEGER                 -- explicit TTL for facts; null = never
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

  // Build an FTS5 OR query from free text: each whitespace-delimited term is
  // quoted (so punctuation can't break MATCH) and combined with OR, matching
  // the legacy "any word" search contract.
  private ftsQuery(text: string): string {
    return text
      .trim()
      .split(/\s+/)
      .filter((t) => t.length > 0)
      .map((t) => `"${t.replace(/"/g, '""')}"`)
      .join(" OR ");
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
    // Session-scoped events link to their session; the session graph passes an
    // empty sessionId (single global chain) and has no session node to link.
    if (event.sessionId) {
      db.prepare(
        "INSERT INTO edges(src, dst, rel, session, ts) VALUES(?, ?, 'belongs_to', ?, ?)",
      ).run(event.id, event.sessionId, event.sessionId, event.timestamp);
    }

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

  getSequence(
    id: string,
    direction: "forward" | "backward" = "forward",
    maxDepth = 1,
  ): RepoEvent[] {
    // Walk the follows chain up to maxDepth hops (cycle-safe via UNION).
    const seed =
      direction === "forward"
        ? "SELECT dst AS id, 1 AS depth FROM edges WHERE src = ? AND rel = 'follows'"
        : "SELECT src AS id, 1 AS depth FROM edges WHERE dst = ? AND rel = 'follows'";
    const step =
      direction === "forward"
        ? "SELECT e.dst, s.depth + 1 FROM edges e JOIN seq s ON e.src = s.id WHERE e.rel = 'follows' AND s.depth < ?"
        : "SELECT e.src, s.depth + 1 FROM edges e JOIN seq s ON e.dst = s.id WHERE e.rel = 'follows' AND s.depth < ?";
    const order = direction === "forward" ? "ASC" : "DESC";
    const sql =
      `WITH RECURSIVE seq(id, depth) AS (${seed} UNION ${step})
       SELECT DISTINCT n.* FROM seq JOIN nodes n ON n.id = seq.id
       ORDER BY n.ts ${order}`;
    const rows = this.conn().prepare(sql).all(id, maxDepth) as any[];
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

  // ---- Knowledge-graph layer: facts, relations, discovery ----

  addNode(node: {
    id: string;
    type: string;
    label: string;
    body?: string;
    session?: string;
    worktree?: string;
    timestamp?: number;
    expiresAt?: number;
  }): void {
    const db = this.conn();
    const body = node.body ?? "";
    const ts = node.timestamp ?? Date.now();
    db.prepare(
      `INSERT INTO nodes(id, type, label, body, session, worktree, ts, expires_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         type = excluded.type, label = excluded.label, body = excluded.body,
         session = excluded.session, worktree = excluded.worktree, ts = excluded.ts,
         expires_at = excluded.expires_at`,
    ).run(
      node.id,
      node.type,
      node.label,
      body,
      node.session ?? null,
      node.worktree ?? null,
      ts,
      node.expiresAt ?? null,
    );
    this.upsertFts(node.id, node.label, body);
  }

  addRelation(src: string, dst: string, rel: string, opts: { session?: string; timestamp?: number } = {}): void {
    this.conn()
      .prepare("INSERT INTO edges(src, dst, rel, session, ts) VALUES(?, ?, ?, ?, ?)")
      .run(src, dst, rel, opts.session ?? null, opts.timestamp ?? Date.now());
  }

  search(query: string, opts: { types?: string[]; limit?: number } = {}): {
    id: string;
    type: string;
    label: string;
    body: string;
  }[] {
    const q = this.ftsQuery(query);
    if (!q) return [];
    const limit = opts.limit ?? 20;
    let sql =
      `SELECT n.id, n.type, n.label, n.body FROM nodes_fts f
       JOIN nodes n ON n.id = f.id
       WHERE nodes_fts MATCH ?`;
    const args: any[] = [q];
    if (opts.types && opts.types.length > 0) {
      sql += ` AND n.type IN (${opts.types.map(() => "?").join(",")})`;
      args.push(...opts.types);
    }
    sql += " ORDER BY bm25(nodes_fts) LIMIT ?";
    args.push(limit);
    return this.conn().prepare(sql).all(...args) as any[];
  }

  neighbors(id: string, opts: { rel?: string; direction?: "out" | "in" } = {}): {
    id: string;
    type: string;
    label: string;
    rel: string;
  }[] {
    const dir = opts.direction ?? "out";
    const joinCol = dir === "out" ? "e.dst" : "e.src";
    const matchCol = dir === "out" ? "e.src" : "e.dst";
    let sql =
      `SELECT n.id, n.type, n.label, e.rel FROM edges e JOIN nodes n ON n.id = ${joinCol}
       WHERE ${matchCol} = ?`;
    const args: any[] = [id];
    if (opts.rel) {
      sql += " AND e.rel = ?";
      args.push(opts.rel);
    }
    sql += " ORDER BY e.rel, n.id";
    return this.conn().prepare(sql).all(...args) as any[];
  }

  traverse(id: string, opts: { maxDepth?: number; rel?: string } = {}): {
    id: string;
    type: string;
    label: string;
    depth: number;
  }[] {
    const maxDepth = opts.maxDepth ?? 3;
    const relFilter = opts.rel ? "AND e.rel = ?" : "";
    const sql =
      `WITH RECURSIVE reach(id, depth) AS (
         SELECT ?, 0
         UNION
         SELECT e.dst, r.depth + 1 FROM edges e JOIN reach r ON e.src = r.id
         WHERE r.depth < ? ${relFilter}
       )
       SELECT n.id, n.type, n.label, min(reach.depth) AS depth
       FROM reach JOIN nodes n ON n.id = reach.id
       WHERE reach.id <> ?
       GROUP BY n.id ORDER BY depth, n.id`;
    const args: any[] = opts.rel ? [id, maxDepth, opts.rel, id] : [id, maxDepth, id];
    return this.conn().prepare(sql).all(...args) as any[];
  }

  // All distinct file paths, sorted — used by the session graph summary.
  fileList(): string[] {
    return (
      this.conn().prepare("SELECT label FROM nodes WHERE type = 'file' ORDER BY label").all() as any[]
    ).map((r) => r.label);
  }

  // FTS over tool_result events, returning the reconstructed event plus its
  // bm25 rank (lower is a better match).
  ftsSearchEvents(query: string, limit = 20): { event: RepoEvent; score: number }[] {
    const q = this.ftsQuery(query);
    if (!q) return [];
    // bm25 returns more-negative for better matches; negate so callers get a
    // positive relevance score where higher = better, sorted descending.
    const rows = this.conn()
      .prepare(
        `SELECT n.*, -bm25(nodes_fts) AS score FROM nodes_fts f
         JOIN nodes n ON n.id = f.id
         WHERE nodes_fts MATCH ? AND n.type = 'tool_result'
         ORDER BY score DESC LIMIT ?`,
      )
      .all(q, limit) as any[];
    return rows.map((r) => ({ event: this.toEvent(r), score: r.score }));
  }

  // Wipe all data (session graph reset between runs/tests).
  clear(): void {
    const db = this.conn();
    db.exec("DELETE FROM edges; DELETE FROM nodes; DELETE FROM nodes_fts;");
    this.lastPerSession.clear();
  }

  cooccur(id: string, rel: string): { id: string; type: string; label: string }[] {
    return this.conn()
      .prepare(
        `SELECT DISTINCT n.id, n.type, n.label
         FROM edges e1 JOIN edges e2 ON e1.dst = e2.dst
         JOIN nodes n ON n.id = e2.src
         WHERE e1.src = ? AND e2.src <> ? AND e1.rel = ? AND e2.rel = ?
         ORDER BY n.id`,
      )
      .all(id, id, rel, rel) as any[];
  }

  init(): void {
    if (this.db) return; // idempotent
    mkdirSync(dirname(this.dbPath), { recursive: true });
    const db = new DatabaseSync(this.dbPath);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec(SCHEMA);
    this.migrate(db);
    this.db = db;
  }

  // Idempotent, additive schema migrations for dbs created by older versions.
  private migrate(db: DatabaseSync): void {
    const cols = (db.prepare("PRAGMA table_info(nodes)").all() as any[]).map((r) => r.name);
    if (!cols.includes("expires_at")) {
      db.exec("ALTER TABLE nodes ADD COLUMN expires_at INTEGER");
    }
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
