/**
 * Decision Gate — determines which turn_end events get promoted to project graph.
 *
 * Deterministic, no LLM calls. Uses tool metadata + assistant message text.
 * Buffers investigation events, promotes them when linked to a mutation.
 */

import type { ProjectGraphEvent } from "./project-graph.ts";

export interface ToolResultInfo {
  toolName: string;
  toolCallId: string;
  input: Record<string, any>;
  isError: boolean;
}

export interface TurnContext {
  turnIndex: number;
  assistantText: string;
  toolResults: ToolResultInfo[];
  sessionId: string;
  timestamp: number;
}

export interface PromotionResult {
  action: "promote" | "buffer" | "skip";
  event: ProjectGraphEvent;
}

interface BufferedEvent {
  event: ProjectGraphEvent;
  files: string[];
}

// Tools that mutate code
const MUTATION_TOOLS = new Set(["edit", "write"]);

// Bash commands that are exploration noise (skip)
const NOISE_PATTERNS = [
  /^\s*(ls|dir)\b/,
  /^\s*find\b/,
  /^\s*tree\b/,
  /^\s*pwd\b/,
  /^\s*wc\b/,
  /^\s*echo\b/,
];

// Bash commands that are investigation (buffer)
const INVESTIGATION_PATTERNS = [
  /^\s*(grep|rg|ag|ack)\b/,
  /^\s*(cat|head|tail|sed|awk)\b/,
  /^\s*(git\s+(log|show|diff|blame))\b/,
];

// Bash commands that are git commits (promote)
const GIT_COMMIT_PATTERN = /git\s+(commit|push|merge|rebase|cherry-pick)\b/;

/**
 * Extract file path from tool input.
 */
function extractPath(input: Record<string, any>): string | null {
  return input?.path ?? input?.file ?? input?.filePath ?? null;
}

/**
 * Extract file paths from bash command (best effort).
 */
function extractBashFiles(command: string): string[] {
  // Not reliable — bash commands are free-form.
  // Return empty; bash files detected via buffer linking only.
  return [];
}

/**
 * Extract first meaningful sentence from assistant text as summary.
 */
function extractSummary(text: string): string {
  if (!text) return "";

  // Strip markdown code blocks
  const cleaned = text.replace(/```[\s\S]*?```/g, "").trim();
  if (!cleaned) return "";

  // Split on sentence boundaries
  const sentences = cleaned.split(/(?<=[.!?])\s+/);
  const first = sentences[0]?.trim() ?? "";

  // Cap at 200 chars
  return first.length > 200 ? first.slice(0, 197) + "..." : first;
}

/**
 * Extract keywords from assistant text + tool info.
 */
