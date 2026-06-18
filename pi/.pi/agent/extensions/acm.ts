/**
 * ACM — Adaptive Context Manager
 *
 * LLM-driven context management. No slash commands — LLM decides when
 * and what to prune using registered tools.
 *
 * Automatic: session_before_compact hijacks pi's compaction with two-phase
 * strategy (clear tool results → slide if needed).
 *
 * Manual: user says "acm prune" → LLM inspects context, calls acm_clear/acm_status.
 *
 * Eviction strategy draws from three research approaches:
 *
 * [1] Pichay 2025 — "Missing Pages: Demand Paging for LLM Context Windows"
 *     https://arxiv.org/abs/2603.09023
 *     Fault-driven pinning: evict aggressively, auto-pin on re-read.
 *     Production fault rate <0.03% across 1.4M evictions, 93% context reduction.
 *
 * [2] Qian et al. 2025 — "Less Context, Better Agents"
 *     https://arxiv.org/abs/2506.08338
 *     Keep last N tool-call pairs (N=5). Pruned agents outperform full-context
 *     (63.9% fewer tokens, better accuracy). Summarize instead of hard-delete.
 *
 * [3] CWL (Context Window Lifecycle) — episode typing heuristic:
 *     Action episodes (writes/edits) safe to evict first (effects persisted).
 *     Exploration episodes (reads/searches) evict last (LLM needs for reasoning).
 *
 * [4] InfiAgent 2025 — File-centric state abstraction:
 *     External tool outputs cached to disk, LLM self-serves via bash.
 *     "Long context is NOT a substitute for persistent state."
 *     Only internet/external content needs caching; local files re-readable.
 */

import { complete } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  convertToLlm,
  estimateTokens,
  serializeConversation,
} from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { writeFileSync, mkdirSync, readdirSync, statSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── Types ────────────────────────────────────────────────────────────

interface RecallMetadata {
  entryId: string;
  toolCallId: string;
  toolName: string;
  filePaths: string[];
  keyTerms: string;
  timestamp: number;
  charCount: number;
}

export interface RehydrateInput {
  type: string;
  customType?: string;
  data?: any;
}

export interface RehydrateResult {
  clearSet: Set<string>;
  toolCallIdToEntryId: Map<string, string>;
  recallIndex: Map<string, any>;
  pinnedSet: Set<string>;
  compactSet: Set<string>;
  totalTokensSaved: number;
  lastAutoClearUserCount: number;
  faultPinTurns: Map<string, number>;
}

// ── State ────────────────────────────────────────────────────────────

const clearSet = new Set<string>();
const toolCallIdToEntryId = new Map<string, string>();
const recallIndex = new Map<string, RecallMetadata>();
const pinnedSet = new Set<string>();
const compactSet = new Set<string>();
let totalTokensSaved = 0;

// Turn-boundary pruning: only auto-clear between user turns, not mid-LLM-action.
// Prevents evicting tool results the LLM is actively using for multi-step reasoning.
let lastAutoClearUserCount = 0;

// Fault-driven pinning (Pichay 2025, "Missing Pages" §3.2):
// Track evicted file paths. If LLM re-reads same path → auto-pin to stop thrashing.
// Production data shows <0.03% fault rate with this approach.
const evictedPaths = new Map<string, string>(); // filePath → evicted toolCallId

// Fault-pin TTL: auto-unpin fault-pins after N turn boundaries.
// Manual pins (user-requested via acm_pin) are permanent — only fault-pins decay.
// If LLM still needs content after expiry, re-read triggers re-fault-pin (self-correcting).
export const FAULT_PIN_TTL = 5; // turns before fault-pin expires
const faultPinTurns = new Map<string, number>(); // entryId → turn count when fault-pinned
export const MAX_EVICTED_PATHS = 200; // cap evictedPaths to prevent unbounded growth

/** Parameter names that commonly contain file paths in tool call arguments. */
export const FILE_PATH_PARAMS = ["path", "file", "file_path", "filePath", "filename", "file_name"] as const;

export function extractToolCallPaths(args: Record<string, any>): string[] {
  const paths: string[] = [];
  if (!args || typeof args !== "object") return paths;
  for (const key of FILE_PATH_PARAMS) {
    if (typeof args[key] === "string" && args[key]) paths.push(args[key]);
  }
  return paths;
}

// ── External Tool Caching (InfiAgent-inspired) ────────────────────
// Only tools that fetch from internet/external APIs get cached to disk.
// Local tools (Read/Write/Edit/Bash/gitnexus/memory) are re-derivable.

/**
 * Local tool set — populated at boot from pi.getAllTools().
 * Tools in this set are re-derivable (on disk or re-runnable).
 *
 * NOTE: MCP calls come through toolName="mcp" with the actual tool in args.tool.
 * MCP sub-tools that make API calls are always cached (cheap to store, expensive to re-fetch).
 */
export const localToolSet = new Set<string>();

/**
 * Config-driven overrides from acm.json:
 *   { "cacheTools": ["web_fetch", "custom_api"], "localTools": ["my_idempotent_tool"] }
 *
 * - cacheTools: force these tools to be cached (even if registered locally)
 * - localTools: force these tools to be treated as local (even if unknown)
 */
export interface AcmConfig {
  cacheTools?: string[];
  localTools?: string[];
}

/** Loaded config overrides. */
export let acmConfig: AcmConfig = {};

/** Load acm.json config from extension directory. */
export function loadAcmConfig(extensionDir: string): AcmConfig {
  const configPath = join(extensionDir, "acm.json");
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    return {};
  }
}

/** Populate localToolSet from registered tools at boot. */
export function discoverLocalTools(allTools: Array<{ name: string }>, config?: AcmConfig): void {
  localToolSet.clear();
  for (const tool of allTools) {
    localToolSet.add(tool.name);
  }
  // Apply config overrides
  if (config?.localTools) {
    for (const t of config.localTools) localToolSet.add(t);
  }
  if (config) acmConfig = config;
}

/** Check if a tool result should be cached to disk (external/internet content). */
export function isExternalTool(toolName: string, toolArgs?: Record<string, any>): boolean {
  // MCP gateway: sub-tool calls always go to external APIs — cache them
  if (toolName === "mcp") {
    if (!toolArgs?.tool) return false; // meta calls (status/describe/list)
    return true;
  }
  // Config override: explicitly marked for caching
  if (acmConfig.cacheTools?.includes(toolName)) return true;
  // Tools discovered at boot are local — don't cache
  if (localToolSet.has(toolName)) return false;
  // Unknown tools: default to NOT caching (keep normal clear/stub behavior)
  return false;
}

/** Get the cache directory for a session. */
export function getCacheDir(sessionDir: string): string {
  return join(sessionDir, ".acm", "cache");
}

