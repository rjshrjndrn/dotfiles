/** Config loading and tool classification. */

import type { AcmConfig } from "./types.ts";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Parameter names that commonly contain file paths in tool call arguments. */
export const FILE_PATH_PARAMS = ["path", "file", "file_path", "filePath", "filename", "file_name"] as const;

export function extractToolCallPaths(args: Record<string, any>): string[] {
  const paths: string[] = [];
  if (!args || typeof args !== "object") return paths;
  for (const key of FILE_PATH_PARAMS) {
    if (typeof args[key] === "string" && args[key]) paths.push(args[key]);
  }
  return paths;
}

/**
 * Local tool set — populated at boot from pi.getAllTools().
 * Tools in this set are re-derivable (on disk or re-runnable).
 *
 * NOTE: MCP calls come through toolName="mcp" with the actual tool in args.tool.
 * MCP sub-tools that make API calls are always cached (cheap to store, expensive to re-fetch).
 */
export const localToolSet = new Set<string>();

/** Loaded config overrides. */
export let acmConfig: AcmConfig = {};

/** Load acm.json config from extension directory. */
export function loadAcmConfig(extensionDir: string): AcmConfig {
  const configPath = join(extensionDir, "acm.json");
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    return {};
  }
}

/** Populate localToolSet from registered tools at boot. */
export function discoverLocalTools(allTools: Array<{ name: string }>, config?: AcmConfig): void {
  localToolSet.clear();
  for (const tool of allTools) {
    localToolSet.add(tool.name);
  }
  // Apply config overrides
  if (config?.localTools) {
    for (const t of config.localTools) localToolSet.add(t);
  }
  if (config) acmConfig = config;
}

/** Check if a tool result should be cached to disk (external/internet content). */
export function isExternalTool(toolName: string, toolArgs?: Record<string, any>): boolean {
  // MCP gateway: sub-tool calls always go to external APIs — cache them
  if (toolName === "mcp") {
    if (!toolArgs?.tool) return false; // meta calls (status/describe/list)
    return true;
  }
  // Config override: explicitly marked for caching
  if (acmConfig.cacheTools?.includes(toolName)) return true;
  // Tools discovered at boot are local — don't cache
  if (localToolSet.has(toolName)) return false;
  // Unknown tools: default to NOT caching (keep normal clear/stub behavior)
  return false;
}
