/** ACM type definitions. */

export interface RecallMetadata {
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

/** Persisted pinned content that survives slides. */
export interface PinnedContentEntry {
  entryId: string;
  role: string;
  content: string;
  toolName?: string;
  pinnedAt: number;
}

export interface AcmConfig {
  cacheTools?: string[];
  localTools?: string[];
  /** Skip caching for tool results smaller than this (chars). Default: 2000 */
  cacheMinChars?: number;
  /** Include first N chars as preview in cached stubs. Default: 1000 */
  previewChars?: number;
}