/** Write tool output to cache file. Returns the cache file path. */
export function writeCacheFile(
  sessionDir: string,
  toolName: string,
  toolCallId: string,
  content: string,
): string {
  const cacheDir = getCacheDir(sessionDir);
  mkdirSync(cacheDir, { recursive: true });
  // Sanitize toolCallId for filename
  const safeId = toolCallId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
  const ext = isJsonLike(content) ? ".json" : ".md";
  const filename = `${toolName}-${safeId}${ext}`;
  const filePath = join(cacheDir, filename);
  // Truncate at 100KB
  const maxBytes = 100 * 1024;
  const truncated = content.length > maxBytes
    ? content.slice(0, maxBytes) + "\n\n[...truncated at 100KB]"
    : content;
  writeFileSync(filePath, truncated, "utf-8");
  return filePath;
}

/** Extract text content from a tool result message. */
export function extractToolResultText(msg: any): string {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n");
  }
  return JSON.stringify(msg.content);
}

function isJsonLike(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

/** Look up tool call arguments from branch for a given toolCallId. */
function findToolCallArgs(branch: any[], toolCallId: string): Record<string, any> | undefined {
  for (const entry of branch) {
    if (entry.type !== "message" || !entry.message) continue;
    const msg = entry.message as any;
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (block.type === "toolCall" && block.id === toolCallId && block.arguments) {
        return typeof block.arguments === "string" ? JSON.parse(block.arguments) : block.arguments;
      }
    }
  }
  return undefined;
}

/** Build a cached stub with file path for external tool results. */
export function buildCachedStub(toolName: string, cachePath: string, keyTerms: string): string {
  return `[cached: ${cachePath} | ${toolName} | ${extractKeywords(keyTerms, 10)} | use: bash rg/grep/head]`;
}

/** Get cache stats for acm_status. */
export function getCacheStats(sessionDir: string): { files: number; totalBytes: number } {
  const cacheDir = getCacheDir(sessionDir);
  if (!existsSync(cacheDir)) return { files: 0, totalBytes: 0 };
  try {
    const entries = readdirSync(cacheDir);
    let totalBytes = 0;
    for (const entry of entries) {
      try { totalBytes += statSync(join(cacheDir, entry)).size; } catch {}
    }
    return { files: entries.length, totalBytes };
  } catch { return { files: 0, totalBytes: 0 }; }
}

// Track which toolCallIds have been cached to disk
const cachedToFile = new Map<string, string>(); // toolCallId → cachePath

/** @internal — reset module-level state for test isolation */
export function _resetState() {
  clearSet.clear();
  toolCallIdToEntryId.clear();
  recallIndex.clear();
  pinnedSet.clear();
  compactSet.clear();
  totalTokensSaved = 0;
  lastAutoClearUserCount = 0;
  evictedPaths.clear();
  faultPinTurns.clear();
  cachedToFile.clear();
}

// ── Persistence ──────────────────────────────────────────────────────

function persist(appendEntry: (type: string, data?: any) => void) {
  appendEntry("acm-clear-state", {
    clearedToolCallIds: [...clearSet],
    toolCallIdToEntryId: Object.fromEntries(toolCallIdToEntryId),
    totalTokensSaved,
    compactedEntryIds: [...compactSet],
    lastAutoClearUserCount,
  });
  appendEntry("acm-recall-index", { entries: [...recallIndex.values()] });
}

function persistPin(appendEntry: (type: string, data?: any) => void, entryId: string, action: "pin" | "unpin", opts?: { isFault?: boolean; pinnedAtTurn?: number }) {
  appendEntry("acm-pin", { entryId, action, ...opts });
}

function rehydrateState(entries: Array<{ type: string; customType?: string; data?: any }>) {
  let lastClearState: any;
  let lastRecallIndex: any;
  const pinEvents: Array<{ entryId: string; action: "pin" | "unpin"; isFault?: boolean; pinnedAtTurn?: number }> = [];

  for (const entry of entries) {
    if (entry.type !== "custom") continue;
    if (entry.customType === "acm-clear-state") lastClearState = entry.data;
    else if (entry.customType === "acm-recall-index") lastRecallIndex = entry.data;
    else if (entry.customType === "acm-pin" && entry.data) pinEvents.push(entry.data);
  }

  if (lastClearState) {
    clearSet.clear();
    for (const id of lastClearState.clearedToolCallIds) clearSet.add(id);
    toolCallIdToEntryId.clear();
    for (const [k, v] of Object.entries(lastClearState.toolCallIdToEntryId)) {
      toolCallIdToEntryId.set(k, v as string);
    }
    totalTokensSaved = lastClearState.totalTokensSaved ?? 0;
    lastAutoClearUserCount = lastClearState.lastAutoClearUserCount ?? 0;
    compactSet.clear();
    for (const id of lastClearState.compactedEntryIds ?? []) compactSet.add(id);
  }

  if (lastRecallIndex) {
    recallIndex.clear();
    for (const entry of lastRecallIndex.entries) recallIndex.set(entry.toolCallId, entry);
  }

  pinnedSet.clear();
  faultPinTurns.clear();
  for (const { entryId, action, isFault, pinnedAtTurn } of pinEvents) {
    if (action === "pin") {
      pinnedSet.add(entryId);
      if (isFault && pinnedAtTurn != null) faultPinTurns.set(entryId, pinnedAtTurn);
    } else {
      pinnedSet.delete(entryId);
      faultPinTurns.delete(entryId);
    }
  }

  // Rebuild evictedPaths from recall index for fault detection across restarts
  evictedPaths.clear();
  for (const recall of recallIndex.values()) {
    for (const fp of recall.filePaths) evictedPaths.set(fp, recall.toolCallId);
  }
  // Cap evictedPaths to prevent unbounded growth
  while (evictedPaths.size > MAX_EVICTED_PATHS) {
    const first = evictedPaths.keys().next().value;
    if (first) evictedPaths.delete(first); else break;
  }

  return { cleared: clearSet.size, recalled: recallIndex.size, pinned: pinnedSet.size };
}

// ── Exported Pure Helpers (tested independently) ─────────────────────

export const STOP_WORDS = new Set([
  "this", "that", "with", "from", "have", "will", "been", "they", "then",
  "than", "when", "what", "which", "would", "should", "could", "also",
  "just", "like", "into", "each", "make", "here", "need", "some",
]);

export function extractKeywords(text: string, max = 15): string {
  const words = text.replace(/[^a-zA-Z0-9_./\-]/g, " ").split(/\s+/).filter(Boolean);
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const word of words) {
    if (word.length < 4 || STOP_WORDS.has(word.toLowerCase()) || seen.has(word.toLowerCase())) continue;
    seen.add(word.toLowerCase());
    keywords.push(word);
    if (keywords.length >= max) break;
  }
  return keywords.join(", ");
}

export function getBranchMessages(branch: any[]): any[] {
  return branch
    .filter((e: any) => e.type === "message" && e.message)
    .map((e: any) => e.message);
}

export function getTextPreview(msg: any, maxLen = 500): string {
  if (!Array.isArray(msg.content)) return "";
  for (const block of msg.content) {
    if (block.type === "text" && block.text) return block.text.slice(0, maxLen);
    if (block.type === "image") return "[image]";
  }
  return "";
}

export function extractEntryContent(entry: any): string {
  const c = entry?.message?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c.map((b: any) => b.type === "text" ? b.text : b.type === "image" ? "[image]" : JSON.stringify(b)).join("\n");
  }
  return JSON.stringify(entry);
}

