import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { detectRepoRoot, detectWorktreeRoot, projectDbPath } from "../acm-lib/git-root.ts";

describe("detectRepoRoot", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "git-root-test-"));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns repo root for a git repo", () => {
    const repo = join(tmpDir, "repo");
    mkdirSync(repo);
    execSync("git init", { cwd: repo });

    const root = detectRepoRoot(repo);
    expect(root).toBe(realpathSync(repo));
  });

  it("returns repo root from a subdirectory", () => {
    const repo = join(tmpDir, "repo2");
    const sub = join(repo, "src", "deep");
    mkdirSync(sub, { recursive: true });
    execSync("git init", { cwd: repo });

    const root = detectRepoRoot(sub);
    expect(root).toBe(realpathSync(repo));
  });

  it("returns null for non-git directory", () => {
    const noGit = join(tmpDir, "nogit");
    mkdirSync(noGit);

    const root = detectRepoRoot(noGit);
    expect(root).toBeNull();
  });

  it("returns common root for worktrees (not worktree root)", () => {
    const main = join(tmpDir, "wt-main");
    mkdirSync(main);
    execSync("git init", { cwd: main });
    execSync("git commit --allow-empty -m 'init'", { cwd: main });
    execSync("git branch feature", { cwd: main });

    const wtPath = join(tmpDir, "wt-feature");
    execSync(`git worktree add ${wtPath} feature`, { cwd: main });

    const rootFromMain = detectRepoRoot(main);
    const rootFromWorktree = detectRepoRoot(wtPath);

    // Both should resolve to same repo root
    expect(rootFromMain).toBe(realpathSync(main));
    expect(rootFromWorktree).toBe(realpathSync(main));
  });
});

describe("detectWorktreeRoot", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "wt-root-test-"));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns repo root for a normal git repo (no worktree)", () => {
    const repo = join(tmpDir, "repo");
    mkdirSync(repo);
    execSync("git init", { cwd: repo });

    const root = detectWorktreeRoot(repo);
    expect(root).toBe(realpathSync(repo));
  });

  it("returns worktree root (not common root) when inside a worktree", () => {
    const main = join(tmpDir, "wt-main");
    mkdirSync(main);
    execSync("git init", { cwd: main });
    execSync("git commit --allow-empty -m 'init'", { cwd: main });
    execSync("git branch feature", { cwd: main });

    const wtPath = join(tmpDir, "wt-feature");
    execSync(`git worktree add ${wtPath} feature`, { cwd: main });

    const rootFromMain = detectWorktreeRoot(main);
    const rootFromWorktree = detectWorktreeRoot(wtPath);

    // Main repo → its own root
    expect(rootFromMain).toBe(realpathSync(main));
    // Worktree → worktree path, NOT main repo
    expect(rootFromWorktree).toBe(realpathSync(wtPath));
  });

  it("returns worktree root from a subdirectory inside worktree", () => {
    const main = join(tmpDir, "wt-main2");
    mkdirSync(main);
    execSync("git init", { cwd: main });
    execSync("git commit --allow-empty -m 'init'", { cwd: main });
    execSync("git branch feat2", { cwd: main });

    const wtPath = join(tmpDir, "wt-feat2");
    execSync(`git worktree add ${wtPath} feat2`, { cwd: main });
    const sub = join(wtPath, "src", "deep");
    mkdirSync(sub, { recursive: true });

    const root = detectWorktreeRoot(sub);
    expect(root).toBe(realpathSync(wtPath));
  });

  it("returns null for non-git directory", () => {
    const noGit = join(tmpDir, "nogit");
    mkdirSync(noGit);
    expect(detectWorktreeRoot(noGit)).toBeNull();
  });
});

describe("projectDbPath", () => {
  it("returns .pi/memory.lbug under repo root", () => {
    const repo = "/Users/skynet/project-x";
    const dbPath = projectDbPath(repo);
    expect(dbPath).toBe("/Users/skynet/project-x/.pi/memory.lbug");
  });
});
