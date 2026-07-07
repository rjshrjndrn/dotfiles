/**
 * ACM Graph — LadybugDB-backed relation manager for tool results.
 *
 * Tracks which tool results touched which files and their temporal order.
 * Enables relational recall: "what else touched this file?" and
 * "what happened after this?" instead of brute keyword scan.
 */

import { appendFileSync } from "node:fs";
const _graphDebug = process.env.ACM_DEBUG === "true" || process.env.ACM_DEBUG === "1";
function _graphLog(msg: string) { if (!_graphDebug) return; try { appendFileSync("/tmp/ladybug-acm.log", `[${new Date().toISOString()}] [graph] ${msg}\n`); } catch {} }

let db: any = null;
let conn: any = null;
let lastInsertedId: string | null = null;
let initialized = false;
let _ftsAvailable: boolean | null = null; // null = not tried yet

export interface GraphToolResult {
  id: string;
  toolName: string;
  keyTerms: string;
  filePaths: string[];
  timestamp: number;
}

export interface FtsSearchResult {
  node: GraphToolResult;
  score: number;
}

/**
 * Initialize the graph DB. Pass ":memory:" for tests, or a file path for persistence.
 */
export async function initGraph(dbPath: string): Promise<void> {
  if (dbPath !== ":memory:") {
    const { mkdirSync, existsSync, unlinkSync } = await import("node:fs");
    const { dirname } = await import("node:path");
    mkdirSync(dirname(dbPath), { recursive: true });

    // Pre-flight: validate DB (+WAL if present) in subprocess.
    // Subprocess crashes on corrupt data without taking down main process.
    // Recovery strategy:
    //   1. Try open DB with WAL → success? WAL replayed, done
    //   2. Failed? Delete WAL, retry → success? DB recovered sans WAL
    //   3. Still failed? Delete DB, start fresh
    if (existsSync(dbPath)) {
      const { execSync } = await import("node:child_process");
      const escaped = dbPath.replace(/'/g, "'\\''");
      const probe = `node -e "const l=require('@ladybugdb/core');const d=new l.Database('${escaped}');const c=new l.Connection(d);c.query('RETURN 1').then(r=>r.getAll()).then(()=>{d.close();process.exit(0)}).catch(()=>{d.close();process.exit(1)})"`;

      let ok = false;
      try {
        execSync(probe, { timeout: 5000, stdio: "ignore" });
        ok = true;
        _graphLog("pre-flight OK");
      } catch {
        // Step 2: WAL might be the problem — remove it and retry
        const walPath = dbPath + ".wal";
        if (existsSync(walPath)) {
          _graphLog(`pre-flight FAILED with WAL, removing WAL and retrying`);
          try { unlinkSync(walPath); } catch {}
          try {
            execSync(probe, { timeout: 5000, stdio: "ignore" });
            ok = true;
            _graphLog("pre-flight OK after WAL removal");
          } catch {
            _graphLog(`pre-flight FAILED even without WAL, deleting DB`);
          }
        } else {
          _graphLog(`pre-flight FAILED (no WAL), deleting corrupt DB`);
        }
      }
      if (!ok) {
        try { unlinkSync(dbPath); } catch {}
        try { unlinkSync(dbPath + ".wal"); } catch {}
      }
    }
  }
  const lbug = await import("@ladybugdb/core");
  db = new lbug.Database(dbPath === ":memory:" ? undefined : dbPath);
  conn = new lbug.Connection(db);

  await conn.query(`
    CREATE NODE TABLE IF NOT EXISTS ToolResult(
      id STRING PRIMARY KEY,
      toolName STRING,
      keyTerms STRING,
      timestamp INT64
    )
  `);
  await conn.query(`
    CREATE NODE TABLE IF NOT EXISTS FilePath(
      path STRING PRIMARY KEY
    )
  `);
  await conn.query(`
    CREATE REL TABLE IF NOT EXISTS References(FROM ToolResult TO FilePath)
  `);
  await conn.query(`
    CREATE REL TABLE IF NOT EXISTS Follows(FROM ToolResult TO ToolResult)
  `);

  lastInsertedId = null;
  _ftsAvailable = null; // defer FTS extension load to first use
  initialized = true;
}

export async function closeGraph(): Promise<void> {
  if (conn) {
    conn = null;
  }
  if (db) {
    db.close(); // sync method
    db = null;
  }
  initialized = false;
  lastInsertedId = null;
  _ftsAvailable = null;
}

function ensureInit(): void {
  if (!initialized || !conn) {
    throw new Error("Graph not initialized. Call initGraph() first.");
  }
}

function escapeStr(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * Insert a tool result into the graph with file references and temporal link.
 */
export async function insertToolResult(entry: GraphToolResult): Promise<void> {
  ensureInit();

  // Insert ToolResult node
  await conn.query(
    `MERGE (t:ToolResult {id: '${escapeStr(entry.id)}'})
     SET t.toolName = '${escapeStr(entry.toolName)}',
         t.keyTerms = '${escapeStr(entry.keyTerms)}',
         t.timestamp = ${entry.timestamp}`
  );

  // Insert FilePath nodes and References edges
  for (const fp of entry.filePaths) {
    await conn.query(`MERGE (f:FilePath {path: '${escapeStr(fp)}'})`);
    await conn.query(
      `MATCH (t:ToolResult {id: '${escapeStr(entry.id)}'}),
             (f:FilePath {path: '${escapeStr(fp)}'})
       MERGE (t)-[:References]->(f)`
    );
  }

  // Create Follows edge from previous tool result
  if (lastInsertedId) {
    await conn.query(
      `MATCH (prev:ToolResult {id: '${escapeStr(lastInsertedId)}'}),
             (curr:ToolResult {id: '${escapeStr(entry.id)}'})
       CREATE (prev)-[:Follows]->(curr)`
    );
  }

  lastInsertedId = entry.id;
}

/**
 * Find tool results whose keyTerms contain the given keyword.
 */
export async function queryByKeyword(keyword: string): Promise<GraphToolResult[]> {
  ensureInit();
  // Split multi-word query — match ANY word
  const words = keyword.toLowerCase().split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return [];
  const conditions = words.map(w => `lower(t.keyTerms) CONTAINS '${escapeStr(w)}'`).join(" OR ");
  const result = await conn.query(
    `MATCH (t:ToolResult)
     WHERE ${conditions}
     OPTIONAL MATCH (t)-[:References]->(f:FilePath)
     RETURN t.id, t.toolName, t.keyTerms, t.timestamp, collect(f.path) AS filePaths
     ORDER BY t.timestamp DESC`
  );
  return rowsToResults(await result.getAll());
}

/**
 * Find all tool results that referenced a given file path.
 */
export async function queryByFile(filePath: string): Promise<GraphToolResult[]> {
  ensureInit();
  const result = await conn.query(
    `MATCH (t:ToolResult)-[:References]->(f:FilePath {path: '${escapeStr(filePath)}'})
     OPTIONAL MATCH (t)-[:References]->(f2:FilePath)
     RETURN t.id, t.toolName, t.keyTerms, t.timestamp, collect(DISTINCT f2.path) AS filePaths
     ORDER BY t.timestamp DESC`
  );
  return rowsToResults(await result.getAll());
}

/**
 * Find tool results that share files with the given result (co-file neighbors).
 */
export async function getRelated(id: string): Promise<GraphToolResult[]> {
  ensureInit();
  const result = await conn.query(
    `MATCH (t:ToolResult {id: '${escapeStr(id)}'})-[:References]->(f:FilePath)<-[:References]-(other:ToolResult)
     WHERE other.id <> '${escapeStr(id)}'
     OPTIONAL MATCH (other)-[:References]->(f2:FilePath)
     RETURN DISTINCT other.id, other.toolName, other.keyTerms, other.timestamp, collect(DISTINCT f2.path) AS filePaths
     ORDER BY other.timestamp DESC`
  );
  return rowsToResults(await result.getAll());
}

/**
 * Traverse Follows edges forward or backward from a given tool result.
 */
export async function getSequence(
  id: string,
  direction: "forward" | "backward",
  maxDepth: number
): Promise<GraphToolResult[]> {
  ensureInit();
  const relPattern =
    direction === "forward"
      ? `-[:Follows*1..${maxDepth}]->`
      : `<-[:Follows*1..${maxDepth}]-`;
  const orderDir = direction === "forward" ? "ASC" : "DESC";

  const result = await conn.query(
    `MATCH (start:ToolResult {id: '${escapeStr(id)}'})${relPattern}(other:ToolResult)
     OPTIONAL MATCH (other)-[:References]->(f:FilePath)
     RETURN DISTINCT other.id, other.toolName, other.keyTerms, other.timestamp, collect(DISTINCT f.path) AS filePaths
     ORDER BY other.timestamp ${orderDir}`
  );
  return rowsToResults(await result.getAll());
}

/** Convert raw rows to GraphToolResult array. */
function rowsToResults(rows: any[]): GraphToolResult[] {
  return rows.map((row: any) => ({
    id: row["t.id"] ?? row["other.id"],
    toolName: row["t.toolName"] ?? row["other.toolName"],
    keyTerms: row["t.keyTerms"] ?? row["other.keyTerms"],
    filePaths: (row["filePaths"] ?? []).filter((p: any) => p != null),
    timestamp: Number(row["t.timestamp"] ?? row["other.timestamp"]),
  }));
}

export function isGraphReady(): boolean {
  return initialized && conn != null;
}

/** Get graph entry counts for status display. */
export async function getGraphStats(): Promise<{ toolResults: number; filePaths: number }> {
  if (!isGraphReady()) return { toolResults: 0, filePaths: 0 };
  try {
    const tr = await conn.query("MATCH (n:ToolResult) RETURN count(n) AS c");
    const fp = await conn.query("MATCH (n:FilePath) RETURN count(n) AS c");
    const trRows = await tr.getAll();
    const fpRows = await fp.getAll();
    return {
      toolResults: Number(trRows[0]?.c ?? 0),
      filePaths: Number(fpRows[0]?.c ?? 0),
    };
  } catch {
    return { toolResults: 0, filePaths: 0 };
  }
}

/** Get a compact summary of graph contents for post-slide context injection. */
export async function getGraphSummary(): Promise<{ toolResults: number; filePaths: string[] }> {
  if (!isGraphReady()) return { toolResults: 0, filePaths: [] };
  try {
    const tr = await conn.query("MATCH (n:ToolResult) RETURN count(n) AS c");
    const fp = await conn.query("MATCH (n:FilePath) RETURN n.path AS p ORDER BY p");
    const trRows = await tr.getAll();
    const fpRows = await fp.getAll();
    return {
      toolResults: Number(trRows[0]?.c ?? 0),
      filePaths: fpRows.map((r: any) => r.p as string),
    };
  } catch {
    return { toolResults: 0, filePaths: [] };
  }
}

// ── FTS (Full-Text Search) ─────────────────────────────────────────

/**
 * Load FTS extension and create index. LadybugDB auto-indexes new inserts.
 * Safe to call multiple times — extension load is once, index creation is idempotent.
 */
export async function ftsInit(): Promise<boolean> {
  ensureInit();
  // Load extension once per process
  if (_ftsAvailable === null) {
    try {
      await conn.query("INSTALL fts");
      await conn.query("LOAD EXTENSION fts");
      _ftsAvailable = true;
      _graphLog("FTS extension loaded");
    } catch (e: any) {
      _ftsAvailable = false;
      _graphLog(`FTS extension FAILED: ${e?.message || e}`);
      return false;
    }
  }
  if (!_ftsAvailable) return false;

  // Create index (idempotent — catches "already exists" and "empty table")
  try {
    await conn.query(
      "CALL CREATE_FTS_INDEX('ToolResult', 'tr_fts', ['keyTerms'], stemmer := 'english')"
    );
  } catch (e: any) {
    const msg = String(e);
    if (!msg.includes("already exists") && !msg.includes("empty")) {
      throw e;
    }
  }
  return true;
}

/**
 * Search using FTS index. Rebuilds lazily if dirty.
 * Returns scored results sorted by BM25 score descending.
 * Returns [] for empty query, empty table, or no matches.
 */
export async function ftsSearch(
  query: string,
  limit: number = 20
): Promise<FtsSearchResult[]> {
  ensureInit();
  if (!_ftsAvailable) return [];
  const trimmed = query.trim();
  if (!trimmed) return [];

  // Lazy init
  const ok = await ftsInit();
  if (!ok) return [];

  // Check if table has data
  const countResult = await conn.query("MATCH (n:ToolResult) RETURN count(n) AS c");
  const countRows = await countResult.getAll();
  if (Number(countRows[0]?.c ?? 0) === 0) return [];

  try {
    const result = await conn.query(
      `CALL QUERY_FTS_INDEX('ToolResult', 'tr_fts', '${escapeStr(trimmed)}', top := ${limit})
       WITH node AS t, score
       OPTIONAL MATCH (t)-[:References]->(f:FilePath)
       RETURN t.id AS id, t.toolName AS toolName, t.keyTerms AS keyTerms,
              t.timestamp AS timestamp, collect(DISTINCT f.path) AS filePaths, score
       ORDER BY score DESC`
    );
    const rows = await result.getAll();
    return rows.map((row: any) => ({
      node: {
        id: row.id,
        toolName: row.toolName,
        keyTerms: row.keyTerms,
        filePaths: (row.filePaths ?? []).filter((p: any) => p != null),
        timestamp: Number(row.timestamp),
      },
      score: Number(row.score),
    }));
  } catch (e: any) {
    // If FTS query fails (e.g. all stopwords), return empty
    if (String(e).includes("no result") || String(e).includes("empty")) {
      return [];
    }
    throw e;
  }
}

/**
 * Delete specific ToolResult nodes and their edges from the graph.
 * Also cleans up orphaned FilePath nodes.
 * Returns count of deleted nodes.
 */
export async function deleteToolResults(ids: string[]): Promise<number> {
  ensureInit();
  if (ids.length === 0) return 0;
  let deleted = 0;
  for (const id of ids) {
    try {
      // Delete edges first, then node
      await conn.query(`MATCH (t:ToolResult {id: '${escapeStr(id)}'})-[r:References]->() DELETE r`);
      await conn.query(`MATCH ()-[r:Follows]->(t:ToolResult {id: '${escapeStr(id)}'}) DELETE r`);
      await conn.query(`MATCH (t:ToolResult {id: '${escapeStr(id)}'})-[r:Follows]->() DELETE r`);
      await conn.query(`MATCH (t:ToolResult {id: '${escapeStr(id)}'}) DELETE t`);
      deleted++;
    } catch (e: any) {
      _graphLog(`deleteToolResult failed for ${id}: ${e?.message || e}`);
    }
  }
  // Clean up orphaned FilePath nodes (no References pointing to them)
  try {
    await conn.query(`MATCH (f:FilePath) WHERE NOT EXISTS { MATCH ()-[:References]->(f) } DELETE f`);
  } catch (e: any) {
    _graphLog(`orphan cleanup failed: ${e?.message || e}`);
  }
  return deleted;
}

/** Clear all data but keep schema. For testing. */
export async function clearGraphData(): Promise<void> {
  ensureInit();
  // Drop FTS index first (references the table data)
  try {
    await conn.query("CALL DROP_FTS_INDEX('ToolResult', 'tr_fts')");
  } catch {}
  // Delete edges first, then nodes
  await conn.query("MATCH ()-[r:References]->() DELETE r");
  await conn.query("MATCH ()-[r:Follows]->() DELETE r");
  await conn.query("MATCH (n:ToolResult) DELETE n");
  await conn.query("MATCH (n:FilePath) DELETE n");
  lastInsertedId = null;
}
