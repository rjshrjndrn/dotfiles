/** Mutable ACM state and state operations. */

import type { RecallMetadata, RehydrateInput, RehydrateResult, PinnedContentEntry } from "./types.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { estimateTokens } from "@earendil-works/pi-coding-agent";
import { extractKeywords, getTextPreview } from "./helpers.ts";
import { extractToolCallPaths, acmConfig } from "./config.ts";
import { buildCachedStub } from "./cache.ts";

// ── Module-level state ───────────────────────────────────────────────

export const clearSet = new Set<string>();
export const toolCallIdToEntryId = new Map<string, string>();
export const recallIndex = new Map<string, RecallMetadata>();
export const pinnedSet = new Set<string>();
export const compactSet = new Set<string>();

// Shared mutable object so cross-module mutation works (object ref stable, fields mutable).
export const acmState = {
  totalTokensSaved: 0,
  lastAutoClearUserCount: 0,
};

// Fault-driven pinning (Pichay 2025, "Missing Pages" §3.2):
// Track evicted file paths. If LLM re-reads same path → auto-pin to stop thrashing.
// Production data shows <0.03% fault rate with this approach.
export const evictedPaths = new Map<string, string>(); // filePath → evicted toolCallId

// Fault-pin TTL: auto-unpin fault-pins after N turn boundaries.
// Manual pins (user-requested via acm_pin) are permanent — only fault-pins decay.
// If LLM still needs content after expiry, re-read triggers re-fault-pin (self-correcting).
export const FAULT_PIN_TTL = 5; // turns before fault-pin expires
export const faultPinTurns = new Map<string, number>(); // entryId → turn count when fault-pinned
export const MAX_EVICTED_PATHS = 200; // cap evictedPaths to prevent unbounded growth

export const cachedToFile = new Map<string, string>(); // toolCallId → cachePath

// Pinned content store — survives slides. Persisted to session.
export const pinnedContentStore = new Map<string, PinnedContentEntry>();

// ── Reset ────────────────────────────────────────────────────────────

export function _resetState() {
  clearSet.clear();
  toolCallIdToEntryId.clear();
  recallIndex.clear();
  pinnedSet.clear();
  compactSet.clear();
  acmState.totalTokensSaved = 0;
  acmState.lastAutoClearUserCount = 0;
  evictedPaths.clear();
  faultPinTurns.clear();
  cachedToFile.clear();
  pinnedContentStore.clear();
}

// ── Persistence ──────────────────────────────────────────────────────

export function persist(appendEntry: (type: string, data?: any) => void) {
  appendEntry("acm-clear-state", {
    clearedToolCallIds: [...clearSet],
    toolCallIdToEntryId: Object.fromEntries(toolCallIdToEntryId),
    totalTokensSaved: acmState.totalTokensSaved,
    compactedEntryIds: [...compactSet],
    lastAutoClearUserCount: acmState.lastAutoClearUserCount,
  });
  appendEntry("acm-recall-index", { entries: [...recallIndex.values()] });
  if (pinnedContentStore.size > 0) {
    appendEntry("acm-pinned-content", { entries: [...pinnedContentStore.values()] });
  }
}

export function persistPin(
  appendEntry: (type: string, data?: any) => void,
  entryId: string,
  action: "pin" | "unpin",
  opts?: { isFault?: boolean; pinnedAtTurn?: number },
) {
  appendEntry("acm-pin", { entryId, action, ...opts });
}

// ── Rehydrate (mutating) ─────────────────────────────────────────────

