/**
 * ACM — Adaptive Context Manager
 *
 * LLM-driven context management. No slash commands — LLM decides when and
 * what to prune using registered tools.
 *
 * Runtime-only context management. Does NOT intercept /compact (stock pi
 * LLM compaction runs unmodified).
 *
 * Manual: user says "acm prune" → LLM inspects context, calls acm_clear/acm_status.
 *
 * See acm-lib/ for extracted modules (types, config, helpers, cache, state).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  estimateTokens,
} from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── ACM lib imports ──────────────────────────────────────────────────

import type { RecallMetadata } from "../acm-lib/types.ts";
import {
  loadAcmConfig,
  discoverLocalTools,
  isExternalTool,
  acmConfig,
  extractToolCallPaths,
} from "../acm-lib/config.ts";
import {
  extractKeywords,
  getBranchMessages,
  getTextPreview,
  extractEntryContent,
  compactMessage,
  findHybridCutoff,
} from "../acm-lib/helpers.ts";
import {
  getCacheDir,
  writeCacheFile,
  buildCachedStub,
  getCacheStats,
  cacheToolResult,
} from "../acm-lib/cache.ts";
import {
  initGraph,
  insertToolResult as graphInsert,
  queryByKeyword as graphQueryByKeyword,
  queryByFile as graphQueryByFile,
  getRelated as graphGetRelated,
  getSequence as graphGetSequence,
  isGraphReady,
  getGraphStats,
  getGraphSummary,
} from "../acm-lib/graph.ts";

// ── Re-exports for backward compatibility (tests import from acm.ts) ──

export {
  type RecallMetadata,
  type RehydrateInput,
  type RehydrateResult,
  type AcmConfig,
} from "../acm-lib/types.ts";
export {
  extractKeywords,
  getBranchMessages,
  getTextPreview,
  extractEntryContent,
  compactMessage,
  findHybridCutoff,
  STOP_WORDS,
} from "../acm-lib/helpers.ts";
export {
  FILE_PATH_PARAMS,
  extractToolCallPaths,
  localToolSet,
  loadAcmConfig,
  discoverLocalTools,
  isExternalTool,
  acmConfig,
} from "../acm-lib/config.ts";
export {
  getCacheDir,
  writeCacheFile,
  extractToolResultText,
  buildCachedStub,
  getCacheStats,
} from "../acm-lib/cache.ts";
import {
  clearSet,
  toolCallIdToEntryId,
  recallIndex,
  pinnedSet,
  compactSet,
  acmState,
  evictedPaths,
  FAULT_PIN_TTL,
  faultPinTurns,
  MAX_EVICTED_PATHS,
  cachedToFile,
  pinnedContentStore,
  _resetState,
  persist,
  persistPin,
  rehydrateState,
  rehydrateStatePure,
  buildToolCallMapping,
  inventoryToolResults,
  buildStub,
  buildRecallEntry,
  clearToolResults,
  statusText,
  getActiveSlide,
  setActiveSlide,
} from "../acm-lib/state.ts";

// ── Graph sync helper ────────────────────────────────────────────────

import { appendFileSync } from "node:fs";
const ACM_LOG = "/tmp/ladybug-acm.log";
const ACM_DEBUG = process.env.ACM_DEBUG === "true" || process.env.ACM_DEBUG === "1";
function acmLog(msg: string): void {
  if (!ACM_DEBUG) return;
  try { appendFileSync(ACM_LOG, `[${new Date().toISOString()}] ${msg}\n`); } catch {}
}

// Stored ref for status updates from syncToGraph
let _setStatus: ((id: string, text: string) => void) | null = null;

/** Sync a recall entry to the graph DB (fire-and-forget). */
function syncToGraph(recall: RecallMetadata): void {
  acmLog(`syncToGraph called, graphReady=${isGraphReady()}, id=${recall.toolCallId || recall.entryId}`);
  if (!isGraphReady()) { acmLog("graph not ready, skipping"); return; }
  graphInsert({
    id: recall.toolCallId || recall.entryId,
    toolName: recall.toolName,
    keyTerms: recall.keyTerms,
    filePaths: recall.filePaths,
    timestamp: recall.timestamp,
  }).then(async () => {
    acmLog(`inserted ${recall.toolCallId || recall.entryId} ok, filePaths=[${recall.filePaths.join(",")}]`);
    if (_setStatus) {
      const gs = await getGraphStats();
      _setStatus("ladybugdb", `\ud83e\udd8e ${gs.toolResults} entries, ${gs.filePaths} files`);
    }
  }).catch((err: any) => {
    acmLog(`syncToGraph ERROR: ${err?.message || err}`);
  });
}