export function compactMessage(msg: any, entryId: string): { content: any[]; saved: number } | null {
  if (!Array.isArray(msg.content)) return null;

  let totalChars = 0;
  let textContent = "";
  const hasToolCalls = msg.content.some((b: any) => b.type === "toolCall");

  for (const block of msg.content) {
    if (block.type === "text") { totalChars += block.text?.length || 0; textContent += block.text + " "; }
    else if (block.type === "thinking") totalChars += block.thinking?.length || 0;
  }

  if (totalChars < 1000) return null;

  const stub = `[compacted: ${extractKeywords(textContent)} | id: ${entryId}]`;

  if (hasToolCalls) {
    let stubInserted = false;
    const newContent: any[] = [];
    for (const block of msg.content) {
      if (block.type === "text" || block.type === "thinking") {
        if (!stubInserted) {
          newContent.push({ type: "text", text: stub });
          stubInserted = true;
        }
      } else {
        newContent.push(block);
      }
    }
    return { content: newContent, saved: totalChars - stub.length };
  }

  return { content: [{ type: "text", text: stub }], saved: totalChars - stub.length };
}

export function findHybridCutoff(branch: any[], opts?: { keepMessages?: number; keepMinutes?: number }): number {
  const keepMessages = opts?.keepMessages ?? 10;
  const keepMinutes = opts?.keepMinutes ?? 30;

  const validCuts: number[] = [];
  for (let i = 0; i < branch.length; i++) {
    const e = branch[i];
    if (e.type === "compaction" || e.type === "branch_summary" || e.type === "custom") {
      validCuts.push(i);
    } else if (e.type === "message") {
      const role = e.message?.role;
      if (role === "user" || role === "assistant") validCuts.push(i);
    }
  }
  if (validCuts.length === 0) return 0;

  // keepMessages = last N user messages + all associated responses/tool calls
  // Walk backwards counting user messages to find the message-based cutoff
  let msgCutoff = 0;
  let userCount = 0;
  for (let i = branch.length - 1; i >= 0; i--) {
    const e = branch[i];
    if (e.type === "message" && e.message?.role === "user") {
      userCount++;
      if (userCount >= keepMessages) { msgCutoff = i; break; }
    }
  }
  if (userCount < keepMessages) return 0; // not enough messages to slide

  // keepMinutes = keep everything from last N minutes
  // timeCutoff = index of first entry to KEEP (everything before it gets slid)
  // Default 0 = all within window = keep everything (no time-based eviction)
  const now = Date.now();
  const windowMs = keepMinutes * 60 * 1000;
  let timeCutoff = 0;
  for (let i = branch.length - 1; i >= 0; i--) {
    const ts = branch[i].timestamp;
    const t = typeof ts === "number" ? ts : typeof ts === "string" ? new Date(ts).getTime() : 0;
    if (now - t > windowMs) { timeCutoff = i + 1; break; }
  }

  // Both are irrelevance thresholds: anything outside EITHER window is stale.
  // Higher cutoff index = more aggressive (keep less). Take the max.
  let cutoff = Math.max(timeCutoff, msgCutoff);

  const before = validCuts.filter((i) => i <= cutoff);
  cutoff = before.length > 0 ? before[before.length - 1] : validCuts[0];

  return cutoff;
}

/** Pure version of rehydrateState for testing — returns new state instead of mutating globals */
export function rehydrateStatePure(entries: RehydrateInput[]): RehydrateResult {
  const result: RehydrateResult = {
    clearSet: new Set(),
    toolCallIdToEntryId: new Map(),
    recallIndex: new Map(),
    pinnedSet: new Set(),
    compactSet: new Set(),
    totalTokensSaved: 0,
    lastAutoClearUserCount: 0,
    faultPinTurns: new Map(),
  };

  let lastClearState: any;
  let lastRecallIndex: any;
  const pinEvents: Array<{ entryId: string; action: "pin" | "unpin"; isFault?: boolean; pinnedAtTurn?: number }> = [];

  for (const entry of entries) {
    if (entry.type !== "custom") continue;
    if (entry.customType === "acm-clear-state") lastClearState = entry.data;
    else if (entry.customType === "acm-recall-index") lastRecallIndex = entry.data;
    else if (entry.customType === "acm-pin" && entry.data) pinEvents.push(entry.data);
  }

  if (lastClearState) {
    for (const id of lastClearState.clearedToolCallIds ?? []) result.clearSet.add(id);
    for (const [k, v] of Object.entries(lastClearState.toolCallIdToEntryId ?? {})) {
      result.toolCallIdToEntryId.set(k, v as string);
    }
    result.totalTokensSaved = lastClearState.totalTokensSaved ?? 0;
    result.lastAutoClearUserCount = lastClearState.lastAutoClearUserCount ?? 0;
    for (const id of lastClearState.compactedEntryIds ?? []) result.compactSet.add(id);
  }

  if (lastRecallIndex) {
    for (const entry of lastRecallIndex.entries ?? []) result.recallIndex.set(entry.toolCallId, entry);
  }

  for (const { entryId, action, isFault, pinnedAtTurn } of pinEvents) {
    if (action === "pin") {
      result.pinnedSet.add(entryId);
      if (isFault && pinnedAtTurn != null) result.faultPinTurns.set(entryId, pinnedAtTurn);
    } else {
      result.pinnedSet.delete(entryId);
      result.faultPinTurns.delete(entryId);
    }
  }

  return result;
}

// ── Internal Helpers ─────────────────────────────────────────────────

function buildToolCallMapping(branch: any[]) {
  toolCallIdToEntryId.clear();
  for (const entry of branch) {
    if (entry.type === "message" && entry.message?.role === "toolResult" && entry.message.toolCallId) {
      toolCallIdToEntryId.set(entry.message.toolCallId, entry.id);
    }
  }
}

function inventoryToolResults(messages: AgentMessage[]) {
  const results: Array<{ toolCallId: string; toolName: string; tokens: number; keyTerms: string }> = [];
  for (const msg of messages) {
    const m = msg as any;
    if (m.role !== "toolResult" || !m.toolCallId || clearSet.has(m.toolCallId)) continue;
    let keyTerms = "";
    if (Array.isArray(m.content)) {
      for (const block of m.content) {
        if (block.type === "text" && block.text) { keyTerms = block.text.slice(0, 150).replace(/\n/g, " "); break; }
        if (block.type === "image") { keyTerms = "[image]"; break; }
      }
    }
    results.push({ toolCallId: m.toolCallId, toolName: m.toolName || "unknown", tokens: estimateTokens(msg), keyTerms });
  }
  return results.sort((a, b) => b.tokens - a.tokens);
}

function buildStub(msg: any): string {
  const toolName = msg.toolName || "unknown";
  const entryId = toolCallIdToEntryId.get(msg.toolCallId) || "?";
  // If cached to file, use cached stub format with filepath
  const cachePath = cachedToFile.get(msg.toolCallId);
  if (cachePath) {
    const recall = recallIndex.get(msg.toolCallId);
    const source = recall?.keyTerms ?? getTextPreview(msg);
    return buildCachedStub(toolName, cachePath, source);
  }
  const recall = recallIndex.get(msg.toolCallId);
  const source = recall?.keyTerms ?? getTextPreview(msg);
  return `[cleared: ${toolName} | id: ${entryId} | ${extractKeywords(source, 10)}]`;
}