export function rehydrateState(entries: Array<{ type: string; customType?: string; data?: any }>) {
  let lastClearState: any;
  let lastRecallIndex: any;
  let lastPinnedContent: any;
  const pinEvents: Array<{ entryId: string; action: "pin" | "unpin"; isFault?: boolean; pinnedAtTurn?: number }> = [];

  for (const entry of entries) {
    if (entry.type !== "custom") continue;
    if (entry.customType === "acm-clear-state") lastClearState = entry.data;
    else if (entry.customType === "acm-recall-index") lastRecallIndex = entry.data;
    else if (entry.customType === "acm-pin" && entry.data) pinEvents.push(entry.data);
    else if (entry.customType === "acm-pinned-content" && entry.data) lastPinnedContent = entry.data;
  }

  if (lastClearState) {
    clearSet.clear();
    for (const id of lastClearState.clearedToolCallIds) clearSet.add(id);
    toolCallIdToEntryId.clear();
    for (const [k, v] of Object.entries(lastClearState.toolCallIdToEntryId)) {
      toolCallIdToEntryId.set(k, v as string);
    }
    acmState.totalTokensSaved = lastClearState.totalTokensSaved ?? 0;
    acmState.lastAutoClearUserCount = lastClearState.lastAutoClearUserCount ?? 0;
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

  // Rehydrate pinned content store
  pinnedContentStore.clear();
  if (lastPinnedContent?.entries) {
    for (const e of lastPinnedContent.entries) pinnedContentStore.set(e.entryId, e);
  }

  return { cleared: clearSet.size, recalled: recallIndex.size, pinned: pinnedSet.size };
}

// ── Rehydrate (pure) ─────────────────────────────────────────────────

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

export function buildToolCallMapping(branch: any[]) {
  toolCallIdToEntryId.clear();
  for (const entry of branch) {
    if (entry.type === "message" && entry.message?.role === "toolResult" && entry.message.toolCallId) {
      toolCallIdToEntryId.set(entry.message.toolCallId, entry.id);
    }
  }
}

export function inventoryToolResults(messages: AgentMessage[]) {
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

export function buildStub(msg: any): string {
  const toolName = msg.toolName || "unknown";
  const entryId = toolCallIdToEntryId.get(msg.toolCallId) || "?";
  const recall = recallIndex.get(msg.toolCallId);
  const source = recall?.keyTerms ?? getTextPreview(msg);
  // Cleared results get lean stub — no preview, regardless of cache status
  if (clearSet.has(msg.toolCallId)) {
    return `[cleared: ${toolName} | id: ${entryId} | ${extractKeywords(source, 10)}]`;
  }
  // Cached (intercepted) but not yet cleared — include filepath + preview
  const cachePath = cachedToFile.get(msg.toolCallId);
  if (cachePath) {
    return buildCachedStub(toolName, cachePath, source, getTextPreview(msg, acmConfig.previewChars ?? 1000));
  }
  return `[cleared: ${toolName} | id: ${entryId} | ${extractKeywords(source, 10)}]`;
}

export function buildRecallEntry(toolCallId: string, toolName: string, keyTerms: string, charCount: number, messages: AgentMessage[]): RecallMetadata {
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

export function clearToolResults(
  toolResults: Array<{ toolCallId: string; toolName: string; tokens: number; keyTerms: string }>,
  notify: (msg: string) => void,
  contextMessages: AgentMessage[],
): number {
  let saved = 0;
  for (const tr of toolResults) {
    if (clearSet.has(tr.toolCallId)) continue;
    const entryId = toolCallIdToEntryId.get(tr.toolCallId);
    if (entryId && pinnedSet.has(entryId)) {
      notify(`📌 ${tr.toolName} (${Math.round(tr.tokens / 1000)}k) — pinned, skip`);
      continue;
    }
    clearSet.add(tr.toolCallId);
    const tokensSaved = tr.tokens - 50;
    acmState.totalTokensSaved += tokensSaved;
    saved += tokensSaved;
    recallIndex.set(tr.toolCallId, buildRecallEntry(tr.toolCallId, tr.toolName, tr.keyTerms, tr.tokens * 4, contextMessages));
    notify(`✂ ${tr.toolName} (${Math.round(tr.tokens / 1000)}k) → stub [id: ${entryId || "?"}]`);
  }
  return saved;
}

export function statusText() {
  return `ACM: ${clearSet.size} cleared, ${compactSet.size} compacted | ~${Math.round(acmState.totalTokensSaved * 0.4 / 1000)}k saved`;
}
