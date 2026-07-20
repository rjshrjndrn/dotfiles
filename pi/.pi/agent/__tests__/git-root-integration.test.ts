import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  detectRepoRootUncached,
  detectRepoRoot,
  detectWorktreeRoot,
  projectDbPath,
  clearRootCache,
} from "../acm-lib/git-root.ts";

// Integration guard: these tests shell out to REAL git in a temp dir to prove
// the load-bearing invariant behind the worktree-shared knowledge base —
// every worktree of a repo resolves to ONE common root, hence ONE memory.db.
//
// Verified live against git 2.54 before being codified here (explore -> guard).
// Unit tests elsewhere cover the pure path math on a mocked string; this file
// proves the same holds against actual `git rev-parse` output, which is the
// part that can silently drift across git versions.

const hasGit = (() => {
  try {
    execSync("git --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const d = hasGit ? describe : describe.skip;

function git(cwd: string, cmd: string): string {
  return execSync(`git ${cmd}`, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

// Build a real repo with one commit, return its realpath'd root.
function initRepo(root: string): string {
  mkdirSync(root, { recursive: true });
  git(root, "init --quiet");
  git(root, "config user.email t@t.co");
  git(root, "config user.name t");
  writeFileSync(join(root, "a.txt"), "hello");
  git(root, "add a.txt");
  git(root, "commit --quiet -m init");
  return realpathSync(root);
}

let base: string;

beforeAll(() => {
  base = mkdtempSync(join(realpathSync(tmpdir()), "git-root-it-"));
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
  clearRootCache();
});

d("detectRepoRoot against real git", () => {
  it("resolves a plain repo to its toplevel", () => {
    const root = initRepo(join(base, "plain"));
    expect(detectRepoRootUncached(root)).toBe(root);
  });

  it("resolves from a nested subdirectory to the repo root", () => {
    const root = initRepo(join(base, "nested"));
    const deep = join(root, "x", "y", "z");
    mkdirSync(deep, { recursive: true });
    expect(detectRepoRootUncached(deep)).toBe(root);
  });

  it("returns null outside any git repo", () => {
    const notRepo = join(base, "not-a-repo");
    mkdirSync(notRepo, { recursive: true });
    expect(detectRepoRootUncached(notRepo)).toBeNull();
  });

  it("stays stable across commit and amend", () => {
    const root = initRepo(join(base, "amend"));
    const before = detectRepoRootUncached(root);
    writeFileSync(join(root, "b.txt"), "x");
    git(root, "add b.txt");
    git(root, "commit --quiet -m second");
    const afterCommit = detectRepoRootUncached(root);
    git(root, "commit --quiet --amend -m second-amended");
    const afterAmend = detectRepoRootUncached(root);
    expect(afterCommit).toBe(before);
    expect(afterAmend).toBe(before);
  });
});

d("worktree sharing (the load-bearing invariant)", () => {
  it("a linked worktree resolves to the SAME repo root as the main checkout", () => {
    const root = initRepo(join(base, "shared"));
    const wt = join(base, "shared-wt");
    git(root, `worktree add --quiet ${wt} -b feature`);

    const mainRoot = detectRepoRootUncached(root);
    const wtRoot = detectRepoRootUncached(wt);
    expect(wtRoot).toBe(mainRoot); // both collapse to the common root
  });

  it("therefore both share ONE memory.db path", () => {
    const root = initRepo(join(base, "onedb"));
    const wt = join(base, "onedb-wt");
    git(root, `worktree add --quiet ${wt} -b feature`);

    const dbMain = projectDbPath(detectRepoRootUncached(root)!);
    const dbWt = projectDbPath(detectRepoRootUncached(wt)!);
    expect(dbWt).toBe(dbMain);
    expect(dbMain).toBe(join(root, ".pi", "memory.db"));
  });

  it("detectWorktreeRoot, by contrast, returns the worktree-LOCAL root", () => {
    const root = initRepo(join(base, "local"));
    const wt = join(base, "local-wt");
    git(root, `worktree add --quiet ${wt} -b feature`);

    expect(detectWorktreeRoot(root)).toBe(realpathSync(root));
    expect(detectWorktreeRoot(wt)).toBe(realpathSync(wt));
    expect(detectWorktreeRoot(wt)).not.toBe(detectWorktreeRoot(root));
  });
});

d("characterization: why worktree resolution works", () => {
  // Documents the git behavior the code relies on. `--git-common-dir` from a
  // linked worktree points at the SHARED .git with NO `/worktrees/<name>`
  // suffix — that suffix appears only in `--git-dir`, which git-root.ts does
  // not use. If a future git version changes this, this guard fails loudly and
  // the resolution logic must be re-examined.
  it("git-common-dir from a worktree has no /worktrees/ suffix", () => {
    const root = initRepo(join(base, "charac"));
    const wt = join(base, "charac-wt");
    git(root, `worktree add --quiet ${wt} -b feature`);

    const commonDir = git(wt, "rev-parse --git-common-dir");
    const gitDir = git(wt, "rev-parse --git-dir");

    expect(commonDir).not.toMatch(/\/worktrees\//); // shared .git
    expect(gitDir).toMatch(/\/worktrees\/charac-wt$/); // per-worktree (unused)
    // dirname(common-dir) is the repo root the code returns.
    expect(realpathSync(dirname(commonDir))).toBe(realpathSync(root));
  });
});

d("cache behavior", () => {
  it("cached detectRepoRoot agrees with the uncached result and clears", () => {
    const root = initRepo(join(base, "cache"));
    clearRootCache();
    const cached = detectRepoRoot(root);
    expect(cached).toBe(detectRepoRootUncached(root));
    clearRootCache(); // must not throw
  });
});
