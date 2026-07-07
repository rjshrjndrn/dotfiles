/**
 * ProjectMemoryBridge — glue between pi extension hooks and ProjectGraph.
 *
 * Encapsulates:
 * - session_start → init project graph, register session
 * - turn_end → evaluate via DecisionGate → write to ProjectGraph
 * - session_shutdown → flush buffer, close graph
 *
 * Designed to be testable without the full pi runtime.
 */

import { join } from "node:path";
import { appendFileSync } from "node:fs";
import { ProjectGraph, type ProjectGraphEvent, type SessionInfo, type FilePrecheck, type HotFile } from "./project-graph.ts";
import { DecisionGate, type TurnContext, type ToolResultInfo } from "./decision-gate.ts";

export interface TurnEndEvent {
  turnIndex: number;
  message: string; // assistant text
  toolResults: ToolResultInfo[];
}

export interface SessionStartEvent {
  sessionId: string;
  cwd: string;
  gitRoot: string | null;
}

export interface BridgeConfig {
  dbDir?: string; // directory for the project DB. If omitted, derived from gitRoot at session start.
  logFile?: string; // debug log path (default: /tmp/acm-project-bridge.log)
}

export interface SessionBriefing {
  hotFiles: HotFile[];
  recentSessions: SessionInfo[];
  recentErrors: ProjectGraphEvent[];
}

const DEFAULT_LOG = "/tmp/acm-project-bridge.log";

export class ProjectMemoryBridge {
  private config: BridgeConfig;
  private graph: ProjectGraph | null = null;
  private gate: DecisionGate = new DecisionGate();
  private sessionId: string | null = null;
  private debug: boolean;
  private logFile: string;
  private turnCounter = 0;
  private worktreeRoot: string | null = null;

  constructor(config: BridgeConfig) {
    this.config = config;
    this.debug = !!process.env.ACM_PROJECT_DEBUG;
    this.logFile = config.logFile ?? DEFAULT_LOG;
  }

  isReady(): boolean {
    return this.graph !== null && this.graph.isReady();
  }

  /** Set the worktree root for path relativization. */
  setWorktreeRoot(root: string): void {
    // Normalize: strip trailing slash
    this.worktreeRoot = root.replace(/\/+$/, "");
  }

  /**
   * Convert absolute path to worktree-relative.
   * If path is already relative, or outside worktreeRoot, returns unchanged.
   * If no worktreeRoot set, returns unchanged.
   */
  relativizePath(absPath: string): string {
    if (!this.worktreeRoot) return absPath;

    const normalized = absPath.replace(/\/+$/, "");

    // Exact match = root itself
    if (normalized === this.worktreeRoot) return ".";

    const prefix = this.worktreeRoot + "/";
    if (!normalized.startsWith(prefix)) return absPath;

    return normalized.slice(prefix.length) || ".";
  }

  // ── Lifecycle hooks ─────────────────────────────────────

  async onSessionStart(event: SessionStartEvent): Promise<void> {
    this.sessionId = event.sessionId;
    this.gate = new DecisionGate();
    this.turnCounter = 0;

    if (!event.gitRoot) {
      this.log(`session_start: no git root, project memory disabled`);
      return;
    }

    try {
      const dbDir = this.config.dbDir || join(event.gitRoot!, ".pi");
      const dbPath = join(dbDir, "memory.lbug");
      this.graph = new ProjectGraph(dbPath, "exclusive");
      await this.graph.init();

      await this.graph.registerSession({
        id: event.sessionId,
        startTime: Date.now(),
        cwd: event.cwd,
        gitRoot: event.gitRoot,
      });

      this.log(`session_start: initialized project graph at ${dbPath}`);
    } catch (err: any) {
      this.log(`session_start: failed to init project graph: ${err.message}`);
      this.graph = null;
    }
  }

  async onTurnEnd(event: TurnEndEvent): Promise<void> {
    if (!this.graph || !this.sessionId) return;

    this.turnCounter++;

    try {
      const turnCtx: TurnContext = {
        turnIndex: this.turnCounter,
        assistantText: event.message,
        toolResults: event.toolResults,
        sessionId: this.sessionId,
        timestamp: Date.now(),
      };

      const results = this.gate.evaluate(turnCtx);

      for (const r of results) {
        // Relativize file paths before storing
        r.event.files = r.event.files.map((f) => this.relativizePath(f));

        if (r.action === "promote") {
          await this.graph.writeEvent(r.event);
          this.log(`promote: ${r.event.id} type=${r.event.eventType} files=${r.event.files.join(",")}`);
        } else if (r.action === "buffer") {
          this.log(`buffer: ${r.event.id} files=${r.event.files.join(",")}`);
        } else {
          this.log(`skip: ${r.event.id}`);
        }
      }
    } catch (err: any) {
      this.log(`turn_end error: ${err.message}`);
    }
  }

  async onSessionShutdown(): Promise<void> {
    if (this.graph) {
      // Flush any remaining buffered investigations
      const remaining = this.gate.flush();
      this.log(`shutdown: flushing ${remaining.length} buffered events`);
      // Don't promote orphan reads — they led nowhere
      // (Could optionally promote them with a flag)

      await this.graph.close();
      this.graph = null;
    }
    this.sessionId = null;
    this.turnCounter = 0;
  }

  // ── Query delegations ──────────────────────────────────

  async queryByFile(filePath: string): Promise<ProjectGraphEvent[]> {
    if (!this.graph) return [];
    return this.graph.queryByFile(this.relativizePath(filePath));
  }

  async queryByKeyword(keyword: string): Promise<ProjectGraphEvent[]> {
    if (!this.graph) return [];
    return this.graph.queryByKeyword(keyword);
  }

