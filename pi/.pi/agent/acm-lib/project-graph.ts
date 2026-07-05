/**
 * ProjectGraph — Project-level LadybugDB with flock concurrency.
 *
 * Used by ACM to persist cross-session knowledge: which files were touched,
 * what tools ran, and which sessions operated on a project. This lets new
 * sessions inherit context (file pre-checks, hot-file detection, session
 * history) without re-scanning, enabling project-aware memory across agent
 * restarts and concurrent sessions.
 *
 * Persistent graph DB scoped to a git root.
 *
 * Two modes:
 * - exclusive (default): single read-write connection. Fast, no locking.
 *   Use when only one session writes to this DB.
 * - shared: read-only connection + flock for writes.
 *   Use when multiple sessions access same DB.
 *   Writes batch into flushWrites() to minimize open/close cycles.
 */

import { mkdirSync, openSync, closeSync, appendFileSync } from "node:fs";
import { dirname } from "node:path";

const DEBUG = !!process.env.ACM_PROJECT_DEBUG;
const LOG_FILE = "/tmp/acm-project-graph.log";
// Buffer size for DB instances. Smaller = less mmap pressure for open/close cycles.
const BUFFER_SIZE = 64 << 20; // 64MB

function log(msg: string): void {
  if (!DEBUG) return;
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { appendFileSync(LOG_FILE, line); } catch { /* non-fatal */ }
}

export interface ProjectGraphEvent {
  id: string;
  toolName: string;
  keyTerms: string;
  eventType: string;
  files: string[];
  sessionId: string;
  timestamp: number;
  summary?: string;
}

export interface SessionInfo {
  id: string;
  startTime: number;
  cwd: string;
  gitRoot: string;
}

export interface FilePrecheck {
  eventCount: number;
  lastTouched: number;
  sessions: string[];
  recentKeyTerms: string[];
}

export interface HotFile {
  path: string;
  refCount: number;
}