function extractKeyTerms(
  assistantText: string,
  files: string[],
  toolNames: string[]
): string {
  const words: string[] = [];

  // File basenames
  for (const f of files) {
    const base = f.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
    if (base) words.push(base);
  }

  // Tool names
  words.push(...toolNames);

  // Key words from assistant text (simple: take first 10 non-trivial words)
  const textWords = assistantText
    .replace(/[`#*_\[\](){}]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 10);
  words.push(...textWords);

  return [...new Set(words)].join(" ").toLowerCase().slice(0, 500);
}

export class DecisionGate {
  private buffer: BufferedEvent[] = [];

  /**
   * Evaluate a turn's results and decide: promote, buffer, or skip.
   */
  evaluate(turn: TurnContext): PromotionResult[] {
    const results: PromotionResult[] = [];

    // Classify each tool result
    const mutations: ToolResultInfo[] = [];
    const errors: ToolResultInfo[] = [];
    const investigations: ToolResultInfo[] = [];
    const noise: ToolResultInfo[] = [];
    const gitCommits: ToolResultInfo[] = [];

    for (const tr of turn.toolResults) {
      if (tr.isError) {
        errors.push(tr);
      } else if (MUTATION_TOOLS.has(tr.toolName)) {
        mutations.push(tr);
      } else if (tr.toolName === "bash") {
        const cmd = tr.input?.command ?? "";
        if (GIT_COMMIT_PATTERN.test(cmd)) {
          gitCommits.push(tr);
        } else if (NOISE_PATTERNS.some((p) => p.test(cmd))) {
          noise.push(tr);
        } else if (INVESTIGATION_PATTERNS.some((p) => p.test(cmd))) {
          investigations.push(tr);
        } else {
          // Unknown bash — treat as investigation
          investigations.push(tr);
        }
      } else if (tr.toolName === "read") {
        investigations.push(tr);
      } else {
        // Unknown tool — buffer as investigation
        investigations.push(tr);
      }
    }

    const hasMutation = mutations.length > 0 || gitCommits.length > 0;
    const hasError = errors.length > 0;
    const summary = extractSummary(turn.assistantText);

    // ── Promote mutations ──
    if (hasMutation) {
      const mutFiles = [
        ...mutations.map((m) => extractPath(m.input)).filter(Boolean),
        ...gitCommits.flatMap((g) => extractBashFiles(g.input?.command ?? "")),
      ] as string[];

      const allToolNames = [...mutations, ...gitCommits].map((t) => t.toolName);
      const keyTerms = extractKeyTerms(turn.assistantText, mutFiles, allToolNames);

      const event: ProjectGraphEvent = {
        id: `turn-${turn.turnIndex}-${turn.sessionId}-${turn.timestamp}`,
        toolName: mutations[0]?.toolName ?? gitCommits[0]?.toolName ?? "unknown",
        keyTerms,
        eventType: "fix",
        files: [...new Set(mutFiles)],
        sessionId: turn.sessionId,
        timestamp: turn.timestamp,
        summary,
      };

      results.push({ action: "promote", event });

      // Promote linked buffered reads (same file as mutation)
      const mutFileSet = new Set(mutFiles);
      const toPromote: number[] = [];

      for (let i = 0; i < this.buffer.length; i++) {
        const buffered = this.buffer[i];
        if (buffered.files.some((f) => mutFileSet.has(f))) {
          results.push({ action: "promote", event: buffered.event });
          toPromote.push(i);
        }
      }

      // Remove promoted from buffer (reverse order to preserve indices)
      for (const idx of toPromote.reverse()) {
        this.buffer.splice(idx, 1);
      }
    }

    // ── Promote errors ──
    if (hasError) {
      const errFiles = errors
        .map((e) => extractPath(e.input))
        .filter(Boolean) as string[];
      const keyTerms = extractKeyTerms(
        turn.assistantText,
        errFiles,
        errors.map((e) => e.toolName)
      );

      const event: ProjectGraphEvent = {
        id: `turn-${turn.turnIndex}-${turn.sessionId}-${turn.timestamp}-err`,
        toolName: errors[0].toolName,
        keyTerms,
        eventType: "error",
        files: [...new Set(errFiles)],
        sessionId: turn.sessionId,
        timestamp: turn.timestamp,
        summary,
      };

      results.push({ action: "promote", event });
    }

    // ── Buffer investigations ──
    if (!hasMutation && !hasError && investigations.length > 0) {
      const invFiles = investigations
        .map((inv) => extractPath(inv.input))
        .filter(Boolean) as string[];
      const keyTerms = extractKeyTerms(
        turn.assistantText,
        invFiles,
        investigations.map((i) => i.toolName)
      );

      const event: ProjectGraphEvent = {
        id: `turn-${turn.turnIndex}-${turn.sessionId}-${turn.timestamp}`,
        toolName: investigations[0].toolName,
        keyTerms,
        eventType: "investigation",
        files: [...new Set(invFiles)],
        sessionId: turn.sessionId,
        timestamp: turn.timestamp,
        summary,
      };

      this.buffer.push({ event, files: invFiles });
      results.push({ action: "buffer", event });
    }

    // ── Skip noise ──
    if (!hasMutation && !hasError && investigations.length === 0 && noise.length > 0) {
      const event: ProjectGraphEvent = {
        id: `turn-${turn.turnIndex}-${turn.sessionId}-${turn.timestamp}`,
        toolName: noise[0].toolName,
        keyTerms: "",
        eventType: "exploration",
        files: [],
        sessionId: turn.sessionId,
        timestamp: turn.timestamp,
        summary: "",
      };

      results.push({ action: "skip", event });
    }

    return results;
  }

  /**
   * Get files currently in the buffer (for inspection/testing).
   */
  getBufferedFiles(): string[] {
    return this.buffer.flatMap((b) => b.files);
  }

  /**
   * Flush remaining buffered events (e.g., at session end or slide).
   * Returns the buffered events for optional promotion.
   */
  flush(): ProjectGraphEvent[] {
    const events = this.buffer.map((b) => b.event);
    this.buffer = [];
    return events;
  }
}
