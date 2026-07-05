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

  constructor(config: BridgeConfig) {
    this.config = config;
    this.debug = !!process.env.ACM_PROJECT_DEBUG;
    this.logFile = config.logFile ?? DEFAULT_LOG;
  }

  isReady(): boolean {
    return this.graph !== null && this.graph.isReady();
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
    return this.graph.queryByFile(filePath);
  }

  async queryByKeyword(keyword: string): Promise<ProjectGraphEvent[]> {
    if (!this.graph) return [];
    return this.graph.queryByKeyword(keyword);
  }

  async precheckFile(filePath: string): Promise<FilePrecheck> {
    if (!this.graph) return { eventCount: 0, lastTouched: 0, sessions: [], recentKeyTerms: [] };
    return this.graph.precheckFile(filePath);
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

  // ── Debug ──────────────────────────────────────────────

  private log(msg: string): void {
    if (!this.debug) return;
    const line = `[${new Date().toISOString()}] [bridge] ${msg}\n`;
    try { appendFileSync(this.logFile, line); } catch { /* non-fatal */ }
  }
}