  async precheckFile(filePath: string): Promise<FilePrecheck> {
    if (!this.graph) return { eventCount: 0, lastTouched: 0, sessions: [], recentKeyTerms: [] };
    return this.graph.precheckFile(this.relativizePath(filePath));
  }

  async getSessions(): Promise<SessionInfo[]> {
    if (!this.graph) return [];
    return this.graph.getSessions();
  }

  async getStats(): Promise<{ events: number; files: number; sessions: number }> {
    if (!this.graph) return { events: 0, files: 0, sessions: 0 };
    return this.graph.getStats();
  }

  async getSessionBriefing(): Promise<SessionBriefing> {
    if (!this.graph) return { hotFiles: [], recentSessions: [], recentErrors: [] };

    const [hotFiles, recentSessions] = await Promise.all([
      this.graph.getHotFiles(5),
      this.graph.getSessions(),
    ]);

    // Find recent errors
    let recentErrors: ProjectGraphEvent[] = [];
    try {
      const allKeyword = await this.graph.queryByKeyword("error fail");
      recentErrors = allKeyword.filter((e) => e.eventType === "error").slice(0, 5);
    } catch { /* non-fatal */ }

    return {
      hotFiles,
      recentSessions: recentSessions.slice(0, 5),
      recentErrors,
    };
  }

  // ── Surfacing: formatted output for pi context injection ────────

  /**
   * Format a briefing string for session start injection.
   * Returns "" if no project graph or no prior data.
   */
  async formatSessionBriefing(): Promise<string> {
    if (!this.graph) return "";

    const briefing = await this.getSessionBriefing();
    if (briefing.hotFiles.length === 0 && briefing.recentSessions.length === 0) return "";

    const lines: string[] = [
      "📁 Project Memory:",
      "  Use acm_recall(query) to search prior session history for any file or topic.",
    ];

    // Sessions (exclude current)
    const priorSessions = briefing.recentSessions.filter((s) => s.id !== this.sessionId);
    if (priorSessions.length > 0) {
      lines.push(`  ${priorSessions.length} prior session(s)`);
    }

    // Hot files
    if (briefing.hotFiles.length > 0) {
      lines.push("  Hot files:");
      for (const f of briefing.hotFiles) {
        lines.push(`    ${f.path} (${f.refCount} refs)`);
      }
    }

    // Recent errors
    if (briefing.recentErrors.length > 0) {
      lines.push("  Recent errors:");
      for (const e of briefing.recentErrors) {
        lines.push(`    ${e.files.join(", ")}: ${e.summary}`);
      }
    }

    return lines.join("\n");
  }

  /**
   * Format a precheck warning for a file about to be edited.
   * Returns "" if file has no history.
   */
  async formatFilePrecheck(filePath: string): Promise<string> {
    if (!this.graph) return "";

    const precheck = await this.precheckFile(filePath);
    if (precheck.eventCount === 0) return "";

    const events = await this.queryByFile(filePath);
    const lines: string[] = [
      `⚠ ${filePath}: ${precheck.eventCount} prior edit(s) across session(s): ${precheck.sessions.join(", ")}`,
    ];

    if (precheck.recentKeyTerms.length > 0) {
      lines.push(`  Key terms: ${precheck.recentKeyTerms.join(", ")}`);
    }

    // Show errors related to this file
    const errors = events.filter((e) => e.eventType === "error");
    if (errors.length > 0) {
      lines.push("  Errors:");
      for (const e of errors) {
        lines.push(`    ${e.summary}`);
      }
    }

    // Show recent summaries
    const mutations = events.filter((e) => e.eventType !== "error" && e.eventType !== "investigation");
    if (mutations.length > 0) {
      lines.push("  History:");
      for (const e of mutations.slice(-3)) {
        lines.push(`    [${e.sessionId}] ${e.summary}`);
      }
    }

    return lines.join("\n");
  }

  /**
   * Search project memory by keyword. Returns raw events.
   */
  async searchProjectMemory(query: string): Promise<ProjectGraphEvent[]> {
    if (!this.graph) return [];

    // Search by keyword
    const results = await this.queryByKeyword(query);

    // Also search by file path if query looks like a path
    if (query.includes("/") || query.includes(".")) {
      // Try exact match first, then partial
      let fileResults = await this.queryByFile(query);
      if (fileResults.length === 0) {
        // Search all events whose files contain the query as substring
        const allByKeyword = await this.queryByKeyword(query.replace(/\./g, " ").replace(/\//g, " "));
        fileResults = allByKeyword.filter((e) =>
          e.files.some((f) => f.includes(query))
        );
      }
      const ids = new Set(results.map((r) => r.id));
      for (const fr of fileResults) {
        if (!ids.has(fr.id)) results.push(fr);
      }
    }

    return results;
  }

  /**
   * Format project recall results for acm_recall injection.
   * Returns "" if no matches.
   */
  async formatProjectRecall(query: string): Promise<string> {
    const results = await this.searchProjectMemory(query);
    if (results.length === 0) return "";

    const lines: string[] = [`📁 Project memory (${results.length} match${results.length > 1 ? "es" : ""}):`];
    for (const r of results) {
      lines.push(`  [${r.sessionId}] ${r.eventType}: ${r.files.join(", ")} — ${r.summary}`);
    }
    return lines.join("\n");
  }

  // ── Debug ──────────────────────────────────────────────

  private log(msg: string): void {
    if (!this.debug) return;
    const line = `[${new Date().toISOString()}] [bridge] ${msg}\n`;
    try { appendFileSync(this.logFile, line); } catch { /* non-fatal */ }
  }
}
