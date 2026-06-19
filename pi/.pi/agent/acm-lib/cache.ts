/** Disk cache operations for external tool results. */

import { writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { extractKeywords } from "./helpers.ts";

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

/** Build a cached stub with file path for external tool results. */
export function buildCachedStub(
  toolName: string,
  cachePath: string,
  keyTerms: string,
  content?: string,
  previewChars: number = 1000,
): string {
  const preview = content && content.length > 0 && previewChars > 0
    ? `\n---preview (first ${previewChars} chars)---\n${content.slice(0, previewChars)}\n---end preview---\nFull content: \`bash head -200 ${cachePath}\` or \`bash rg 'pattern' ${cachePath}\``
    : `\nFull content saved to file above. Read it with \`bash head -200 ${cachePath}\` or \`bash rg 'pattern' ${cachePath}\` before proceeding.`;
  return `[cached: ${cachePath} | ${toolName} | ${extractKeywords(keyTerms, 10)}]${preview}`;
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
