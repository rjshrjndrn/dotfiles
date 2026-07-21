/**
 * ProjectGraph — repo-scoped, worktree-shared knowledge store.
 *
 * Thin async facade over RepoStore (node:sqlite, WAL). All worktrees of a repo
 * resolve to one db (see git-root.ts), giving a single queryable knowledge base
 * across sessions. WAL is crash-safe and supports concurrent worktree writers,
 * so the previous LadybugDB engine — which corrupted on abrupt exit and was
 * wiped on next start — is gone, along with its flock/reopen workarounds.
 */

import { RepoStore } from "./repo-store.ts";

export interface ProjectGraphEvent {
  id: string;
  toolName: string;
  keyTerms: string;
  eventType: string;
  files: string[];
  sessionId: string;
  timestamp: number;
  summary?: string;
  expiresAt?: number;
}

export interface GcOptions {
  now?: number;
  maxAgeDays?: number;
  worktreeAlive?: (cwd: string) => boolean;
  fileExists?: (relPath: string) => boolean;
  dedup?: boolean;
  vacuum?: boolean;
  dryRun?: boolean;
}

export interface GcReport {
  stale: number;
  age: number;
  dedup: number;
  expired: number;
  orphan: number;
}

export interface SessionInfo {
  id: string;
  startTime: number;
  cwd: string;
  gitRoot: string;
}

export interface FilePrecheck {
  eventCount: number;
  lastTouched: number;
  sessions: string[];
  recentKeyTerms: string[];
}

export interface HotFile {
  path: string;
  refCount: number;
}

export class ProjectGraph {
  private store: RepoStore;
  private ready = false;

  // `mode` retained for signature compatibility; WAL handles concurrency, so it
  // no longer changes behavior.
  constructor(dbPath: string, _mode: "exclusive" | "shared" = "exclusive") {
    this.store = new RepoStore(dbPath);
  }

  isReady(): boolean {
    return this.ready;
  }

  async init(): Promise<void> {
    this.store.init();
    this.ready = true;
  }

  async close(): Promise<void> {
    this.store.close();
    this.ready = false;
  }

  async writeEvent(event: ProjectGraphEvent): Promise<void> {
    this.store.writeEvent(event);
  }

  async registerSession(info: SessionInfo): Promise<void> {
    this.store.registerSession(info);
  }

  async flushWrites(): Promise<void> {
    this.store.flushWrites();
  }

  async queryByFile(filePath: string): Promise<ProjectGraphEvent[]> {
    return this.store.queryByFile(filePath);
  }

  async queryByKeyword(keyword: string): Promise<ProjectGraphEvent[]> {
    return this.store.queryByKeyword(keyword);
  }

  async getRelated(id: string): Promise<ProjectGraphEvent[]> {
    return this.store.getRelated(id);
  }

  async getSequence(
    id: string,
    direction: "forward" | "backward" = "forward",
  ): Promise<ProjectGraphEvent[]> {
    return this.store.getSequence(id, direction);
  }

  async getSessions(): Promise<SessionInfo[]> {
    return this.store.getSessions();
  }

  async getSessionEvents(sessionId: string): Promise<ProjectGraphEvent[]> {
    return this.store.getSessionEvents(sessionId);
  }

  async queryByEventType(eventType: string, limit = 20): Promise<ProjectGraphEvent[]> {
    return this.store.queryByEventType(eventType, limit);
  }

  async precheckFile(filePath: string): Promise<FilePrecheck> {
    return this.store.precheckFile(filePath);
  }

  async getStats(): Promise<{ events: number; files: number; sessions: number }> {
    return this.store.getStats();
  }

  async getHotFiles(limit = 10): Promise<HotFile[]> {
    return this.store.getHotFiles(limit);
  }

  async collectGarbage(opts: GcOptions): Promise<GcReport> {
    return this.store.collectGarbage(opts);
  }

  async deleteEvents(ids: string[]): Promise<number> {
    return this.store.deleteEvents(ids);
  }
}
