/**
 * ACM Graph — LadybugDB-backed relation manager for tool results.
 *
 * Tracks which tool results touched which files and their temporal order.
 * Enables relational recall: "what else touched this file?" and
 * "what happened after this?" instead of brute keyword scan.
 */

let db: any = null;
let conn: any = null;
let lastInsertedId: string | null = null;
let initialized = false;

export interface GraphToolResult {
  id: string;
  toolName: string;
  keyTerms: string;
  filePaths: string[];
  timestamp: number;
}

/**
 * Initialize the graph DB. Pass ":memory:" for tests, or a file path for persistence.
 */
export async function initGraph(dbPath: string): Promise<void> {
  if (dbPath !== ":memory:") {
    const { mkdirSync } = await import("node:fs");
    const { dirname } = await import("node:path");
    mkdirSync(dirname(dbPath), { recursive: true });
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

/** Clear all data but keep schema. For testing. */
export async function clearGraphData(): Promise<void> {
  ensureInit();
  // Delete edges first, then nodes
  await conn.query("MATCH ()-[r:References]->() DELETE r");
  await conn.query("MATCH ()-[r:Follows]->() DELETE r");
  await conn.query("MATCH (n:ToolResult) DELETE n");
  await conn.query("MATCH (n:FilePath) DELETE n");
  lastInsertedId = null;
}
