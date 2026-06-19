/**
 * ACM — Adaptive Context Manager
 *
 * LLM-driven context management. No slash commands — LLM decides when and
 * what to prune using registered tools.
 *
 * Automatic: session_before_compact hijacks pi's compaction with two-phase
 * strategy (clear tool results → slide if needed).
 *
 * Manual: user says "acm prune" → LLM inspects context, calls acm_clear/acm_status.
 *
 * See acm-lib/ for extracted modules (types, config, helpers, cache, state).
 */

import { complete } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  convertToLlm,
  estimateTokens,
  serializeConversation,
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
  persist,
  persistPin,
  rehydrateState,
  buildToolCallMapping,
  inventoryToolResults,
  buildStub,
  buildRecallEntry,
  clearToolResults,
  statusText,
} from "../acm-lib/state.ts";

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
export {
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
} from "../acm-lib/state.ts";

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

  // ── Tool result intercept: cache external tool outputs to disk ─────
  // External tool results never enter context. Written to .acm/cache/,
  // LLM gets stub with filepath, self-serves via bash.

  pi.on("tool_result" as any, async (event: any, ctx: any) => {
    const toolName = event.toolName || "unknown";
    const toolArgs = event.input;
    if (!isExternalTool(toolName, toolArgs)) return; // local tool, pass through

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

    // ── Build messages: apply stubs, strip thinking, compact ──
    // Runs AFTER auto-clear so newly cleared items get stubbed immediately.
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
    const cachedCount = cachedToFile.size;
    if (clearSet.size > 0 || compactSet.size > 0 || cachedCount > 0) {
      const acmText = [
        `<acm-context>`,
        `${clearSet.size} tool results cleared, ${compactSet.size} messages compacted, ${pinnedSet.size} pinned, ${cachedCount} cached to disk.`,
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
      ctx.ui.setStatus("acm", `${statusText()} | pending…`);

      return { content: [{ type: "text" as const, text: report }], details: { count: candidates.length, estimatedTokensSaved: saved } };
    },
  });

  // ── Tool: acm_slide ─────────────────────────────────────────────────

  pi.registerTool({
    name: "acm_slide",
    label: "ACM Slide",
    description:
      "Sliding window compaction. Generates LLM summary of old context, resets branch head " +
      "to cutoff point. Old messages fully removed from LLM context but searchable via acm_recall.",
    promptSnippet: "acm_slide: Sliding window — summarize old context and reset branch head. Truly frees context.",
    parameters: Type.Object({
      customInstructions: Type.Optional(Type.String({ description: "Custom instructions for the summary generation." })),
      keepMessages: Type.Optional(Type.Number({ description: "Keep last N messages (default 10). E.g. 20 keeps more context." })),
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

      // Build minimal summary: pinned content only (no LLM call)
      let summary = "[Context before this point was slid away. Use acm_recall to search old context.]";
      const pinnedContent: string[] = [];
      for (let i = 0; i < cutoff; i++) {
        const e = branch[i] as any;
        if (pinnedSet.has(e.id) && e.message) pinnedContent.push(extractEntryContent(e));
      }
      if (pinnedContent.length > 0) summary += `\n\n## Pinned Context\n\n${pinnedContent.join("\n\n---\n\n")}`;

      // Commit compaction — resets branch head. No LLM call.
      ctx.sessionManager.appendCompaction(summary, firstKeptEntryId, tokensBefore, { source: "acm_slide" }, true);

      // Clean up ACM cosmetic state for discarded entries
      for (let i = 0; i < cutoff; i++) {
        const e = branch[i] as any;
        if (e.id) { clearSet.delete(e.id); compactSet.delete(e.id); }
      }
      // Reset auto-clear counter — post-slide branch has fewer user messages,
      // so old count would block auto-clear from ever firing again.
      acmState.lastAutoClearUserCount = 0;
      persist(pi.appendEntry.bind(pi));
      ctx.ui.setStatus("acm", `${statusText()} | slid`);

      const kept = branch.length - cutoff;
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
    clearToolResults(toolResults, (msg) => ctx.ui.notify(`[ACM] ${msg}`, "info"), allMessages);

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
      acmState.lastAutoClearUserCount = 0; // Reset so auto-clear works after compaction
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