function escapeStr(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export class ProjectGraph {
  private dbPath: string;
  private lockPath: string;
  private db: any = null;
  private conn: any = null;
  private ready = false;
  private lastInsertedPerSession: Map<string, string> = new Map();
  private lbugModule: any = null;
  private mode: "exclusive" | "shared";
  private pendingWrites: Array<(conn: any) => Promise<void>> = [];
  private writeDb: any = null;
  private writeConn: any = null;

  constructor(dbPath: string, mode: "exclusive" | "shared" = "exclusive") {
    this.dbPath = dbPath;
    this.lockPath = dbPath + ".lock";
    this.mode = mode;
  }

  isReady(): boolean {
    return this.ready;
  }

  async init(): Promise<void> {
    mkdirSync(dirname(this.dbPath), { recursive: true });
    this.lbugModule = await import("@ladybugdb/core");

    if (this.mode === "exclusive") {
      // Single read-write connection, no locking
      log(`init: exclusive mode at ${this.dbPath}`);
      this.db = new this.lbugModule.Database(this.dbPath, BUFFER_SIZE);
      this.conn = new this.lbugModule.Connection(this.db);
      await this.ensureSchema(this.conn);
    } else {
      // Shared mode: create schema via flock, then open read-only
      log(`init: shared mode at ${this.dbPath}`);
      await this.withFlock(async () => {
        const db = new this.lbugModule.Database(this.dbPath, BUFFER_SIZE);
        const conn = new this.lbugModule.Connection(db);
        await this.ensureSchema(conn);
        db.close();
      });
      this.db = new this.lbugModule.Database(this.dbPath, BUFFER_SIZE, undefined, true);
      this.conn = new this.lbugModule.Connection(this.db);
    }

    this.ready = true;
    log(`init: ready`);
  }

  async close(): Promise<void> {
    log(`close: shutting down`);
    // Flush any pending writes
    if (this.pendingWrites.length > 0) {
      await this.flushWrites();
    }
    this.conn = null;
    if (this.db) { this.db.close(); this.db = null; }
    if (this.writeDb) { this.writeDb.close(); this.writeDb = null; this.writeConn = null; }
    this.ready = false;
    this.lastInsertedPerSession.clear();
  }

  /**
   * Acquire flock, run callback, release. For shared mode writes.
   */
  private async withFlock(fn: () => Promise<void>): Promise<void> {
    let flock: typeof import("fs-ext").flock;
    try {
      flock = (await import("fs-ext")).flock;
    } catch {
      // fs-ext not available, run without locking
      await fn();
      return;
    }

    const lockFd = openSync(this.lockPath, "w");
    log(`flock: acquiring`);
    await new Promise<void>((resolve, reject) => {
      flock(lockFd, "ex", (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
    log(`flock: acquired`);

    try {
      await fn();
    } finally {
      await new Promise<void>((resolve) => {
        flock(lockFd, "un", () => {
          closeSync(lockFd);
          resolve();
        });
      });
      log(`flock: released`);
    }
  }

  private async ensureSchema(conn: any): Promise<void> {
    await conn.query(`CREATE NODE TABLE IF NOT EXISTS ToolResult(
      id STRING PRIMARY KEY, toolName STRING, keyTerms STRING,
      eventType STRING, sessionId STRING, timestamp INT64, summary STRING
    )`);
    await conn.query(`CREATE NODE TABLE IF NOT EXISTS FilePath(path STRING PRIMARY KEY)`);
    await conn.query(`CREATE NODE TABLE IF NOT EXISTS Session(
      id STRING PRIMARY KEY, startTime INT64, cwd STRING, gitRoot STRING
    )`);
    await conn.query(`CREATE REL TABLE IF NOT EXISTS References(FROM ToolResult TO FilePath)`);
    await conn.query(`CREATE REL TABLE IF NOT EXISTS Follows(FROM ToolResult TO ToolResult)`);
    await conn.query(`CREATE REL TABLE IF NOT EXISTS BelongsTo(FROM ToolResult TO Session)`);
  }

  // ── Writes ──────────────────────────────────────────────

  async writeEvent(event: ProjectGraphEvent): Promise<void> {
    const prevId = this.lastInsertedPerSession.get(event.sessionId);
    this.lastInsertedPerSession.set(event.sessionId, event.id);
    log(`writeEvent: ${event.id} type=${event.eventType} files=${event.files.join(",")}`);

    const op = async (conn: any) => {
      await conn.query(
        `MERGE (t:ToolResult {id: '${escapeStr(event.id)}'})
         SET t.toolName = '${escapeStr(event.toolName)}',
             t.keyTerms = '${escapeStr(event.keyTerms)}',
             t.eventType = '${escapeStr(event.eventType)}',
             t.sessionId = '${escapeStr(event.sessionId)}',
             t.timestamp = ${event.timestamp},
             t.summary = '${escapeStr(event.summary ?? "")}'`
      );
      for (const fp of event.files) {
        await conn.query(`MERGE (f:FilePath {path: '${escapeStr(fp)}'})`);
        await conn.query(
          `MATCH (t:ToolResult {id: '${escapeStr(event.id)}'}), (f:FilePath {path: '${escapeStr(fp)}'})
           MERGE (t)-[:References]->(f)`
        );
      }
      await conn.query(
        `MATCH (t:ToolResult {id: '${escapeStr(event.id)}'}), (s:Session {id: '${escapeStr(event.sessionId)}'})
         MERGE (t)-[:BelongsTo]->(s)`
      );
      if (prevId) {
        await conn.query(
          `MATCH (prev:ToolResult {id: '${escapeStr(prevId)}'}), (curr:ToolResult {id: '${escapeStr(event.id)}'})
           CREATE (prev)-[:Follows]->(curr)`
        );
      }
    };

    if (this.mode === "exclusive") {
      await op(this.conn);
    } else {
      this.pendingWrites.push(op);
      // Auto-flush (can be batched in production with setTimeout)
      await this.flushWrites();
    }
  }

  async registerSession(info: SessionInfo): Promise<void> {
    log(`registerSession: ${info.id} cwd=${info.cwd}`);

    const op = async (conn: any) => {
      await conn.query(
        `MERGE (s:Session {id: '${escapeStr(info.id)}'})
         SET s.startTime = ${info.startTime},
             s.cwd = '${escapeStr(info.cwd)}',
             s.gitRoot = '${escapeStr(info.gitRoot)}'`
      );
    };

    if (this.mode === "exclusive") {
      await op(this.conn);
    } else {
      this.pendingWrites.push(op);
      await this.flushWrites();
    }
  }

  /**
   * Flush all pending writes in a single flock cycle.
   * In shared mode: flock → execute on RW conn → unlock.
   * Keeps a persistent RW connection to avoid mmap exhaustion from open/close.
   * In exclusive mode: no-op (writes go directly to conn).
   */
  async flushWrites(): Promise<void> {
    if (this.mode === "exclusive" || this.pendingWrites.length === 0) return;

    const ops = this.pendingWrites.splice(0);
    log(`flushWrites: ${ops.length} operations`);

    // Lazy-init the write connection (kept alive for session lifetime)
    if (!this.writeDb) {
      this.writeDb = new this.lbugModule.Database(this.dbPath, BUFFER_SIZE);
      this.writeConn = new this.lbugModule.Connection(this.writeDb);
      await this.ensureSchema(this.writeConn);
    }

    await this.withFlock(async () => {
      for (const op of ops) {
        await op(this.writeConn);
      }
    });

    // Reopen read-only to see new data (LDB read-only snapshots at open time)
    if (this.conn) this.conn = null;
    if (this.db) { this.db.close(); this.db = null; }
    this.db = new this.lbugModule.Database(this.dbPath, BUFFER_SIZE, undefined, true);
    this.conn = new this.lbugModule.Connection(this.db);
  }

  // ── Reads (no lock needed) ──────────────────────────────

  async queryByFile(filePath: string): Promise<ProjectGraphEvent[]> {
    this.ensureReady();
    const result = await this.conn.query(
      `MATCH (t:ToolResult)-[:References]->(f:FilePath {path: '${escapeStr(filePath)}'})
       OPTIONAL MATCH (t)-[:References]->(f2:FilePath)
       RETURN t.id, t.toolName, t.keyTerms, t.eventType, t.sessionId, t.timestamp, t.summary,
              collect(DISTINCT f2.path) AS files
       ORDER BY t.timestamp DESC`
    );
    return this.rowsToEvents(await result.getAll());
  }

  async queryByKeyword(keyword: string): Promise<ProjectGraphEvent[]> {
    this.ensureReady();
    const words = keyword.toLowerCase().split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) return [];

    const conditions = words
      .map((w) => `(lower(t.keyTerms) CONTAINS '${escapeStr(w)}' OR lower(t.summary) CONTAINS '${escapeStr(w)}')`)
      .join(" OR ");

    const result = await this.conn.query(
      `MATCH (t:ToolResult)
       WHERE ${conditions}
       OPTIONAL MATCH (t)-[:References]->(f:FilePath)
       RETURN t.id, t.toolName, t.keyTerms, t.eventType, t.sessionId, t.timestamp, t.summary,
              collect(DISTINCT f.path) AS files
       ORDER BY t.timestamp DESC`
    );
    return this.rowsToEvents(await result.getAll());
  }

  async getRelated(id: string): Promise<ProjectGraphEvent[]> {
    this.ensureReady();
    const result = await this.conn.query(
      `MATCH (t:ToolResult {id: '${escapeStr(id)}'})-[:References]->(f:FilePath)<-[:References]-(other:ToolResult)
       WHERE other.id <> '${escapeStr(id)}'
       OPTIONAL MATCH (other)-[:References]->(f2:FilePath)
       RETURN DISTINCT other.id, other.toolName, other.keyTerms, other.eventType,
              other.sessionId, other.timestamp, other.summary,
              collect(DISTINCT f2.path) AS files
       ORDER BY other.timestamp DESC`
    );
    return this.rowsToEvents(await result.getAll(), "other");
  }

  async getSequence(id: string, direction: "forward" | "backward" = "forward"): Promise<ProjectGraphEvent[]> {
    this.ensureReady();
    const rel = direction === "forward" ? "-[:Follows]->" : "<-[:Follows]-";
    const result = await this.conn.query(
      `MATCH (start:ToolResult {id: '${escapeStr(id)}'})${rel}(other:ToolResult)
       OPTIONAL MATCH (other)-[:References]->(f:FilePath)
       RETURN DISTINCT other.id, other.toolName, other.keyTerms, other.eventType,
              other.sessionId, other.timestamp, other.summary,
              collect(DISTINCT f.path) AS files
       ORDER BY other.timestamp ${direction === "forward" ? "ASC" : "DESC"}`
    );
    return this.rowsToEvents(await result.getAll(), "other");
  }

  async getSessions(): Promise<SessionInfo[]> {
    this.ensureReady();
    const result = await this.conn.query(
      `MATCH (s:Session) RETURN s.id, s.startTime, s.cwd, s.gitRoot ORDER BY s.startTime DESC`
    );
    return (await result.getAll()).map((r: any) => ({
      id: r["s.id"], startTime: Number(r["s.startTime"]), cwd: r["s.cwd"], gitRoot: r["s.gitRoot"],
    }));
  }

  async getSessionEvents(sessionId: string): Promise<ProjectGraphEvent[]> {
    this.ensureReady();
    const result = await this.conn.query(
      `MATCH (t:ToolResult)-[:BelongsTo]->(s:Session {id: '${escapeStr(sessionId)}'})
       OPTIONAL MATCH (t)-[:References]->(f:FilePath)
       RETURN t.id, t.toolName, t.keyTerms, t.eventType, t.sessionId, t.timestamp, t.summary,
              collect(DISTINCT f.path) AS files
       ORDER BY t.timestamp ASC`
    );
    return this.rowsToEvents(await result.getAll());
  }

  async precheckFile(filePath: string): Promise<FilePrecheck> {
    this.ensureReady();
    const events = await this.queryByFile(filePath);
    if (events.length === 0) return { eventCount: 0, lastTouched: 0, sessions: [], recentKeyTerms: [] };

    return {
      eventCount: events.length,
      lastTouched: Math.max(...events.map((e) => e.timestamp)),
      sessions: [...new Set(events.map((e) => e.sessionId))],
      recentKeyTerms: events.slice(0, 5)
        .flatMap((e) => e.keyTerms.split(/\s+/))
        .filter((w, i, arr) => arr.indexOf(w) === i)
        .slice(0, 10),
    };
  }

  async getStats(): Promise<{ events: number; files: number; sessions: number }> {
    this.ensureReady();
    const [er, fr, sr] = await Promise.all([
      this.conn.query("MATCH (n:ToolResult) RETURN count(n) AS c"),
      this.conn.query("MATCH (n:FilePath) RETURN count(n) AS c"),
      this.conn.query("MATCH (n:Session) RETURN count(n) AS c"),
    ]);
    const [eRows, fRows, sRows] = await Promise.all([er.getAll(), fr.getAll(), sr.getAll()]);
    return {
      events: Number(eRows[0]?.c ?? 0),
      files: Number(fRows[0]?.c ?? 0),
      sessions: Number(sRows[0]?.c ?? 0),
    };
  }

  async getHotFiles(limit: number = 10): Promise<HotFile[]> {
    this.ensureReady();
    const result = await this.conn.query(
      `MATCH (t:ToolResult)-[:References]->(f:FilePath)
       RETURN f.path AS path, count(t) AS refCount
       ORDER BY refCount DESC LIMIT ${limit}`
    );
    return (await result.getAll()).map((r: any) => ({ path: r.path, refCount: Number(r.refCount) }));
  }

  // ── Helpers ─────────────────────────────────────────────

  private ensureReady(): void {
    if (!this.ready || !this.conn) throw new Error("ProjectGraph not initialized. Call init() first.");
  }

  private rowsToEvents(rows: any[], prefix: string = "t"): ProjectGraphEvent[] {
    return rows.map((r: any) => ({
      id: r[`${prefix}.id`],
      toolName: r[`${prefix}.toolName`],
      keyTerms: r[`${prefix}.keyTerms`],
      eventType: r[`${prefix}.eventType`],
      sessionId: r[`${prefix}.sessionId`],
      timestamp: Number(r[`${prefix}.timestamp`]),
      summary: r[`${prefix}.summary`] ?? "",
      files: r.files ?? [],
    }));
  }
}
