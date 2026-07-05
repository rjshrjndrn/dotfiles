/**
 * Git root detection — finds the common repo root (not worktree root).
 *
 * Uses `git rev-parse --git-common-dir` to resolve through worktrees
 * to the actual repository root. All worktrees of a repo share one DB.
 */

import { execSync } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { realpathSync } from "node:fs";

/**
 * Detect the git repo root for a given directory.
 * Returns the common root (shared across worktrees), not the worktree root.
 * Returns null if not inside a git repo.
 */
export function detectRepoRoot(cwd: string): string | null {
  try {
    // --git-common-dir returns the .git dir shared across worktrees
    // For regular repos: ".git"
    // For worktrees: "/absolute/path/to/main/.git"
    const gitCommonDir = execSync("git rev-parse --git-common-dir", {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    // Get the worktree toplevel to resolve relative paths
    const toplevel = execSync("git rev-parse --show-toplevel", {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    // Resolve gitCommonDir to absolute path
    // --git-common-dir returns path relative to cwd, not toplevel
    // For regular repos: ".git" or "../../.git" (relative to cwd)
    // For worktrees: absolute path to main repo's .git/worktrees/<name>
    const resolved = resolve(cwd, gitCommonDir);
    // Strip trailing /worktrees/<name> if present, then strip .git
    const normalized = resolved.replace(/\/worktrees\/[^/]+$/, "");
    return realpathSync(dirname(normalized));
  } catch {
    return null;
  }
}

/**
 * Get the project DB path for a repo root.
 */
export function projectDbPath(repoRoot: string): string {
  return join(repoRoot, ".pi", "memory.lbug");
}
