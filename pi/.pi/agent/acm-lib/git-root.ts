/**
 * Git root detection — finds the common repo root (not worktree root).
 *
 * Uses `git rev-parse --git-common-dir` to resolve through worktrees
 * to the actual repository root. All worktrees of a repo share one DB.
 */

import { execSync } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { realpathSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

// In-memory cache for current process
const rootCache = new Map<string, string | null>();

// File-based cache path
const GIT_ROOT_CACHE_FILE = ".pi/git-root.cache";

/**
 * Detect the git repo root for a given directory.
 * Returns the common root (shared across worktrees), not the worktree root.
 * Returns null if not inside a git repo.
 */
export function detectRepoRoot(cwd: string): string | null {
  // 1. In-memory cache (process-level)
  if (rootCache.has(cwd)) return rootCache.get(cwd)!;

  // 2. File-based cache (cross-session, avoids subprocess)
  const fileCachePath = join(cwd, GIT_ROOT_CACHE_FILE);
  if (existsSync(fileCachePath)) {
    try {
      const cached = readFileSync(fileCachePath, "utf-8").trim();
      if (cached && existsSync(join(cached, ".git"))) {
        rootCache.set(cwd, cached);
        return cached;
      }
    } catch { /* stale cache, re-detect */ }
  }

  // 3. Detect via git subprocess
  const root = detectRepoRootUncached(cwd);
  rootCache.set(cwd, root);

  // 4. Write file cache at the detected root
  if (root) {
    try {
      const cacheDir = join(root, ".pi");
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(join(root, GIT_ROOT_CACHE_FILE), root + "\n");
    } catch { /* non-fatal */ }
  }

  return root;
}

/** Uncached detection via git subprocess. Exported for testing. */
export function detectRepoRootUncached(cwd: string): string | null {
  try {
    // `--git-common-dir` throws (exit 128) outside a repo, which the catch
    // below turns into null — so it doubles as the "am I in a repo" guard; no
    // separate --show-toplevel probe is needed.
    const gitCommonDir = execSync("git rev-parse --git-common-dir", {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    // `--git-common-dir` already resolves to the shared .git for every
    // worktree (verified in git-root-integration.test.ts), so its parent is the
    // repo root directly — no /worktrees/<name> suffix ever needs stripping.
    const resolved = resolve(cwd, gitCommonDir);
    return realpathSync(dirname(resolved));
  } catch {
    return null;
  }
}

// In-memory cache for worktree roots
const worktreeRootCache = new Map<string, string | null>();

/**
 * Detect the worktree root for a given directory.
 * Returns the worktree-local root (via --show-toplevel), not the common root.
 * In a normal repo (no worktrees), this equals the repo root.
 * Returns null if not inside a git repo.
 */
export function detectWorktreeRoot(cwd: string): string | null {
  if (worktreeRootCache.has(cwd)) return worktreeRootCache.get(cwd)!;

  try {
    const toplevel = execSync("git rev-parse --show-toplevel", {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    const resolved = realpathSync(toplevel);
    worktreeRootCache.set(cwd, resolved);
    return resolved;
  } catch {
    worktreeRootCache.set(cwd, null);
    return null;
  }
}

/** Clear in-memory cache (for testing). */
export function clearRootCache(): void {
  rootCache.clear();
  worktreeRootCache.clear();
}

/**
 * Get the project DB path for a repo root.
 */
export function projectDbPath(repoRoot: string): string {
  return join(repoRoot, ".pi", "memory.db");
}