// ── Extension ────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {

  // ── Rehydrate on session load ──────────────────────────────────────

  pi.on("session_start" as any, (_event: any, ctx: any) => {
    _setStatus = (id: string, text: string) => ctx.ui.setStatus(id, text);
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
      } catch { }
    }
    if (stats.cleared > 0 || stats.pinned > 0) {
      ctx.ui.notify(`[ACM] Restored: ${stats.cleared} cleared, ${stats.pinned} pinned, ${stats.recalled} in recall, ${cachedToFile.size} cached`, "info");
    }

    // Initialize LadybugDB graph for relational recall
    const graphDir = join(getCacheDir(sessionDir), "graph");
    acmLog(`initGraph at ${join(graphDir, "acm.lbug")}`);
    initGraph(join(graphDir, "acm.lbug")).then(async () => {
      acmLog(`initGraph SUCCESS, ready=${isGraphReady()}`);
      const gs = await getGraphStats();
      ctx.ui.setStatus("ladybugdb", `🦎 ${gs.toolResults} entries, ${gs.filePaths} files`);
    }).catch((err: any) => {
      acmLog(`initGraph FAILED: ${err.message}`);
      ctx.ui.notify(`[ACM] Graph init failed: ${err.message}`, "warn");
    });
  });

  // ── Tool result intercept: cache external tool outputs to disk ─────
  // External tool results never enter context. Written to .acm/cache/,
  // LLM gets stub with filepath, self-serves via bash.

  pi.on("tool_result" as any, async (event: any, ctx: any) => {
    const toolName = event.toolName || "unknown";
    const toolArgs = event.input;
    if (!isExternalTool(toolName, toolArgs)) return; // local tool, pass through

    // Skip interception when reading ACM's own cache files — prevents infinite recursion
    // where reading a cached result creates another cached result
    const argsStr = typeof toolArgs === "string" ? toolArgs : JSON.stringify(toolArgs ?? "");
    if (argsStr.includes(".acm/cache/")) return;

    // Extract text content from the result
    const content = Array.isArray(event.content)
      ? event.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n")
      : typeof event.content === "string" ? event.content : "";
    if (!content) return;

    // Small results: pass through directly — not worth caching to disk
    // LLM can consume <2000 chars in-context cheaper than bash-reading a file
    if (content.length < (acmConfig.cacheMinChars ?? 2000)) return;

    // Write to cache file
    const sessionDir = ctx.sessionManager.getSessionDir();
    try {
      const cachePath = writeCacheFile(sessionDir, toolName, event.toolCallId, content);
      cachedToFile.set(event.toolCallId, cachePath);
      ctx.ui.notify(`[ACM] 💾 ${toolName} → intercepted, cached to: ${cachePath} (content not sent to LLM)`, "info");

      // Replace content with stub — full result never enters context
      const keyTerms = content.slice(0, 200);
      return {
        content: [{ type: "text" as const, text: buildCachedStub(toolName, cachePath, keyTerms, content) }],
      };
    } catch (e) {
      ctx.ui.notify(`[ACM] ⚠️ ${toolName} cache write failed: ${e instanceof Error ? e.message : e}`, "info");
      // Fall through — full result enters context as fallback
    }
  });

  // ── Context event: apply clearing/compaction ───────────────────────

  pi.on("context", (event, ctx) => {
    // ── Slide filter: trim messages before cutoff ──
    // Runs first — reduces the message set before any other processing.
    const slide = getActiveSlide();
    if (slide) {
      const branch = ctx.sessionManager.getBranch() as any[];
      // Find the index of the cutoff entry in the branch
      const cutoffIdx = branch.findIndex((e: any) => e.id === slide.cutoffEntryId);
      if (cutoffIdx > 0) {
        // Build a set of entry IDs to keep (cutoff and after)
        const keepEntryIds = new Set<string>();
        for (let i = cutoffIdx; i < branch.length; i++) {
          if (branch[i].id) keepEntryIds.add(branch[i].id);
        }
        // Filter event.messages — keep only messages from kept entries.
        // We need to map messages back to entries via msgEntryId (built below),
        // but we don't have it yet. Instead, rebuild messages from kept branch entries.
        const keptMessages: any[] = [];
        // Prepend slide summary as a user message
        keptMessages.push({
          role: "user",
          content: [{ type: "text", text: `<summary>\n${slide.summary}\n</summary>` }],
        });
        for (let i = cutoffIdx; i < branch.length; i++) {
          const e = branch[i] as any;
          if (e.type === "message" && e.message) {
            keptMessages.push(e.message);
          }
        }
        // Replace event.messages with kept subset (new array — don't mutate original for UI)
        event.messages = keptMessages;
      }
    }

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

    // Purge stale clearSet entries not in current branch (source of truth).
    // event.messages may not contain all toolCallIds (intercepted results etc.).
    if (clearSet.size > 0) {
      const branchToolCallIds = new Set<string>();
      for (const entry of branch) {
        if (entry.type !== "message" || !entry.message) continue;
        const msg = (entry as any).message;
        if (msg.role === "toolResult" && msg.toolCallId) branchToolCallIds.add(msg.toolCallId);
      }
      let purgedCount = 0;
      for (const tcId of clearSet) {
        if (!branchToolCallIds.has(tcId)) { clearSet.delete(tcId); purgedCount++; }
      }
      if (purgedCount > 0) {
        ctx.ui.notify(`[ACM] Purged ${purgedCount} stale clearSet entries (now ${clearSet.size})`, "info");
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

    // Count user messages (needed by fault detection and auto-clear)
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
    // Runs BEFORE message mapping so stubs apply in same turn (no 1-turn delay).
    // Only evict when a NEW user message arrives (turn boundary).
    // Mid-turn tool results stay — LLM may still need them for reasoning.
    if (currentUserCount > acmState.lastAutoClearUserCount) {
      acmState.lastAutoClearUserCount = currentUserCount;

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
      for (const entry of branch) {
        if (entry.type !== "message" || !entry.message) continue;
        const msg = entry.message as any;
        if (msg.role !== "toolResult" || !msg.toolCallId) continue;
        if (clearSet.has(msg.toolCallId)) continue;
        if (pinnedSet.has(entry.id)) continue;
        if (recentToolCallIds.has(msg.toolCallId)) continue; // protect recent
        const tokens = estimateTokens(msg);
        clearSet.add(msg.toolCallId);
        acmState.totalTokensSaved += Math.max(tokens - 50, 0);
        const textContent = Array.isArray(msg.content)
          ? msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join(" ").slice(0, 2000)
          : "";
        const recall = buildRecallEntry(msg.toolCallId, msg.toolName || "unknown", textContent, tokens * 4, getBranchMessages(branch));
        recallIndex.set(msg.toolCallId, recall);
        syncToGraph(recall);
        // Cache local tool results to disk before clearing (prevents content loss)
        if (!cachedToFile.has(msg.toolCallId)) {
          const sessionDir = ctx.sessionManager.getSessionDir();
          const cachePath = cacheToolResult(sessionDir, msg.toolName || "unknown", msg.toolCallId, msg);
          if (cachePath) cachedToFile.set(msg.toolCallId, cachePath);
        }
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

    // ── Build messages: apply stubs, strip thinking, compact ──
    // Mutate in-place so agent.state.messages (same ref) reflects changes
    // in the UI token count, not just the ephemeral API call.
    // Runs AFTER auto-clear so newly cleared items get stubbed immediately.
    const messages = event.messages;
    for (let idx = 0; idx < messages.length; idx++) {
      const msg = messages[idx] as any;

      // Clear tool results
      if (msg.role === "toolResult" && msg.toolCallId && clearSet.has(msg.toolCallId)) {
        msg.content = [{ type: "text" as const, text: buildStub(msg) }];
        continue;
      }

      // Strip thinking blocks from old messages
      if (msg.role === "assistant" && Array.isArray(msg.content) && idx < recentThreshold) {
        const hasThinking = msg.content.some((b: any) => b.type === "thinking");
        if (hasThinking) {
          const stripped = msg.content.filter((b: any) => b.type !== "thinking");
          msg.content = stripped.length > 0 ? stripped : [{ type: "text", text: "[thinking stripped]" }];
        }
      }

      // Compact marked messages
      const entryId = msgEntryId.get(msg) || (msg.toolCallId ? tcEntryId.get(msg.toolCallId) : undefined);
      if (entryId && compactSet.has(entryId) && !pinnedSet.has(entryId)) {
        const compacted = compactMessage(msg, entryId);
        if (compacted) msg.content = compacted.content;
      }
    }

    // Inject ACM context into first user message (before pinned prepend,
    // so pinned messages don't absorb the acm-context block)
    const cachedCount = cachedToFile.size;
    const hasSlid = pinnedContentStore.size > 0 || messages.some((m: any) => {
      if (typeof m.content === "string") return m.content.includes("slid away");
      if (Array.isArray(m.content)) return m.content.some((b: any) => b.type === "text" && b.text?.includes("slid away"));
      return false;
    });
    if (clearSet.size > 0 || compactSet.size > 0 || cachedCount > 0 || hasSlid) {
      const acmText = [
        `<acm-context>`,
        `${clearSet.size} tool results cleared, ${compactSet.size} messages compacted, ${pinnedSet.size} pinned, ${cachedCount} cached to disk.`,
        hasSlid ? `Earlier context was slid away. For prior conversation, decisions, or file content: use acm_recall(query: "keywords") or acm_recall(entryId: "id").` : ``,
        `Thinking blocks stripped from old messages (last ${recentTurns} turns preserved).`,
        cachedCount > 0
          ? `CACHED RESULTS: ${cachedCount} tool results were intercepted and saved to disk instead of entering context. When you see a [cached: /path/...] stub, you MUST read the file (bash head/rg/grep) to get the actual content. Do NOT skip or guess.`
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

    // Prepend pinned content from store (survives slides)
    // Done AFTER acm-context injection so pinned messages don't absorb it.
    if (pinnedContentStore.size > 0) {
      const pinnedMessages: any[] = [];
      for (const [entryId, entry] of pinnedContentStore) {
        // Skip if pin was removed
        if (!pinnedSet.has(entryId)) continue;
        // Skip if entry still exists in current branch (not yet slid)
        const alreadyInBranch = branch.some((e: any) => e.id === entryId);
        if (alreadyInBranch) continue;
        // Re-inject as "user" role — original tool_use context is gone after slide,
        // so toolResult without toolCallId would fail API validation.
        pinnedMessages.push({
          role: "user",
          content: [{ type: "text", text: `[pinned:${entryId.slice(0, 8)}] ${entry.content}` }],
        });
      }
      if (pinnedMessages.length > 0) {
        messages.unshift(...pinnedMessages);
      }
    }

    const usage = ctx.getContextUsage();
    const pct = usage?.percent != null ? `${Math.round(usage.percent)}%` : "?";

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
        `Saved: ~${Math.round(acmState.totalTokensSaved * 0.4 / 1000)}k`,
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

      const saved = clearToolResults(candidates, (msg) => ctx.ui.notify(`[ACM] ${msg}`, "info"), branchMessages);
      persist(pi.appendEntry.bind(pi));

      const report = `[ACM] ✅ Cleared ${candidates.length} tool results (~${Math.round(saved * 0.4 / 1000)}k freed, ${clearSet.size} total). Effect on next turn.`;
      ctx.ui.notify(report, "info");

      return { content: [{ type: "text" as const, text: report }], details: { count: candidates.length, estimatedTokensSaved: saved } };
    },
  });

  // ── Tool: acm_slide ─────────────────────────────────────────────────

  pi.registerTool({
    name: "acm_slide",
    label: "ACM Slide",
    description:
      "Sliding window compaction. Resets branch head to cutoff point. " +
      "Old messages fully removed from LLM context but searchable via acm_recall.",
    promptSnippet: "acm_slide: Sliding window — discard old context, reset branch head. Pinned content persisted. Old context searchable via acm_recall.",
    parameters: Type.Object({
      keepMessages: Type.Optional(Type.Number({ description: "Keep last N user turns (default 10). E.g. 20 keeps more context." })),
      keepMinutes: Type.Optional(Type.Number({ description: "Keep messages from last N minutes (default 30). E.g. 10 for aggressive slide." })),
    }),
    async execute(_toolCallId, _params, signal, _onUpdate, ctx) {
      const branch = ctx.sessionManager.getBranch() as any[];
      buildToolCallMapping(branch);
      const params = _params as { keepMessages?: number; keepMinutes?: number; customInstructions?: string };

      const cutoff = findHybridCutoff(branch, {
        keepMessages: params.keepMessages,
        keepMinutes: params.keepMinutes,
      });
      if (cutoff === 0) {
        return { content: [{ type: "text" as const, text: "[ACM] Session too short to slide." }], details: { success: false } };
      }

      // Find firstKeptEntryId
      const firstKeptEntry = branch[cutoff];
      if (!firstKeptEntry?.id) {
        return { content: [{ type: "text" as const, text: "[ACM] Cannot find entry at cutoff." }], details: { success: false } };
      }
      const firstKeptEntryId = firstKeptEntry.id;

      const usage = ctx.getContextUsage();
      const tokensBefore = usage?.tokens ?? 0;

      // Count discarded entries
      let discardedCount = 0;
      for (let i = 0; i < cutoff; i++) {
        if (branch[i].type === "message") discardedCount++;
      }

      // Persist pinned content to store before slide (survives branch reset)
      for (let i = 0; i < cutoff; i++) {
        const e = branch[i] as any;
        if (pinnedSet.has(e.id) && e.message) {
          pinnedContentStore.set(e.id, {
            entryId: e.id,
            role: e.message.role || "unknown",
            content: extractEntryContent(e),
            toolName: e.message.toolName,
            pinnedAt: Date.now(),
          });
        }
      }

      // Index slid-away messages in recall before discarding
      for (let i = 0; i < cutoff; i++) {
        const e = branch[i] as any;
        if (e.type !== "message" || !e.message) continue;
        if (e.message.toolCallId && !recallIndex.has(e.message.toolCallId)) {
          const textContent = extractEntryContent(e).slice(0, 2000);
          const recall = buildRecallEntry(e.message.toolCallId, e.message.toolName || e.message.role || "unknown", textContent, 0, getBranchMessages(branch));
          recallIndex.set(e.message.toolCallId, recall);
          syncToGraph(recall);
        }
      }

      // Build minimal summary (no LLM call, no inlined pinned content)
      let summary = "[Context before this point was slid away. Use acm_recall to search old context.]";

      // Append graph summary if available
      if (isGraphReady()) {
        try {
          const gs = await getGraphSummary();
          if (gs.toolResults > 0) {
            const basenames = [...new Set(gs.filePaths.map((p: string) => p.split("/").slice(-2).join("/")))].slice(0, 20);
            summary += `\n\nGraph context (${gs.toolResults} cached results, ${gs.filePaths.length} files):`;
            if (basenames.length > 0) summary += `\nFiles: ${basenames.join(", ")}`;
            if (basenames.length < gs.filePaths.length) summary += ` (+${gs.filePaths.length - basenames.length} more)`;
          }
        } catch {}
      }
      const kept = branch.length - cutoff;

      // Set active slide — context event will filter messages on every turn.
      // No session mutation: UI keeps full tree, only LLM context is filtered.
      setActiveSlide({ cutoffEntryId: firstKeptEntryId, summary });

      // Clean up ACM state for discarded entries + stale pins
      for (let i = 0; i < cutoff; i++) {
        const e = branch[i] as any;
        if (e.id) {
          compactSet.delete(e.id);
          // clearSet is keyed by toolCallId, not entryId
          if (e.message?.toolCallId) clearSet.delete(e.message.toolCallId);
          // Don't remove from pinnedSet — content is in pinnedContentStore
        }
      }
      // Purge stale clearSet entries not in remaining branch
      const remainingToolCallIds = new Set<string>();
      for (let i = cutoff; i < branch.length; i++) {
        const e = branch[i] as any;
        if (e.message?.toolCallId) remainingToolCallIds.add(e.message.toolCallId);
      }
      for (const tcId of clearSet) {
        if (!remainingToolCallIds.has(tcId)) clearSet.delete(tcId);
      }
      // GC recallIndex + cachedToFile — remove entries for slid-away messages
      for (const tcId of recallIndex.keys()) {
        if (!remainingToolCallIds.has(tcId)) recallIndex.delete(tcId);
      }
      for (const tcId of cachedToFile.keys()) {
        if (!remainingToolCallIds.has(tcId)) cachedToFile.delete(tcId);
      }

      // Reset auto-clear counter — post-slide branch has fewer user messages,
      // so old count would block auto-clear from ever firing again.
      acmState.lastAutoClearUserCount = 0;
      persist(pi.appendEntry.bind(pi));

      const report = `[ACM] ✅ Slide complete: ${discardedCount} messages discarded, ${kept} recent entries kept, branch head reset. Old context searchable via acm_recall.`;
      ctx.ui.notify(report, "info");

      return {
        content: [{ type: "text" as const, text: report }],
        details: { success: true, cutoff, kept, discardedCount },
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

        // Augment with graph results if available
        let graphSection = "";
        acmLog(`recall query: "${params.query}", graphReady=${isGraphReady()}, mapMatches=${matches.length}`);
        if (isGraphReady()) {
          try {
            const graphHits = await graphQueryByKeyword(params.query);
            acmLog(`graph hits: ${graphHits.length}, ids: ${graphHits.map(g => g.id).join(",")}`);
            // Find graph-only results not in Map matches
            const mapIds = new Set(matches.map(m => m.entry.toolCallId || m.entry.entryId));
            const graphOnly = graphHits.filter(g => !mapIds.has(g.id));
            graphSection = `\n\n[Graph: ${graphHits.length} total, ${graphOnly.length} unique]`;
            if (graphOnly.length > 0) {
              graphSection += `\n[Graph-only matches: ${graphOnly.length}]\n` +
                graphOnly.slice(0, 5).map(g =>
                  `  • ${g.toolName} | ${g.keyTerms.slice(0, 80)} | files: ${g.filePaths.join(", ") || "none"}`
                ).join("\n");
            }
            // Also find related via co-file traversal from top match
            if (matches.length > 0) {
              const topId = matches[0].entry.toolCallId || matches[0].entry.entryId;
              const related = await graphGetRelated(topId);
              acmLog(`related for ${topId}: ${related.length} results`);
              if (related.length > 0) {
                graphSection += `\n\n[Related (shared files): ${related.length}]\n` +
                  related.slice(0, 5).map(r =>
                    `  • ${r.toolName} | ${r.keyTerms.slice(0, 80)} | files: ${r.filePaths.join(", ") || "none"}`
                  ).join("\n");
              }
            }
          } catch (gErr: any) {
            acmLog(`recall query ERROR: ${gErr?.message || gErr}`);
          }
        }

        if (matches.length === 0 && !graphSection) {
          return { content: [{ type: "text" as const, text: `[ACM] No results for: "${params.query}"` }], details: { found: false } };
        }

        const lines = matches.slice(0, 10).map((m, i) => `${i + 1}. ${formatEntry(m.entry)}`);
        const report = [
          `[ACM Recall] ${matches.length} match${matches.length > 1 ? "es" : ""}:`,
          ...lines,
          graphSection,
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
        const compactRecall: RecallMetadata = {
          entryId: entry.id, toolCallId: "", toolName: entry.message.role,
          filePaths: [], keyTerms: textContent.slice(0, 200), timestamp: Date.now(), charCount: textContent.length,
        };
        recallIndex.set(entry.id, compactRecall);
        syncToGraph(compactRecall);
      }

      if (compacted === 0) {
        return { content: [{ type: "text" as const, text: "[ACM] No messages large enough to compact." }], details: { count: 0 } };
      }

      persist(pi.appendEntry.bind(pi));
      const tokensSaved = Math.round(charsSaved * 0.4 / 4);
      const report = `[ACM] ✅ Compacted ${compacted} messages (~${Math.round(charsSaved / 1000)}k chars, ~${Math.round(tokensSaved / 1000)}k tokens freed). Effect on next turn.`;
      ctx.ui.notify(report, "info");

      return { content: [{ type: "text" as const, text: report }], details: { count: compacted, charsSaved, tokensSaved } };
    },
  });

  // No session_before_compact hook — /compact uses pi's stock LLM compaction.
  // ACM slide is context-only: filters event.messages, doesn't touch session tree.

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
