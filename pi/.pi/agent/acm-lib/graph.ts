/**
 * Session graph — per-session index of tool results, files, and their
 * temporal Follows chain, with FTS over key terms.
 *
 * Backed by RepoStore (node:sqlite, WAL). Replaces the LadybugDB engine whose
 * WAL corrupted on abrupt exit and self-deleted ("deleting corrupt DB") on the
 * next start. SQLite recovers cleanly, so that data-loss class is gone.
 *
 * Module-level singleton preserves the original functional API.
 */

import { RepoStore, type RepoEvent } from "./repo-store.ts";

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

let store: RepoStore | null = null;

function ensureInit(): RepoStore {
  if (!store) throw new Error("graph not initialized — call initGraph first");
  return store;
}

function toGraph(e: RepoEvent): GraphToolResult {
  return {
    id: e.id,
    toolName: e.toolName,
    keyTerms: e.keyTerms,
    filePaths: e.files,
    timestamp: e.timestamp,
  };
}

/** Initialize the graph DB. Pass ":memory:" for tests, or a file path. */
export async function initGraph(dbPath: string): Promise<void> {
  store = new RepoStore(dbPath);
  store.init();
}

export async function closeGraph(): Promise<void> {
  store?.close();
  store = null;
}

export function isGraphReady(): boolean {
  return store !== null && store.isReady();
}

export async function insertToolResult(entry: GraphToolResult): Promise<void> {
  ensureInit().writeEvent({
    id: entry.id,
    toolName: entry.toolName,
    keyTerms: entry.keyTerms,
    eventType: "tool_result",
    files: entry.filePaths,
    sessionId: "", // single global follows chain for the session graph
    timestamp: entry.timestamp,
    summary: "",
  });
}

export async function queryByKeyword(keyword: string): Promise<GraphToolResult[]> {
  return ensureInit().queryByKeyword(keyword).map(toGraph);
}

export async function queryByFile(filePath: string): Promise<GraphToolResult[]> {
  return ensureInit().queryByFile(filePath).map(toGraph);
}

export async function getRelated(id: string): Promise<GraphToolResult[]> {
  return ensureInit().getRelated(id).map(toGraph);
}

export async function getSequence(
  id: string,
  direction: "forward" | "backward",
  maxDepth: number,
): Promise<GraphToolResult[]> {
  return ensureInit().getSequence(id, direction, maxDepth).map(toGraph);
}

export async function getGraphStats(): Promise<{ toolResults: number; filePaths: number }> {
  if (!isGraphReady()) return { toolResults: 0, filePaths: 0 };
  const s = ensureInit().getStats();
  return { toolResults: s.events, filePaths: s.files };
}

export async function getGraphSummary(): Promise<{ toolResults: number; filePaths: string[] }> {
  if (!isGraphReady()) return { toolResults: 0, filePaths: [] };
  const s = ensureInit();
  return { toolResults: s.getStats().events, filePaths: s.fileList() };
}

/** FTS5 is compiled into node:sqlite — always available once initialized. */
export async function ftsInit(): Promise<boolean> {
  return isGraphReady();
}

export async function ftsSearch(query: string, limit = 20): Promise<FtsSearchResult[]> {
  return ensureInit()
    .ftsSearchEvents(query, limit)
    .map((r) => ({ node: toGraph(r.event), score: r.score }));
}

export async function deleteToolResults(ids: string[]): Promise<number> {
  ensureInit().deleteEvents(ids);
  // Mirror the legacy contract: count ids processed, not rows removed.
  return ids.length;
}

export async function clearGraphData(): Promise<void> {
  ensureInit().clear();
}