function buildRecallEntry(toolCallId: string, toolName: string, keyTerms: string, charCount: number, messages: AgentMessage[]): RecallMetadata {
  const filePaths: string[] = [];
  for (const msg of messages) {
    const m = msg as any;
    if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
    for (const block of m.content) {
      if (block.type === "toolCall" && block.id === toolCallId && block.arguments) {
        filePaths.push(...extractToolCallPaths(block.arguments));
      }
    }
  }
  return { entryId: toolCallIdToEntryId.get(toolCallId) || "", toolCallId, toolName, filePaths, keyTerms, timestamp: Date.now(), charCount };
}

function clearToolResults(
  toolResults: Array<{ toolCallId: string; toolName: string; tokens: number; keyTerms: string }>,
  notify: (msg: string) => void,
  contextMessages: AgentMessage[],
  sessionDir?: string,
): number {
  let saved = 0;
  for (const tr of toolResults) {
    if (clearSet.has(tr.toolCallId)) continue;
    const entryId = toolCallIdToEntryId.get(tr.toolCallId);
    if (entryId && pinnedSet.has(entryId)) {
      notify(`📌 ${tr.toolName} (${Math.round(tr.tokens / 1000)}k) — pinned, skip`);
      continue;
    }
    // Cache external tool outputs to disk before clearing
    // Look up tool call args from context (needed for MCP sub-tool detection)
    let toolArgs: Record<string, any> | undefined;
    for (const m of contextMessages) {
      const cm = m as any;
      if (cm.role === "assistant" && Array.isArray(cm.content)) {
        for (const block of cm.content) {
          if (block.type === "toolCall" && block.id === tr.toolCallId && block.arguments) {
            toolArgs = typeof block.arguments === "string" ? JSON.parse(block.arguments) : block.arguments;
          }
        }
      }
    }
    if (sessionDir && isExternalTool(tr.toolName, toolArgs)) {
      const toolResultMsg = contextMessages.find((m: any) => m.toolCallId === tr.toolCallId) as any;
      if (toolResultMsg) {
        const text = extractToolResultText(toolResultMsg);
        if (text.length > 0) {
          try {
            const cachePath = writeCacheFile(sessionDir, tr.toolName, tr.toolCallId, text);
            cachedToFile.set(tr.toolCallId, cachePath);
            notify(`💾 ${tr.toolName} (${Math.round(tr.tokens / 1000)}k) → cached: ${cachePath}`);
          } catch (e) {
            notify(`⚠️ ${tr.toolName} cache write failed: ${e instanceof Error ? e.message : e}`);
          }
        }
      }
    }
    clearSet.add(tr.toolCallId);
    const tokensSaved = tr.tokens - 50;
    totalTokensSaved += tokensSaved;
    saved += tokensSaved;
    recallIndex.set(tr.toolCallId, buildRecallEntry(tr.toolCallId, tr.toolName, tr.keyTerms, tr.tokens * 4, contextMessages));
    notify(`✂ ${tr.toolName} (${Math.round(tr.tokens / 1000)}k) → stub [id: ${entryId || "?"}]`);
  }
  return saved;
}

function statusText() {
  return `ACM: ${clearSet.size} cleared, ${compactSet.size} compacted | ~${Math.round(totalTokensSaved * 0.4 / 1000)}k saved`;
}

