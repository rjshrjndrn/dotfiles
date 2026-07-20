/**
 * ACM — Adaptive Context Manager
 *
 * LLM-driven context management. No slash commands — LLM decides when and
 * what to prune using registered tools.
 *
 * Runtime-only context management. Does NOT intercept /compact (stock pi
 * LLM compaction runs unmodified).
 *
 * Manual: user asks to free tokens → LLM inspects context, calls acm_clear/acm_status.
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
  selectClearableToolResults,
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
  ftsSearch,
  ftsInit,
  deleteToolResults as graphDeleteToolResults,
} from "../acm-lib/graph.ts";
import { ProjectMemoryBridge } from "../acm-lib/project-memory-bridge.ts";
import { detectRepoRoot, detectWorktreeRoot } from "../acm-lib/git-root.ts";
import { searchSessions } from "../acm-lib/session-search.ts";
import { resolveId } from "../acm-lib/id-resolver.ts";
import { buildEntryMap } from "../acm-lib/entry-map.ts";
import { injectAcmContext, prependPinned } from "../acm-lib/context-mutations.ts";
import { alignEntryIds } from "../acm-lib/context-mapping.ts";
import { collectEphemeralToolCallIds } from "../acm-lib/ephemeral.ts";

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

// ── Shared context state (updated each turn by context handler) ──
let lastVisibleMessages: any[] = [];
let lastVisibleEntryIds: (string | null)[] = [];

// ── Graph sync helper ────────────────────────────────────────────────

import { appendFileSync } from "node:fs";
const ACM_LOG = "/tmp/acm.log";
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
      _setStatus("acm-graph", `\ud83d\uddc3\ufe0f ${gs.toolResults} entries, ${gs.filePaths} files`);
    }
  }).catch((err: any) => {
    acmLog(`syncToGraph ERROR: ${err?.message || err}`);
  });
}

// ── Extension ────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // ── Project memory bridge (cross-session, project-scoped) ───────────
  const projectBridge = new ProjectMemoryBridge({
    logFile: "/tmp/acm-project-bridge.log",
  });
  let projectBriefingCache = ""; // cached briefing text, set on session_start
  let _sessionDir = ""; // captured on session_start for Tier 3 search
  let filePrecheckCache = ""; // precheck warnings for files touched this turn

  // ── Rehydrate on session load ──────────────────────────────────────

  pi.on("session_start" as any, (_event: any, ctx: any) => {
    _setStatus = (id: string, text: string) => ctx.ui.setStatus(id, text);
    // Load config + discover local tools from runtime
    const config = loadAcmConfig(dirname(fileURLToPath(import.meta.url)));
    discoverLocalTools(ctx.getAllTools?.() ?? [], config);
    const stats = rehydrateState(ctx.sessionManager.getEntries());
    // Rehydrate cachedToFile map from existing cache files
    const sessionDir = ctx.sessionManager.getSessionDir();
    _sessionDir = sessionDir;
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

    // Initialize session graph (sqlite) for relational recall
    const graphDir = join(getCacheDir(sessionDir), "graph");
    acmLog(`initGraph at ${join(graphDir, "acm.db")}`);
    initGraph(join(graphDir, "acm.db")).then(async () => {
      acmLog(`initGraph SUCCESS, ready=${isGraphReady()}`);
      // Load FTS extension + build index from existing data
      const ftsOk = await ftsInit();
      acmLog(`ftsInit: ${ftsOk ? 'OK' : 'FAILED'}`);
      const gs = await getGraphStats();
      ctx.ui.setStatus("acm-graph", `🗃️ ${gs.toolResults} entries, ${gs.filePaths} files`);
    }).catch((err: any) => {
      acmLog(`initGraph FAILED: ${err.message}`);
      ctx.ui.notify(`[ACM] Graph init failed: ${err.message}`, "warn");
    });

    // ── Initialize project memory bridge ──────────────────────────────
    const cwd = ctx.cwd ?? process.cwd();
    const gitRoot = detectRepoRoot(cwd);
    const worktreeRoot = detectWorktreeRoot(cwd);
    const sessionId = ctx.sessionManager?.getSessionId?.() ?? `session-${Date.now()}`;

    // Set worktree root for path relativization (worktree root if in worktree, else normal root)
    if (worktreeRoot) projectBridge.setWorktreeRoot(worktreeRoot);

    projectBridge.onSessionStart({
      sessionId,
      cwd,
      gitRoot,
    }).then(async () => {
      if (projectBridge.isReady()) {
        acmLog(`projectBridge initialized for ${gitRoot}`);
        const pStats = await projectBridge.getStats();
        ctx.ui.setStatus("project-mem", `📁 ${pStats.sessions} sessions, ${pStats.events} events`);
        // Inject session briefing into context
        try {
          const briefing = await projectBridge.formatSessionBriefing();
          if (briefing) {
            projectBriefingCache = briefing;
            acmLog(`session briefing ready: ${briefing.length} chars`);
          }
        } catch (err: any) {
          acmLog(`briefing generation failed: ${err.message}`);
        }
      } else {
        acmLog(`projectBridge: no git root, disabled`);
      }
    }).catch((err: any) => {
      acmLog(`projectBridge init FAILED: ${err.message}`);
    });
  });

  // ── Turn end: feed to project memory decision gate ─────────────────

  pi.on("turn_end" as any, async (event: any, _ctx: any) => {
    acmLog(`turn_end: bridge ready=${projectBridge.isReady()}, tools=${(event.toolResults ?? []).length}`);
    if (!projectBridge.isReady()) return;
    try {
      // Build tool call argument map from assistant message's tool calls
      const toolCallArgs = new Map<string, any>();
      const msgContent = event.message?.content;
      if (Array.isArray(msgContent)) {
        for (const block of msgContent) {
          if (block.type === "toolCall" || block.type === "tool_use") {
            const id = block.id || block.toolCallId;
            const args = block.arguments || block.input || {};
            if (id) toolCallArgs.set(id, args);
          }
        }
      }

      const toolResults = (event.toolResults ?? []).map((tr: any) => {
        const id = tr.toolCallId ?? tr.id ?? "";
        const args = toolCallArgs.get(id) ?? tr.input ?? {};
        return {
          toolName: tr.toolName ?? tr.name ?? "unknown",
          toolCallId: id,
          input: args,
          isError: !!tr.isError,
        };
      });

      // Extract text from message — could be string, object with content, or array of blocks
      let msgText = "";
      if (typeof event.message === "string") {
        msgText = event.message;
      } else if (event.message?.content) {
        if (typeof event.message.content === "string") {
          msgText = event.message.content;
        } else if (Array.isArray(event.message.content)) {
          msgText = event.message.content
            .filter((b: any) => b.type === "text")
            .map((b: any) => b.text ?? "")
            .join("\n");
        }
      } else if (Array.isArray(event.message)) {
        msgText = event.message
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text ?? "")
          .join("\n");
      }

      await projectBridge.onTurnEnd({
        turnIndex: event.turnIndex ?? 0,
        message: msgText,
        toolResults,
      });

      // Generate prechecks for files touched by edit/write tools
      const editedFiles = toolResults
        .filter((tr: any) => ["edit", "write", "Edit", "Write"].includes(tr.toolName))
        .map((tr: any) => tr.input?.path)
        .filter(Boolean);

      if (editedFiles.length > 0) {
        const prechecks: string[] = [];
        for (const f of editedFiles) {
          const pc = await projectBridge.formatFilePrecheck(f);
          if (pc) prechecks.push(pc);
        }
        filePrecheckCache = prechecks.join("\n");
        if (filePrecheckCache) {
          acmLog(`file precheck generated: ${filePrecheckCache.length} chars for ${editedFiles.join(", ")}`);
        }
      } else {
        filePrecheckCache = "";
      }
    } catch (err: any) {
      acmLog(`turn_end projectBridge error: ${err.message}`);
    }
  });

  // ── Session shutdown: flush and close project memory ────────────────

  pi.on("session_shutdown" as any, async (_event: any, _ctx: any) => {
    try {
      await projectBridge.onSessionShutdown();
      acmLog(`projectBridge shutdown complete`);
    } catch (err: any) {
      acmLog(`projectBridge shutdown error: ${err.message}`);
    }
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

  // Apply the side effects of evicting one tool-result entry: index it for
  // recall, cache its content to disk, track evicted paths, and add its
  // toolCallId to clearSet. Selection is decided by selectClearableToolResults;
  // this only performs the eviction. Shared by the auto-clear hook and
  // acm_slide so a slide reflects freed tokens immediately.
  function evictToolResultEntry(entry: any, branch: any[], ctx: any): void {
    const msg = entry.message as any;
    const tokens = estimateTokens(msg);
    clearSet.add(msg.toolCallId);
    acmState.totalTokensSaved += Math.max(tokens - 50, 0);
    const textContent = Array.isArray(msg.content)
      ? msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join(" ").slice(0, 2000)
      : "";
    const recall = buildRecallEntry(msg.toolCallId, msg.toolName || "unknown", textContent, tokens * 4, getBranchMessages(branch));
    recallIndex.set(msg.toolCallId, recall);
    syncToGraph(recall);
    if (!cachedToFile.has(msg.toolCallId)) {
      const sessionDir = ctx.sessionManager.getSessionDir();
      const cachePath = cacheToolResult(sessionDir, msg.toolName || "unknown", msg.toolCallId, msg);
      if (cachePath) cachedToFile.set(msg.toolCallId, cachePath);
    }
    for (const fp of recall.filePaths) evictedPaths.set(fp, msg.toolCallId);
  }

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

    // msgEntryId used below for clearing/compacting; lastContext* set at end after all mutations

    // msgEntryId built above; PROOF diagnostic runs at end of handler (see below)

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

      // ── Ephemeral tier: single-use results (config.ephemeralTools) ──
      // Detected from the branch (persisted JSONL) at the turn boundary, so
      // they survive their OWN turn but are cleared unconditionally at the
      // next one (no size/recency gate). No in-memory state to persist.
      const ephemeralNames = new Set(acmConfig.ephemeralTools ?? []);
      const ephemeralIds = collectEphemeralToolCallIds(getBranchMessages(branch), ephemeralNames);
      for (const id of ephemeralIds) clearSet.add(id);
      if (ephemeralIds.length > 0) acmLog(`ephemeral -> clearSet: ${ephemeralIds.length}`);

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

      const clearableIds = new Set(
        selectClearableToolResults(branch, {
          pinnedSet,
          clearedSet: clearSet,
          protectedToolCallIds: recentToolCallIds,
        }),
      );
      let autoClearCount = 0;
      for (const entry of branch) {
        const tcId = (entry.message as any)?.toolCallId;
        if (!tcId || !clearableIds.has(tcId)) continue;
        evictToolResultEntry(entry, branch, ctx);
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
    if (clearSet.size > 0 || compactSet.size > 0 || cachedCount > 0 || hasSlid || projectBriefingCache || filePrecheckCache) {
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
        projectBriefingCache || ``,
        filePrecheckCache || ``,
        `</acm-context>`,
      ].filter(Boolean).join("\n");

      injectAcmContext(messages, acmText);
    }

    // Map each visible message to its entry ID via position alignment,
    // BEFORE pinned prepend shifts positions.
    const entryIds = alignEntryIds(branch, messages, slide);

    // Prepend pinned content from store (survives slides).
    // Done AFTER acm-context injection so pinned messages don't absorb it.
    // prependPinned returns the entry IDs it prepended (message order);
    // keep entryIds[] aligned by unshifting them too.
    const pinnedIds = prependPinned(messages, pinnedContentStore, pinnedSet, branch);
    if (pinnedIds.length > 0) entryIds.unshift(...pinnedIds);

    const usage = ctx.getContextUsage();
    const pct = usage?.percent != null ? `${Math.round(usage.percent)}%` : "?";

    // Share final visible messages + aligned entry IDs with tools (acm_map / acm_pin).
    lastVisibleMessages = messages;
    lastVisibleEntryIds = entryIds;

    // Regression guard: toolResults have independent truth via toolCallId.
    // If position alignment ever mislabels one, this catches it (ACM_DEBUG).
    if (ACM_DEBUG) {
      let ok = 0, bad = 0;
      for (let i = 0; i < messages.length; i++) {
        const m = messages[i] as any;
        if (m.role === "toolResult" && m.toolCallId) {
          const truth = tcEntryId.get(m.toolCallId);
          const got = entryIds[i];
          if (truth && got && truth.startsWith(got)) ok++;
          else { bad++; acmLog(`ALIGN-MISMATCH i=${i} got=${got} truth=${truth} tc=${m.toolCallId?.slice(0,10)}`); }
        }
      }
      acmLog(`ALIGN-CHECK slide=${slide ? "active" : "none"} msgs=${messages.length} toolRes ok=${ok} bad=${bad}`);
    }

    return { messages };
  });

  // ── Command: /acm-prune ────────────────────────────────────────────
  // Steers the LLM to "prune pins, pin important, then slide". Which entries
  // matter is a judgment call, so we don't hardcode it — we reveal the map and
  // let the model choose, mirroring the manual flow.
  pi.registerCommand("acm-prune", {
    description: "Prune stale pins, pin important, then slide away the rest",
    handler: async (_args, ctx) => {
      pi.sendUserMessage("/acm-prune");
      pi.sendMessage(
        {
          customType: "acm-prune",
          content: [
            "Compact this session now. Do NOT ask for confirmation.",
            "Steps, in order:",
            "1. Call acm_map to see the current entries and their IDs.",
            "2. Review the ALREADY-PINNED entries. Unpin any that are no longer",
            "   useful: superseded decisions, stale intermediate results, or",
            "   anything irrelevant to the current task. Call acm_pin with those",
            "   entry IDs and action: unpin.",
            "3. Identify the IMPORTANT entries not yet pinned: durable decisions,",
            "   final results/summaries, config or design conclusions, and",
            "   anything needed to continue the current task. Skip routine tool",
            "   output, intermediate steps, and noise. Call acm_pin with those",
            "   entry IDs and action: pin.",
            "4. Call acm_slide to discard the rest.",
            "5. Report in 1-3 lines: what was unpinned, pinned, and slide result.",
          ].join("\n"),
          display: false,
        },
        { deliverAs: "steer" },
      );
    },
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

  // ── Tool: acm_graph_status ──────────────────────────────────────────

  pi.registerTool({
    name: "acm_graph_status",
    label: "ACM Graph Status",
    description: "Show session graph stats: node/edge counts, top files, recent tool results.",
    promptSnippet: "acm_graph_status: Show the session graph database stats.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      if (!isGraphReady()) {
        return { content: [{ type: "text" as const, text: "Session graph not initialized." }], details: {} };
      }

      try {
        const gs = await getGraphStats();
        const summary = await getGraphSummary();

        // Get edge counts
        const lines = [
          `── ACM Graph Status ──`,
          ``,
          `Nodes:`,
          `  ToolResult: ${gs.toolResults}`,
          `  FilePath:   ${gs.filePaths}`,
          ``,
          `Files tracked (${summary.filePaths.length}):`,
          ...summary.filePaths.slice(0, 20).map(f => `  ${f}`),
          summary.filePaths.length > 20 ? `  ... +${summary.filePaths.length - 20} more` : "",
        ].filter(Boolean).join("\n");

        return { content: [{ type: "text" as const, text: lines }], details: {} };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Session graph error: ${err.message}` }], details: {} };
      }
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
      "When user asks to free context tokens: 1) acm_status, 2) acm_clear, 3) acm_compact_messages if still high, 4) acm_slide as last resort. (The /acm-prune command has its own map/pin/slide flow — do not run acm_clear for it.)",
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

      // Flush pending tool-result clears in the KEPT region now, so the
      // reported context reflects freed tokens immediately instead of waiting
      // for the next turn-boundary auto-clear. Protect the last kept turn's
      // results (everything after the final kept user message) — the LLM may
      // still need them on the next turn.
      let lastUserIdx = branch.length;
      for (let i = branch.length - 1; i >= cutoff; i--) {
        if (branch[i].type === "message" && (branch[i].message as any)?.role === "user") { lastUserIdx = i; break; }
      }
      const protectedToolCallIds = new Set<string>();
      for (let i = lastUserIdx; i < branch.length; i++) {
        const tc = (branch[i].message as any)?.toolCallId;
        if (tc) protectedToolCallIds.add(tc);
      }
      const keptRegion = branch.slice(cutoff);
      const flushIds = new Set(
        selectClearableToolResults(keptRegion, { pinnedSet, clearedSet: clearSet, protectedToolCallIds }),
      );
      let slideFlushCount = 0;
      for (const entry of keptRegion) {
        const tcId = (entry.message as any)?.toolCallId;
        if (!tcId || !flushIds.has(tcId)) continue;
        evictToolResultEntry(entry, branch, ctx);
        slideFlushCount++;
      }

      // Reset auto-clear counter — post-slide branch has fewer user messages,
      // so old count would block auto-clear from ever firing again.
      acmState.lastAutoClearUserCount = 0;
      persist(pi.appendEntry.bind(pi));

      const flushNote = slideFlushCount > 0 ? ` ${slideFlushCount} tool results cleared.` : "";
      const report = `[ACM] ✅ Slide complete: ${discardedCount} messages discarded, ${kept} recent entries kept, branch head reset.${flushNote} Old context searchable via acm_recall.`;
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
      "Search session history across all sessions in this project. Returns ranked results from JSONL session files. " +
      "Use bash (sed -n 'Lp' <file>) to retrieve full content from line numbers.",
    promptSnippet: "acm_recall: Search session history (all user messages, tool results, assistant responses). Returns ranked snippets with file + line number. Use `sed -n 'Lp' <file>` to read full content. IMPORTANT: When user asks about prior work on a file or topic, ALWAYS call acm_recall first.",
    parameters: Type.Object({
      query: Type.String({ description: "Space-separated keywords. Use specific terms, not natural language." }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      if (!params.query) {
        return { content: [{ type: "text" as const, text: "[ACM Recall] Provide a query with space-separated keywords." }], details: {} };
      }

      acmLog(`recall query: "${params.query}"`);

      try {
        const sessionDir = _sessionDir;
        if (!sessionDir) {
          return { content: [{ type: "text" as const, text: "[ACM Recall] No session dir available." }], details: {} };
        }

        const jsonlFiles = readdirSync(sessionDir)
          .filter((f: string) => f.endsWith(".jsonl"))
          .map((f: string) => join(sessionDir, f));

        if (jsonlFiles.length === 0) {
          return { content: [{ type: "text" as const, text: `[ACM Recall] No session files in ${sessionDir}` }], details: {} };
        }

        const allHits: Array<{ content: string; role: string; toolName: string; score: number; filePath: string; lineNo: number }> = [];
        for (const f of jsonlFiles) {
          const t0 = performance.now();
          const result = await searchSessions(params.query, f, { maxResults: 5 });
          acmLog(`recall: searched ${f.split('/').pop()} → ${result.hits.length} hits, ${result.total} rg matches, ${(performance.now()-t0).toFixed(0)}ms`);
          allHits.push(...result.hits);
        }

        allHits.sort((a, b) => b.score - a.score);
        const top = allHits.slice(0, 5);

        if (top.length === 0) {
          return { content: [{ type: "text" as const, text: `[ACM Recall] No results for: "${params.query}"` }], details: { found: false } };
        }

        const lines = top.map((h, i) => {
          const tag = h.toolName ? `${h.role}/${h.toolName}` : h.role;
          const sessionFile = h.filePath.split('/').pop();
          return `#${i + 1} [${h.score.toFixed(2)}] ${tag} — ${h.content.replace(/\n/g, "\\n").slice(0, 100)}\n   → sed -n '${h.lineNo}p' ${h.filePath}`;
        });

        const report = [
          `[ACM Recall] ${allHits.length} matches across ${jsonlFiles.length} sessions, top ${top.length}:`,
          ``,
          ...lines,
        ].join("\n");

        return {
          content: [{ type: "text" as const, text: report }],
          details: { source: "session-search", total: allHits.length, shown: top.length },
        };
      } catch (err: any) {
        acmLog(`recall ERROR: ${err?.message || err}`);
        return { content: [{ type: "text" as const, text: `[ACM Recall] Error: ${err?.message || err}` }], details: {} };
      }
    },
  });



  // ── Tool: acm_map ───────────────────────────────────────────────────

  pi.registerTool({
    name: "acm_map",
    label: "ACM Map",
    description: "Show all context entries with their IDs, roles, and content previews. Use before acm_pin to discover entry IDs.",
    promptSnippet: "acm_map: List entries with IDs. Call before acm_pin.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      // Ephemeral tier (config.ephemeralTools) clears this result at the next
      // turn boundary via a branch scan in the context handler — no self-mark.
      const rows = buildEntryMap(lastVisibleMessages, lastVisibleEntryIds);
      if (rows.length === 0) {
        return { content: [{ type: "text" as const, text: "[ACM] No entries on branch." }], details: {} };
      }
      const header = "ID        ROLE       PREVIEW";
      const separator = "─".repeat(60);
      const lines = rows.map(r => `${r.id}  ${r.role.padEnd(10)} ${r.preview}`);
      const table = [header, separator, ...lines].join("\n");
      return { content: [{ type: "text" as const, text: table }], details: { count: rows.length } };
    },
  });

  // ── Tool: acm_pin ───────────────────────────────────────────────────

  pi.registerTool({
    name: "acm_pin",
    label: "ACM Pin",
    description: `Pin/unpin messages to protect from clearing and sliding. Use acm_map first to discover entry IDs. Supports prefix matching (first 4+ chars).
Single: { entryId: "abc123", action: "pin" }
Batch:   { entryIds: ["abc1", "def2", "ghi3"], action: "pin" }`,
    promptSnippet: `acm_pin: Pin/unpin entries. Single: entryId. Batch: entryIds[]. Use acm_map to find IDs. Example batch: { entryIds: ["id1", "id2"], action: "pin" }`,
    parameters: Type.Object({
      entryId: Type.Optional(Type.String({ description: "Single entry ID or unique prefix (4+ chars). Use acm_map to discover IDs." })),
      entryIds: Type.Optional(Type.Array(Type.String(), { description: "Batch: array of entry IDs or prefixes to pin/unpin at once." })),
      action: Type.Optional(Type.Union([Type.Literal("pin"), Type.Literal("unpin")], { description: "Pin or unpin. Default: pin." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const action = params.action ?? "pin";
      const ids: string[] = params.entryIds ?? (params.entryId ? [params.entryId] : []);

      if (ids.length === 0) {
        return { content: [{ type: "text" as const, text: "[ACM] Provide entryId or entryIds." }], details: {} };
      }

      const branch = ctx.sessionManager.getBranch() as any[];
      const results: string[] = [];
      const resolvedIds: string[] = [];

      for (const id of ids) {
        const resolved = resolveId(id, branch);
        if (!resolved.ok) {
          results.push(`❌ ${id}: ${resolved.error}`);
          continue;
        }
        const resolvedId = resolved.entry.id;
        resolvedIds.push(resolvedId);

        if (action === "pin") {
          pinnedSet.add(resolvedId);
          for (const [tcId, eId] of toolCallIdToEntryId) {
            if (eId === resolvedId) { clearSet.delete(tcId); recallIndex.delete(tcId); }
          }
        } else {
          pinnedSet.delete(resolvedId);
        }

        persistPin(pi.appendEntry.bind(pi), resolvedId, action);
        results.push(`${action === "pin" ? "📌" : "🔓"} ${resolvedId}`);
      }

      const report = `[ACM] ${action === "pin" ? "Pinned" : "Unpinned"} ${resolvedIds.length}/${ids.length} (${pinnedSet.size} total)\n${results.join("\n")}`;
      ctx.ui.notify(report, "info");
      return { content: [{ type: "text" as const, text: report }], details: { entryIds: resolvedIds, action } };
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

  // ── Tool: acm_forget ──────────────────────────────────────────────

  pi.registerTool({
    name: "acm_save_memory",
    label: "Save to Project Memory",
    description:
      "Save a note to project memory. Persists across sessions and appears in session briefing. " +
      "Use when user asks to remember something about the project (e.g. SSH config, deployment steps, architecture decisions).",
    promptSnippet:
      "acm_save_memory: Save user-provided notes to persistent project memory. " +
      "Notes appear in future session briefings. Optionally attach file paths for context.",
    parameters: Type.Object({
      note: Type.String({ description: "The note/information to save." }),
      files: Type.Optional(Type.Array(Type.String(), { description: "Related file paths (will be relativized to git root)." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const success = await projectBridge.saveUserNote(params.note, params.files ?? []);
      if (success) {
        return { content: [{ type: "text" as const, text: `✅ Saved to project memory: ${params.note.slice(0, 80)}${params.note.length > 80 ? "..." : ""}` }] };
      }
      return { content: [{ type: "text" as const, text: "❌ Failed to save — project memory not initialized (no git root?)." }] };
    },
  });

  pi.registerTool({
    name: "acm_forget",
    label: "ACM Forget",
    description:
      "Delete specific entries from recall index and project graph by query or ID. " +
      "Use without confirm to preview matches (dry run). Set confirm=true to delete.",
    promptSnippet:
      "acm_forget: Remove stale/false entries from project memory. Dry run first (no confirm), then confirm=true to delete. " +
      "Deletes from: recall index, graph DB, and cached files on disk.",
    parameters: Type.Object({
      query: Type.Optional(Type.String({ description: "Keyword search to find entries to forget." })),
      ids: Type.Optional(Type.Array(Type.String(), { description: "Specific entry/toolCall IDs to forget." })),
      confirm: Type.Optional(Type.Boolean({ description: "Set true to actually delete. Default false (dry run)." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const confirm = params.confirm === true;

      // Collect target IDs
      let targets: Array<{ id: string; toolName: string; keyTerms: string }> = [];

      if (params.ids && params.ids.length > 0) {
        // Direct ID lookup
        for (const id of params.ids) {
          const recall = recallIndex.get(id) || [...recallIndex.values()].find(r => r.entryId === id);
          if (recall) {
            targets.push({ id: recall.toolCallId, toolName: recall.toolName, keyTerms: recall.keyTerms.slice(0, 80) });
          } else {
            // Might be graph-only
            targets.push({ id, toolName: "unknown", keyTerms: "(graph-only)" });
          }
        }
      } else if (params.query) {
        // Search by keyword — same logic as acm_recall
        const terms = params.query.toLowerCase().split(/\s+/).filter(Boolean);

        // Search in-memory recallIndex
        for (const recall of recallIndex.values()) {
          const searchable = `${recall.toolName} ${recall.keyTerms} ${recall.filePaths.join(" ")}`.toLowerCase();
          const matchCount = terms.filter(t => searchable.includes(t)).length;
          if (matchCount === terms.length) {
            targets.push({ id: recall.toolCallId, toolName: recall.toolName, keyTerms: recall.keyTerms.slice(0, 80) });
          }
        }

        // Search graph via FTS
        if (isGraphReady()) {
          try {
            const ftsHits = await ftsSearch(params.query, 50);
            for (const hit of ftsHits) {
              if (!targets.some(t => t.id === hit.node.id)) {
                targets.push({ id: hit.node.id, toolName: hit.node.toolName, keyTerms: hit.node.keyTerms.slice(0, 80) });
              }
            }
          } catch {}
        }
      } else {
        return { content: [{ type: "text" as const, text: "[ACM Forget] Provide query or ids." }] };
      }

      // Also search project memory for matching entries
      if (params.query && projectBridge.isReady()) {
        try {
          const pmResults = await projectBridge.searchProjectMemory(params.query);
          for (const r of pmResults) {
            if (!targets.some(t => t.id === r.id)) {
              targets.push({ id: r.id, toolName: r.toolName, keyTerms: (r.summary || r.keyTerms || "").slice(0, 80) });
            }
          }
        } catch (pmErr: any) {
          acmLog(`acm_forget PM search error: ${pmErr?.message || pmErr}`);
        }
      }

      if (targets.length === 0) {
        return { content: [{ type: "text" as const, text: `[ACM Forget] No matches found.` }] };
      }

      // Dry run — show what would be deleted
      if (!confirm) {
        const preview = targets.slice(0, 20).map((t, i) =>
          `  ${i + 1}. ${t.toolName} | ${t.keyTerms} | id: ${t.id}`
        ).join("\n");
        return {
          content: [{ type: "text" as const, text:
            `[ACM Forget] DRY RUN — ${targets.length} entries would be deleted:\n${preview}` +
            (targets.length > 20 ? `\n  ... +${targets.length - 20} more` : "") +
            `\n\nCall again with confirm=true to delete.`
          }],
        };
      }

      // Confirmed — delete everywhere
      let deletedRecall = 0;
      let deletedCache = 0;
      let deletedGraph = 0;

      for (const t of targets) {
        // 1. Remove from recallIndex
        if (recallIndex.has(t.id)) {
          recallIndex.delete(t.id);
          deletedRecall++;
        }

        // 2. Remove cached file from disk
        const cachePath = cachedToFile.get(t.id);
        if (cachePath) {
          try {
            const { unlinkSync } = await import("node:fs");
            unlinkSync(cachePath);
            deletedCache++;
          } catch {}
          cachedToFile.delete(t.id);
        }

        // 3. Remove from evictedPaths
        for (const [fp, tcId] of evictedPaths.entries()) {
          if (tcId === t.id) evictedPaths.delete(fp);
        }
      }

      // 4. Delete from session graph in batch
      if (isGraphReady()) {
        try {
          deletedGraph = await graphDeleteToolResults(targets.map(t => t.id));
        } catch (e: any) {
          acmLog(`acm_forget graph delete error: ${e?.message || e}`);
        }
      }

      // 5. Delete from project memory graph (targets already include PM entries from search phase)
      let deletedProject = 0;
      if (projectBridge.isReady()) {
        try {
          deletedProject = await projectBridge.deleteEvents(targets.map(t => t.id));
        } catch (e: any) {
          acmLog(`acm_forget project delete error: ${e?.message || e}`);
        }
      }

      const report = `[ACM Forget] Deleted ${targets.length} entries:\n` +
        `  recall index:   ${deletedRecall}\n` +
        `  cached files:   ${deletedCache}\n` +
        `  graph nodes:    ${deletedGraph}\n` +
        `  project memory: ${deletedProject}`;

      return { content: [{ type: "text" as const, text: report }] };
    },
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
