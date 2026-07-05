/**
 * ProjectGraph — Project-level LadybugDB.
 *
 * Persistent graph DB scoped to a git root. Stores tool results,
 * file relationships, sessions, and temporal sequences across sessions.
 *
 * MVP: single read-write connection per process.
 * Future: flock-based concurrency for multi-session access.
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface ProjectGraphEvent {
  id: string;
  toolName: string;
  keyTerms: string;
  eventType: string; // decision | investigation | fix | exploration | error
  files: string[];
  sessionId: string;
  timestamp: number;
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
  private db: any = null;
  private conn: any = null;
  private ready = false;
  private lastInsertedPerSession: Map<string, string> = new Map();

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  isReady(): boolean {
    return this.ready;
  }

  async init(): Promise<void> {
    mkdirSync(dirname(this.dbPath), { recursive: true });
    const lbug = await import("@ladybugdb/core");
    this.db = new lbug.Database(this.dbPath, 64 << 20);
    this.conn = new lbug.Connection(this.db);
    await this.ensureSchema(this.conn);
    this.ready = true;
  }

  async close(): Promise<void> {
    this.conn = null;
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.ready = false;
    this.lastInsertedPerSession.clear();
  }

  private async ensureSchema(conn: any): Promise<void> {
    await conn.query(`
      CREATE NODE TABLE IF NOT EXISTS ToolResult(
        id STRING PRIMARY KEY,
        toolName STRING,
        keyTerms STRING,
        eventType STRING,
        sessionId STRING,
        timestamp INT64
      )
    `);
    await conn.query(`
      CREATE NODE TABLE IF NOT EXISTS FilePath(
        path STRING PRIMARY KEY
      )
    `);
    await conn.query(`
      CREATE NODE TABLE IF NOT EXISTS Session(
        id STRING PRIMARY KEY,
        startTime INT64,
        cwd STRING,
        gitRoot STRING
      )
    `);
    await conn.query(
      `CREATE REL TABLE IF NOT EXISTS References(FROM ToolResult TO FilePath)`
    );
    await conn.query(
      `CREATE REL TABLE IF NOT EXISTS Follows(FROM ToolResult TO ToolResult)`
    );
    await conn.query(
      `CREATE REL TABLE IF NOT EXISTS BelongsTo(FROM ToolResult TO Session)`
    );
  }

  // ── Writes ──────────────────────────────────────────────

  async writeEvent(event: ProjectGraphEvent): Promise<void> {
    this.ensureReady();
    const prevId = this.lastInsertedPerSession.get(event.sessionId);

    // Upsert ToolResult
    await this.conn.query(
      `MERGE (t:ToolResult {id: '${escapeStr(event.id)}'})
       SET t.toolName = '${escapeStr(event.toolName)}',
           t.keyTerms = '${escapeStr(event.keyTerms)}',
           t.eventType = '${escapeStr(event.eventType)}',
           t.sessionId = '${escapeStr(event.sessionId)}',
           t.timestamp = ${event.timestamp}`
    );

    // Upsert FilePaths + References
    for (const fp of event.files) {
      await this.conn.query(
        `MERGE (f:FilePath {path: '${escapeStr(fp)}'})`
      );
      await this.conn.query(
        `MATCH (t:ToolResult {id: '${escapeStr(event.id)}'}), (f:FilePath {path: '${escapeStr(fp)}'})
         MERGE (t)-[:References]->(f)`
      );
    }

    // BelongsTo session (if session exists)
    await this.conn.query(
      `MATCH (t:ToolResult {id: '${escapeStr(event.id)}'}), (s:Session {id: '${escapeStr(event.sessionId)}'})
       MERGE (t)-[:BelongsTo]->(s)`
    );

    // Follows edge from previous event in same session
    if (prevId) {
      await this.conn.query(
        `MATCH (prev:ToolResult {id: '${escapeStr(prevId)}'}), (curr:ToolResult {id: '${escapeStr(event.id)}'})
         CREATE (prev)-[:Follows]->(curr)`
      );
    }

    this.lastInsertedPerSession.set(event.sessionId, event.id);
  }

  async registerSession(info: SessionInfo): Promise<void> {
    this.ensureReady();
    await this.conn.query(
      `MERGE (s:Session {id: '${escapeStr(info.id)}'})
       SET s.startTime = ${info.startTime},
           s.cwd = '${escapeStr(info.cwd)}',
           s.gitRoot = '${escapeStr(info.gitRoot)}'`
    );
  }

  // ── Reads ───────────────────────────────────────────────

  async queryByFile(filePath: string): Promise<ProjectGraphEvent[]> {
    this.ensureReady();
    const result = await this.conn.query(
      `MATCH (t:ToolResult)-[:References]->(f:FilePath {path: '${escapeStr(filePath)}'})
       OPTIONAL MATCH (t)-[:References]->(f2:FilePath)
       RETURN t.id, t.toolName, t.keyTerms, t.eventType, t.sessionId, t.timestamp,
              collect(DISTINCT f2.path) AS files
       ORDER BY t.timestamp DESC`
    );
    return this.rowsToEvents(await result.getAll());
  }

  async queryByKeyword(keyword: string): Promise<ProjectGraphEvent[]> {
    this.ensureReady();
    const words = keyword
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 0);
    if (words.length === 0) return [];

    const conditions = words
      .map((w) => `lower(t.keyTerms) CONTAINS '${escapeStr(w)}'`)
      .join(" OR ");

    const result = await this.conn.query(
      `MATCH (t:ToolResult)
       WHERE ${conditions}
       OPTIONAL MATCH (t)-[:References]->(f:FilePath)
       RETURN t.id, t.toolName, t.keyTerms, t.eventType, t.sessionId, t.timestamp,
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
              other.sessionId, other.timestamp,
              collect(DISTINCT f2.path) AS files
       ORDER BY other.timestamp DESC`
    );
    return this.rowsToEvents(await result.getAll(), "other");
  }

  async getSequence(
    id: string,
    direction: "forward" | "backward" = "forward"
  ): Promise<ProjectGraphEvent[]> {
    this.ensureReady();
    const rel = direction === "forward" ? "-[:Follows]->" : "<-[:Follows]-";
    const result = await this.conn.query(
      `MATCH (start:ToolResult {id: '${escapeStr(id)}'})${rel}(other:ToolResult)
       OPTIONAL MATCH (other)-[:References]->(f:FilePath)
       RETURN DISTINCT other.id, other.toolName, other.keyTerms, other.eventType,
              other.sessionId, other.timestamp,
              collect(DISTINCT f.path) AS files
       ORDER BY other.timestamp ${direction === "forward" ? "ASC" : "DESC"}`
    );
    return this.rowsToEvents(await result.getAll(), "other");
  }

  async getSessions(): Promise<SessionInfo[]> {
    this.ensureReady();
    const result = await this.conn.query(
      `MATCH (s:Session)
       RETURN s.id, s.startTime, s.cwd, s.gitRoot
       ORDER BY s.startTime DESC`
    );
    const rows = await result.getAll();
    return rows.map((r: any) => ({
      id: r["s.id"],
      startTime: Number(r["s.startTime"]),
      cwd: r["s.cwd"],
      gitRoot: r["s.gitRoot"],
    }));
  }

  async getSessionEvents(sessionId: string): Promise<ProjectGraphEvent[]> {
    this.ensureReady();
    const result = await this.conn.query(
      `MATCH (t:ToolResult)-[:BelongsTo]->(s:Session {id: '${escapeStr(sessionId)}'})
       OPTIONAL MATCH (t)-[:References]->(f:FilePath)
       RETURN t.id, t.toolName, t.keyTerms, t.eventType, t.sessionId, t.timestamp,
              collect(DISTINCT f.path) AS files
       ORDER BY t.timestamp ASC`
    );
    return this.rowsToEvents(await result.getAll());
  }

  async precheckFile(filePath: string): Promise<FilePrecheck> {
    this.ensureReady();
    const events = await this.queryByFile(filePath);
    if (events.length === 0) {
      return {
        eventCount: 0,
        lastTouched: 0,
        sessions: [],
        recentKeyTerms: [],
      };
    }

    const sessions = [...new Set(events.map((e) => e.sessionId))];
    const lastTouched = Math.max(...events.map((e) => e.timestamp));
    const recentKeyTerms = events
      .slice(0, 5)
      .flatMap((e) => e.keyTerms.split(/\s+/))
      .filter((w, i, arr) => arr.indexOf(w) === i)
      .slice(0, 10);

    return { eventCount: events.length, lastTouched, sessions, recentKeyTerms };
  }

  async getStats(): Promise<{
    events: number;
    files: number;
    sessions: number;
  }> {
    this.ensureReady();
    const er = await this.conn.query(
      "MATCH (n:ToolResult) RETURN count(n) AS c"
    );
    const fr = await this.conn.query(
      "MATCH (n:FilePath) RETURN count(n) AS c"
    );
    const sr = await this.conn.query(
      "MATCH (n:Session) RETURN count(n) AS c"
    );
    const eRows = await er.getAll();
    const fRows = await fr.getAll();
    const sRows = await sr.getAll();
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
       ORDER BY refCount DESC
       LIMIT ${limit}`
    );
    const rows = await result.getAll();
    return rows.map((r: any) => ({
      path: r.path,
      refCount: Number(r.refCount),
    }));
  }

  // ── Helpers ─────────────────────────────────────────────

  private ensureReady(): void {
    if (!this.ready || !this.conn) {
      throw new Error("ProjectGraph not initialized. Call init() first.");
    }
  }

  private rowsToEvents(
    rows: any[],
    prefix: string = "t"
  ): ProjectGraphEvent[] {
    return rows.map((r: any) => ({
      id: r[`${prefix}.id`],
      toolName: r[`${prefix}.toolName`],
      keyTerms: r[`${prefix}.keyTerms`],
      eventType: r[`${prefix}.eventType`],
      sessionId: r[`${prefix}.sessionId`],
      timestamp: Number(r[`${prefix}.timestamp`]),
      files: r.files ?? [],
    }));
  }
}