// ── Extension ────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // ── Rehydrate on session load ──────────────────────────────────────

  pi.on("session_start" as any, (_event: any, ctx: any) => {
    // Load config + discover local tools from runtime
    const config = loadAcmConfig(dirname(fileURLToPath(import.meta.url)));
    discoverLocalTools(ctx.getAllTools?.() ?? [], config);
    const stats = rehydrateState(ctx.sessionManager.getEntries());
    // Rehydrate cachedToFile map from existing cache files
    const sessionDir = ctx.sessionManager.getSessionDir();
    const cacheDir = getCacheDir(sessionDir);
    if (existsSync(cacheDir)) {
      try {
        for (const file of readdirSync(cacheDir)) {
          // Extract toolCallId from filename: toolName-toolCallId.ext
          const match = file.match(/^(.+?)-(.+)\.(md|json)$/);
          if (match) {
            const cachePath = join(cacheDir, file);
            // Find matching recall entry
            for (const recall of recallIndex.values()) {
              const safeId = recall.toolCallId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
              if (file.includes(safeId)) {
                cachedToFile.set(recall.toolCallId, cachePath);
                break;
              }
            }
          }
        }
      } catch {}
    }
    if (stats.cleared > 0 || stats.pinned > 0) {
      ctx.ui.notify(`[ACM] Restored: ${stats.cleared} cleared, ${stats.pinned} pinned, ${stats.recalled} in recall, ${cachedToFile.size} cached`, "info");
      ctx.ui.setStatus("acm", statusText());
    }
  });

  // ── Context event: apply clearing/compaction ───────────────────────

  pi.on("context", (event, ctx) => {
    const branch = ctx.sessionManager.getBranch() as any[];

    // Build lookup maps
    const msgEntryId = new Map<any, string>();
    const tcEntryId = new Map<string, string>();
    for (const entry of branch) {
      if (entry.type !== "message" || !entry.message) continue;
      msgEntryId.set(entry.message, entry.id);
      if (entry.message.role === "toolResult" && entry.message.toolCallId) {
        tcEntryId.set(entry.message.toolCallId, entry.id);
      }
    }

    // Find threshold: keep last N turns unmodified
    const recentTurns = 3;
    let turnCount = 0;
    let recentThreshold = event.messages.length;
    for (let i = event.messages.length - 1; i >= 0; i--) {
      if ((event.messages[i] as any).role === "user") turnCount++;
      if (turnCount > recentTurns) { recentThreshold = i; break; }
    }

    const messages = event.messages.map((msg: any, idx: number) => {
      // Clear tool results
      if (msg.role === "toolResult" && msg.toolCallId && clearSet.has(msg.toolCallId)) {
        return { ...msg, content: [{ type: "text" as const, text: buildStub(msg) }] };
      }

      // Strip thinking blocks from old messages
      if (msg.role === "assistant" && Array.isArray(msg.content) && idx < recentThreshold) {
        const hasThinking = msg.content.some((b: any) => b.type === "thinking");
        if (hasThinking) {
          const stripped = msg.content.filter((b: any) => b.type !== "thinking");
          msg = { ...msg, content: stripped.length > 0 ? stripped : [{ type: "text", text: "[thinking stripped]" }] };
        }
      }

      // Compact marked messages
      const entryId = msgEntryId.get(msg) || (msg.toolCallId ? tcEntryId.get(msg.toolCallId) : undefined);
      if (entryId && compactSet.has(entryId) && !pinnedSet.has(entryId)) {
        const compacted = compactMessage(msg, entryId);
        if (compacted) return { ...msg, content: compacted.content };
      }

      return msg;
    });

    // Inject ACM context into first user message
    if (clearSet.size > 0 || compactSet.size > 0) {
      const cachedCount = cachedToFile.size;
      const acmText = [
        `<acm-context>`,
        `${clearSet.size} tool results cleared, ${compactSet.size} messages compacted, ${pinnedSet.size} pinned, ${cachedCount} cached to disk.`,
        `Thinking blocks stripped from old messages (last ${recentTurns} turns preserved).`,
        cachedCount > 0
          ? `To retrieve cached content: use bash (rg, grep, head, jq) on the filepath shown in [cached:...] stubs.`
          : ``,
        `For file content: prefer \`bash rg/grep\` on source files over Read. Use Read as fallback.`,
        `To find what's cached: acm_recall(query: "keywords") returns paths only, NO content.`,
        `Do NOT guess cleared content.`,
        `</acm-context>`,
      ].filter(Boolean).join("\n");

      for (let i = 0; i < messages.length; i++) {
        if ((messages[i] as any).role === "user") {
          const m = messages[i] as any;
          messages[i] = {
            ...m,
            content: [{ type: "text", text: acmText }, ...(Array.isArray(m.content) ? m.content : [{ type: "text", text: m.content }])],
          };
          break;
        }
      }
    }

    // Count user messages (needed by both fault detection and auto-clear)
    let currentUserCount = 0;
    for (const m of event.messages) {
      if ((m as any).role === "user") currentUserCount++;
    }

    // ── Fault-driven pinning: detect re-reads of evicted content ──
    // If LLM re-reads a file that was previously evicted, auto-pin the new result
    // to prevent read→evict→re-read thrashing (Pichay 2025, fault rate <0.03%)
    const recentToolPaths = new Map<string, string>(); // toolCallId → filePath
    for (let i = recentThreshold; i < event.messages.length; i++) {
      const m = event.messages[i] as any;
      if (m.role === "assistant" && Array.isArray(m.content)) {
        for (const block of m.content) {
          if (block.type === "toolCall" && block.arguments) {
            const fps = extractToolCallPaths(block.arguments);
            if (fps.length > 0) recentToolPaths.set(block.id, fps[0]);
          }
        }
      }
    }
    for (let i = recentThreshold; i < event.messages.length; i++) {
      const m = event.messages[i] as any;
      if (m.role !== "toolResult" || !m.toolCallId) continue;
      if (clearSet.has(m.toolCallId)) continue;
      const filePath = recentToolPaths.get(m.toolCallId);
      if (filePath && evictedPaths.has(filePath)) {
        const entryId = tcEntryId.get(m.toolCallId);
        if (entryId && !pinnedSet.has(entryId)) {
          pinnedSet.add(entryId);
          faultPinTurns.set(entryId, currentUserCount);
          persistPin(pi.appendEntry.bind(pi), entryId, "pin", { isFault: true, pinnedAtTurn: currentUserCount });
          ctx.ui.notify(`[ACM] 📌 Fault-pin: ${filePath} (re-read of evicted content)`, "info");
          evictedPaths.delete(filePath);
        }
      }
    }

    // ── Auto-clear: turn-boundary only ──
    // Only evict when a NEW user message arrives (turn boundary).
    // Mid-turn tool results stay — LLM may still need them for reasoning.
    if (currentUserCount > lastAutoClearUserCount) {
      lastAutoClearUserCount = currentUserCount;

      // ── Fault-pin TTL: expire stale fault-pins ──
      // Manual pins (acm_pin) are permanent. Only fault-pins decay after FAULT_PIN_TTL turns.
      for (const [entryId, pinnedAtTurn] of faultPinTurns) {
        if (currentUserCount - pinnedAtTurn >= FAULT_PIN_TTL) {
          pinnedSet.delete(entryId);
          faultPinTurns.delete(entryId);
          persistPin(pi.appendEntry.bind(pi), entryId, "unpin");
          ctx.ui.notify(`[ACM] 📌 Fault-pin expired: ${entryId} (${FAULT_PIN_TTL} turns)`, "info");
        }
      }

      // Collect toolCallIds from recent turns (protected)
      const recentToolCallIds = new Set<string>();
      for (let i = recentThreshold; i < event.messages.length; i++) {
        const m = event.messages[i] as any;
        if (m.role === "toolResult" && m.toolCallId) recentToolCallIds.add(m.toolCallId);
      }

      let autoClearCount = 0;
      const sessionDir = ctx.sessionManager.getSessionDir();
      for (const entry of branch) {
        if (entry.type !== "message" || !entry.message) continue;
        const msg = entry.message as any;
        if (msg.role !== "toolResult" || !msg.toolCallId) continue;
        if (clearSet.has(msg.toolCallId)) continue;
        if (pinnedSet.has(entry.id)) continue;
        if (recentToolCallIds.has(msg.toolCallId)) continue; // protect recent
        const tokens = estimateTokens(msg);
        // Cache external tool outputs to disk before clearing
        const toolName = msg.toolName || "unknown";
        const toolArgs = findToolCallArgs(branch, msg.toolCallId);
        if (isExternalTool(toolName, toolArgs)) {
          try {
            const text = extractToolResultText(msg);
            if (text.length > 0) {
              const cachePath = writeCacheFile(sessionDir, toolName, msg.toolCallId, text);
              cachedToFile.set(msg.toolCallId, cachePath);
              ctx.ui.notify(`[ACM] 💾 ${toolName} → cached: ${cachePath}`, "info");
            }
          } catch (e) {
            ctx.ui.notify(`[ACM] ⚠️ ${toolName} cache write failed: ${e instanceof Error ? e.message : e}`, "info");
          }
        }
        clearSet.add(msg.toolCallId);
        totalTokensSaved += Math.max(tokens - 50, 0);
        const textContent = Array.isArray(msg.content)
          ? msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join(" ").slice(0, 200)
          : "";
        const recall = buildRecallEntry(msg.toolCallId, msg.toolName || "unknown", textContent, tokens * 4, getBranchMessages(branch));
        recallIndex.set(msg.toolCallId, recall);
        // Track evicted file paths for fault detection
        for (const fp of recall.filePaths) evictedPaths.set(fp, msg.toolCallId);
        autoClearCount++;
      }
      // Cap evictedPaths to prevent unbounded growth
      while (evictedPaths.size > MAX_EVICTED_PATHS) {
        const first = evictedPaths.keys().next().value;
        if (first) evictedPaths.delete(first); else break;
      }
      if (autoClearCount > 0) {
        persist(pi.appendEntry.bind(pi));
        ctx.ui.notify(`[ACM] Auto-cleared ${autoClearCount} old tool results`, "info");
      }
    }

    const usage = ctx.getContextUsage();
    const pct = usage?.percent != null ? `${Math.round(usage.percent)}%` : "?";
    ctx.ui.setStatus("acm", `${statusText()} | ${pct}`);

    return { messages };
  });

  // ── Tool: acm_status ───────────────────────────────────────────────

  pi.registerTool({
    name: "acm_status",
    label: "ACM Status",
    description: "Show current ACM state: context usage, cleared tool results, tokens saved.",
    promptSnippet: "acm_status: Show context usage, cleared entries, tokens saved by ACM.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const usage = ctx.getContextUsage();
      const branch = ctx.sessionManager.getBranch() as any[];
      buildToolCallMapping(branch);
      const clearable = inventoryToolResults(getBranchMessages(branch));
      const est = Math.round(clearable.reduce((s, r) => s + r.tokens, 0) * 0.4);
      const cacheStats = getCacheStats(ctx.sessionManager.getSessionDir());

      const report = [
        `── ACM Status ──`,
        `Context: ${usage?.tokens ? Math.round(usage.tokens / 1000) + "k" : "?"} / ${usage?.contextWindow ? Math.round(usage.contextWindow / 1000) + "k" : "?"} (${usage?.percent != null ? Math.round(usage.percent) + "%" : "?"})`,
        `Cleared: ${clearSet.size} tool results, ${compactSet.size} compacted`,
        `Saved: ~${Math.round(totalTokensSaved * 0.4 / 1000)}k`,
        `Cache: ${cacheStats.files} files (${Math.round(cacheStats.totalBytes / 1024)}KB) in .acm/cache/`,
        ``,
        `── Clearable: ${clearable.length} (~${Math.round(est / 1000)}k) ──`,
        ...clearable.slice(0, 10).map((r) => `  ${r.toolName} (${Math.round(r.tokens / 1000)}k) [${r.keyTerms.slice(0, 60)}...]`),
        clearable.length > 10 ? `  ... +${clearable.length - 10} more` : "",
      ].filter(Boolean).join("\n");

      return { content: [{ type: "text" as const, text: report }], details: {} };
    },
  });

  // ── Tool: acm_clear ────────────────────────────────────────────────

  pi.registerTool({
    name: "acm_clear",
    label: "ACM Clear",
    description:
      "Clear tool result content from context, replacing with compact stubs. " +
      "Frees tokens without losing the ability to recall original content later. " +
      "Call acm_status first to see what's clearable.",
    promptSnippet: "acm_clear: Clear tool results from context (replace with stubs). Use to free tokens.",
    promptGuidelines: [
      "When user says 'acm prune': 1) acm_status, 2) acm_clear, 3) acm_compact_messages if still high, 4) acm_slide as last resort.",
      "Tool results are ephemeral — safe to drop entirely. Just stubs + recall index.",
    ],
    parameters: Type.Object({
      toolCallIds: Type.Optional(Type.Array(Type.String(), { description: "Specific toolCallIds to clear. Omit to clear all." })),
      olderThanMinutes: Type.Optional(Type.Number({ description: "Only clear tool results older than N minutes." })),
      minTokens: Type.Optional(Type.Number({ description: "Only clear tool results larger than N tokens." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const branch = ctx.sessionManager.getBranch() as any[];
      buildToolCallMapping(branch);
      const branchMessages = getBranchMessages(branch);
      let candidates = inventoryToolResults(branchMessages);

      if (params.toolCallIds?.length) {
        const ids = new Set(params.toolCallIds);
        candidates = candidates.filter((r) => ids.has(r.toolCallId));
      }
      if (params.olderThanMinutes != null) {
        const cutoff = Date.now() - params.olderThanMinutes * 60 * 1000;
        candidates = candidates.filter((r) => {
          const msg = branchMessages.find((m: any) => m.toolCallId === r.toolCallId) as any;
          return msg?.timestamp != null && msg.timestamp < cutoff;
        });
      }
      if (params.minTokens != null) {
        candidates = candidates.filter((r) => r.tokens >= params.minTokens!);
      }

      if (candidates.length === 0) {
        return { content: [{ type: "text" as const, text: "[ACM] Nothing to clear." }], details: { count: 0 } };
      }

      const sessionDir = ctx.sessionManager.getSessionDir();
      const saved = clearToolResults(candidates, (msg) => ctx.ui.notify(`[ACM] ${msg}`, "info"), branchMessages, sessionDir);
      persist(pi.appendEntry.bind(pi));

      const report = `[ACM] ✅ Cleared ${candidates.length} tool results (~${Math.round(saved * 0.4 / 1000)}k freed, ${clearSet.size} total). Effect on next turn.`;
      ctx.ui.notify(report, "info");
      ctx.ui.setStatus("acm", `${statusText()} | pending…`);

      return { content: [{ type: "text" as const, text: report }], details: { count: candidates.length, estimatedTokensSaved: saved } };
    },
  });

  // ── Tool: acm_slide ─────────────────────────────────────────────────

  pi.registerTool({
    name: "acm_slide",
    label: "ACM Slide",
    description:
      "Trigger a sliding window compaction. Summarizes old context and keeps recent. " +
      "Fires session_before_compact where ACM generates a custom summary.",
    promptSnippet: "acm_slide: Trigger sliding window compaction to summarize old context.",
    parameters: Type.Object({
      customInstructions: Type.Optional(Type.String({ description: "Custom instructions for the summary generation." })),
      keepMessages: Type.Optional(Type.Number({ description: "Keep last N messages (default 10). E.g. 20 keeps more context." })),
      keepMinutes: Type.Optional(Type.Number({ description: "Keep messages from last N minutes (default 30). E.g. 10 for aggressive slide." })),
    }),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const branch = ctx.sessionManager.getBranch() as any[];
      buildToolCallMapping(branch);
      const params = _params as { keepMessages?: number; keepMinutes?: number };

      const cutoff = findHybridCutoff(branch, {
        keepMessages: params.keepMessages,
        keepMinutes: params.keepMinutes,
      });
      if (cutoff === 0) {
        return { content: [{ type: "text" as const, text: "[ACM] Session too short to slide." }], details: { success: false } };
      }

      // Clear all tool results + compact old messages
      const clearedBefore = clearSet.size;
      const sessionDir = ctx.sessionManager.getSessionDir();
      clearToolResults(inventoryToolResults(getBranchMessages(branch)), (msg) => ctx.ui.notify(`[ACM] ${msg}`, "info"), getBranchMessages(branch), sessionDir);
      const toolResultsCleared = clearSet.size - clearedBefore;

      let messagesCompacted = 0;
      for (let i = 0; i < cutoff; i++) {
        const e = branch[i];
        if (e.type === "message" && e.message && !pinnedSet.has(e.id)) {
          compactSet.add(e.id);
          messagesCompacted++;
        }
      }

      persist(pi.appendEntry.bind(pi));
      ctx.ui.setStatus("acm", `${statusText()} | slid`);

      const kept = branch.length - cutoff;
      return {
        content: [{
          type: "text" as const,
          text: `[ACM] ✅ Slide: ${toolResultsCleared} tool results cleared, ${messagesCompacted} messages compacted (shrunk to keyword stubs), ${kept} recent messages kept intact, ${pinnedSet.size} pinned. All recallable via acm_recall.`,
        }],
        details: { success: true, cutoff, kept, toolResultsCleared, messagesCompacted },
      };
    },
  });

  // ── Tool: acm_recall ────────────────────────────────────────────────

  pi.registerTool({
    name: "acm_recall",
    label: "ACM Recall",
    description:
      "Search the index of cleared/cached tool results. Returns file paths and metadata only — no content. " +
      "Use bash (rg, grep, head, jq) on returned file paths to retrieve actual content.",
    promptSnippet: "acm_recall: Search index of cached/cleared results. Returns paths + keywords, NO content. Use bash to read cache files.",
    parameters: Type.Object({
      entryId: Type.Optional(Type.String({ description: "Exact session entry ID to look up." })),
      query: Type.Optional(Type.String({ description: "Keyword search across cleared tool results." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      // Index-only: return metadata + file paths, never content
      const formatEntry = (recall: RecallMetadata) => {
        const cachePath = cachedToFile.get(recall.toolCallId);
        const age = Math.round((Date.now() - recall.timestamp) / 60000);
        return [
          `  tool: ${recall.toolName}`,
          `  keywords: ${recall.keyTerms.slice(0, 100)}`,
          cachePath ? `  cached: ${cachePath}` : `  entryId: ${recall.entryId} (session-only, no cache file)`,
          `  age: ${age}m ago | size: ${Math.round(recall.charCount / 1024)}KB`,
        ].join("\n");
      };

      if (params.entryId) {
        // Look up by entryId
        const recall = [...recallIndex.values()].find(r => r.entryId === params.entryId);
        if (!recall) return { content: [{ type: "text" as const, text: `[ACM] Entry ${params.entryId} not in recall index.` }], details: { found: false } };
        const info = formatEntry(recall);
        return {
          content: [{ type: "text" as const, text: `[ACM Recall] Found:\n${info}\n\nUse bash to read the cached file.` }],
          details: { source: "entryId", entryId: params.entryId },
        };
      }

      if (params.query) {
        const terms = params.query.toLowerCase().split(/\s+/).filter(Boolean);
        const matches: Array<{ entry: RecallMetadata; score: number }> = [];
        for (const recall of recallIndex.values()) {
          const searchable = `${recall.toolName} ${recall.keyTerms} ${recall.filePaths.join(" ")}`.toLowerCase();
          const score = terms.filter((t) => searchable.includes(t)).length;
          if (score > 0) matches.push({ entry: recall, score });
        }
        matches.sort((a, b) => b.score - a.score);

        if (matches.length === 0) {
          return { content: [{ type: "text" as const, text: `[ACM] No results for: "${params.query}"` }], details: { found: false } };
        }

        const lines = matches.slice(0, 10).map((m, i) => `${i + 1}. ${formatEntry(m.entry)}`);
        const report = [
          `[ACM Recall] ${matches.length} match${matches.length > 1 ? "es" : ""}:`,
          ...lines,
          ``,
          `Use bash (rg, grep, head) on cached file paths to retrieve content.`,
        ].join("\n");

        return {
          content: [{ type: "text" as const, text: report }],
          details: { source: "keyword", matches: matches.length },
        };
      }

      // No params: list all cached entries
      const all = [...recallIndex.values()].sort((a, b) => b.timestamp - a.timestamp);
      if (all.length === 0) {
        return { content: [{ type: "text" as const, text: "[ACM] Recall index empty." }], details: {} };
      }
      const lines = all.slice(0, 15).map((r, i) => `${i + 1}. ${formatEntry(r)}`);
      const report = [
        `[ACM Recall] ${all.length} entries in index:`,
        ...lines,
        all.length > 15 ? `  ... +${all.length - 15} more` : "",
        ``,
        `Use bash (rg, grep, head) on cached file paths to retrieve content.`,
      ].filter(Boolean).join("\n");

      return { content: [{ type: "text" as const, text: report }], details: { total: all.length } };
    },
  });

  // ── Tool: acm_pin ───────────────────────────────────────────────────

  pi.registerTool({
    name: "acm_pin",
    label: "ACM Pin",
    description: "Pin a message to protect it from clearing and sliding. Pinned messages survive all ACM operations.",
    promptSnippet: "acm_pin: Pin/unpin entries to protect from context clearing.",
    parameters: Type.Object({
      entryId: Type.String({ description: "Session entry ID to pin/unpin." }),
      action: Type.Optional(Type.Union([Type.Literal("pin"), Type.Literal("unpin")], { description: "Pin or unpin. Default: pin." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const action = params.action ?? "pin";
      const { entryId } = params;

      const branch = ctx.sessionManager.getBranch() as any[];
      if (!branch.some((e: any) => e.id === entryId)) {
        return { content: [{ type: "text" as const, text: `[ACM] Entry ${entryId} not found on branch.` }], details: {} };
      }

      if (action === "pin") {
        pinnedSet.add(entryId);
        for (const [tcId, eId] of toolCallIdToEntryId) {
          if (eId === entryId) { clearSet.delete(tcId); recallIndex.delete(tcId); }
        }
      } else {
        pinnedSet.delete(entryId);
      }

      persistPin(pi.appendEntry.bind(pi), entryId, action);
      const report = `[ACM] ${action === "pin" ? "📌 Pinned" : "🔓 Unpinned"} ${entryId} (${pinnedSet.size} total)`;
      ctx.ui.notify(report, "info");
      return { content: [{ type: "text" as const, text: report }], details: { entryId, action } };
    },
  });

  // ── Tool: acm_compact_messages ─────────────────────────────────────

  pi.registerTool({
    name: "acm_compact_messages",
    label: "ACM Compact Messages",
    description:
      "Compact large assistant/user messages to keyword summaries with entry ID pointers. " +
      "Keeps tool call blocks intact. Pinned messages are skipped. " +
      "Original content retrievable via acm_recall.",
    promptSnippet: "acm_compact_messages: Compact large messages to keyword stubs. Use after acm_clear if context still high.",
    promptGuidelines: [
      "Use AFTER acm_clear when context still high. Compacts reasoning/user messages to keywords + ID pointers.",
      "Pinned messages never compacted. Recent messages should generally not be compacted.",
    ],
    parameters: Type.Object({
      olderThanMinutes: Type.Optional(Type.Number({ description: "Only compact messages older than N minutes." })),
      minChars: Type.Optional(Type.Number({ description: "Only compact messages larger than N characters. Default: 1000" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const branch = ctx.sessionManager.getBranch() as any[];
      buildToolCallMapping(branch);
      const minChars = params.minChars ?? 1000;
      const now = Date.now();
      let compacted = 0;
      let charsSaved = 0;

      for (const entry of branch) {
        if (entry.type !== "message" || !entry.message) continue;
        if (entry.message.role === "toolResult") continue;
        if (pinnedSet.has(entry.id) || compactSet.has(entry.id)) continue;

        if (params.olderThanMinutes != null) {
          const ts = typeof entry.timestamp === "number" ? entry.timestamp
            : typeof entry.timestamp === "string" ? new Date(entry.timestamp).getTime() : 0;
          if (now - ts < params.olderThanMinutes * 60 * 1000) continue;
        }

        const result = compactMessage(entry.message, entry.id);
        if (!result || result.saved < minChars) continue;

        compactSet.add(entry.id);
        charsSaved += result.saved;
        compacted++;

        const textContent = Array.isArray(entry.message.content)
          ? entry.message.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join(" ")
          : typeof entry.message.content === "string" ? entry.message.content : "";
        recallIndex.set(entry.id, {
          entryId: entry.id, toolCallId: "", toolName: entry.message.role,
          filePaths: [], keyTerms: textContent.slice(0, 200), timestamp: Date.now(), charCount: textContent.length,
        });
      }

      if (compacted === 0) {
        return { content: [{ type: "text" as const, text: "[ACM] No messages large enough to compact." }], details: { count: 0 } };
      }

      persist(pi.appendEntry.bind(pi));
      const tokensSaved = Math.round(charsSaved * 0.4 / 4);
      const report = `[ACM] ✅ Compacted ${compacted} messages (~${Math.round(charsSaved / 1000)}k chars, ~${Math.round(tokensSaved / 1000)}k tokens freed). Effect on next turn.`;
      ctx.ui.notify(report, "info");
      ctx.ui.setStatus("acm", `${statusText()} | pending…`);

      return { content: [{ type: "text" as const, text: report }], details: { count: compacted, charsSaved, tokensSaved } };
    },
  });

  // ── Compaction intercept ───────────────────────────────────────────

  pi.on("session_before_compact", async (event, ctx) => {
    const { preparation, branchEntries, signal } = event;
    const { messagesToSummarize, turnPrefixMessages, previousSummary, tokensBefore, firstKeptEntryId, fileOps, isSplitTurn } = preparation;

    if (signal.aborted) return;
    ctx.ui.notify(`[ACM] ⚡ Compaction intercepted`, "info");

    buildToolCallMapping(branchEntries as any[]);
    const allMessages = [...messagesToSummarize, ...turnPrefixMessages];
    const toolResults = inventoryToolResults(allMessages);
    const savings = toolResults.reduce((s, r) => s + r.tokens - 50, 0);

    const usage = ctx.getContextUsage();
    const contextWindow = usage?.contextWindow ?? 200_000;
    const threshold = (preparation as any).settings?.reserveTokens ?? 16384;
    const tokensToFree = tokensBefore - (contextWindow - threshold);
    const conservativeSavings = Math.round(savings * 0.4);

    ctx.ui.notify(`[ACM] Need ~${Math.round(tokensToFree / 1000)}k free. Clearable: ${toolResults.length} results (~${Math.round(conservativeSavings / 1000)}k)`, "info");

    // ── Phase 1: Clear all tool results ──
    const sessionDir = ctx.sessionManager.getSessionDir();
    clearToolResults(toolResults, (msg) => ctx.ui.notify(`[ACM] ${msg}`, "info"), allMessages, sessionDir);

    if (conservativeSavings >= tokensToFree) {
      ctx.ui.notify(`[ACM] ✅ Phase 1 sufficient — cancelled default compaction`, "info");
      persist(pi.appendEntry.bind(pi));
      return { cancel: true };
    }

    // ── Phase 2: Slide with LLM summary ──
    ctx.ui.notify(`[ACM] Phase 1 insufficient (~${Math.round(conservativeSavings / 1000)}k < ${Math.round(tokensToFree / 1000)}k). Generating summary...`, "info");
    if (signal.aborted) return;

    const model = ctx.model;
    if (!model) { ctx.ui.notify(`[ACM] No model — fallback to default`, "warning"); return; }
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok || !auth.apiKey) { ctx.ui.notify(`[ACM] Auth failed — fallback`, "warning"); return; }

    const conversationText = serializeConversation(convertToLlm(messagesToSummarize));
    const previousContext = previousSummary ? `\n\nPrevious session summary:\n${previousSummary}` : "";

    const summaryMessages = [{
      role: "user" as const,
      content: [{
        type: "text" as const, text: `You are a conversation summarizer. Create a structured summary:${previousContext}

## Goal
[What the user is trying to accomplish]

## Constraints & Preferences
- [Requirements mentioned by user]

## Progress
### Done
- [x] [Completed tasks]

### In Progress
- [ ] [Current work]

## Key Decisions
- **[Decision]**: [Rationale]

## Next Steps
1. [What should happen next]

## Critical Context
- [Data needed to continue]

Be thorough but concise. This replaces the entire conversation history.

<conversation>
${conversationText}
</conversation>` }],
      timestamp: Date.now(),
    }];

    try {
      const response = await complete(model, { messages: summaryMessages }, { apiKey: auth.apiKey, headers: auth.headers, maxTokens: 8192, signal });
      let summary = response.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
      if (!summary.trim()) { if (!signal.aborted) ctx.ui.notify("[ACM] Empty summary — fallback", "warning"); return; }

      if (isSplitTurn && turnPrefixMessages.length > 0) {
        const prefixText = serializeConversation(convertToLlm(turnPrefixMessages));
        const prefixResponse = await complete(model, {
          messages: [{ role: "user" as const, content: [{ type: "text" as const, text: `Summarize concisely:\n\n<conversation>\n${prefixText}\n</conversation>` }], timestamp: Date.now() }],
        }, { apiKey: auth.apiKey, headers: auth.headers, maxTokens: 4096, signal });
        const prefixSummary = prefixResponse.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
        if (prefixSummary.trim()) summary += `\n\n---\n\n**Turn Context (split turn):**\n\n${prefixSummary}`;
      }

      // Append pinned content from entries being summarized
      const hybridCutoff = findHybridCutoff(branchEntries as any[]);
      const pinnedContent: string[] = [];
      for (let i = 0; i < hybridCutoff; i++) {
        const e = branchEntries[i] as any;
        if (pinnedSet.has(e.id) && e.message) pinnedContent.push(extractEntryContent(e));
      }
      if (pinnedContent.length > 0) summary += `\n\n## Pinned Context\n\n${pinnedContent.join("\n\n---\n\n")}`;

      // Append file operations
      const modified = new Set([...(fileOps as any).written, ...(fileOps as any).edited]);
      const readFiles = [...(fileOps as any).read].filter((f: string) => !modified.has(f)).sort();
      const modifiedFiles = [...modified].sort();
      if (readFiles.length > 0) summary += `\n\n<read-files>\n${readFiles.join("\n")}\n</read-files>`;
      if (modifiedFiles.length > 0) summary += `\n\n<modified-files>\n${modifiedFiles.join("\n")}\n</modified-files>`;

      ctx.ui.notify(`[ACM] ✅ Slide: ~${Math.round(summary.length / 4)} token summary, ${clearSet.size} cleared`, "info");
      persist(pi.appendEntry.bind(pi));

      return { compaction: { summary, firstKeptEntryId, tokensBefore, details: { readFiles, modifiedFiles } } };
    } catch (error) {
      if (!signal.aborted) ctx.ui.notify(`[ACM] Summary failed: ${error instanceof Error ? error.message : error}`, "error");
      return;
    }
  });

  // ── Branch navigation ──────────────────────────────────────────────

  pi.on("session_tree" as any, (_event: any, ctx: any) => {
    const branch = ctx.sessionManager.getBranch();
    buildToolCallMapping(branch);
    const valid = new Set(toolCallIdToEntryId.keys());
    let pruned = 0;
    for (const id of clearSet) {
      if (!valid.has(id)) { clearSet.delete(id); pruned++; }
    }
    if (pruned > 0) ctx.ui.notify(`[ACM] Branch nav: pruned ${pruned} stale entries`, "info");
  });
}
