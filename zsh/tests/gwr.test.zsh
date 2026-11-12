#!/usr/bin/env zsh
# Tests for gwr in zsh/.aliases. Run: zsh zsh/tests/gwr.test.zsh
emulate -L zsh


aliases_file=${0:A:h:h}/.aliases
eval "$(sed -n '/^function gwr()/,/^}/p' "$aliases_file")"

fails=0
check() { # check <description> <command...>
  local desc=$1; shift
  if "$@" >/dev/null 2>&1; then echo "ok   $desc"; else echo "FAIL $desc"; fails=$((fails + 1)); fi
}
not() { ! "$@" }
has_branch() { git show-ref --verify --quiet "refs/heads/$1" }
has_worktree() { git worktree list --porcelain | grep -qx "worktree ${1:A}" }

repo=$(mktemp -d)
trap 'rm -rf "$repo"' EXIT
cd "$repo"
git init -q -b main . && git commit -q --allow-empty -m init

# F1+F2: slashed branch passed by name
git worktree add -q -b feat/slash worktree/feat/slash
gwr feat/slash >/dev/null 2>&1
check "slashed branch: worktree removed" not has_worktree worktree/feat/slash
check "slashed branch: branch deleted" not has_branch feat/slash

# path input
git worktree add -q -b fix/by-path worktree/fix/by-path
gwr worktree/fix/by-path >/dev/null 2>&1
check "path input: worktree removed" not has_worktree worktree/fix/by-path
check "path input: full branch deleted" not has_branch fix/by-path

# branch name unrelated to path
git worktree add -q -b plain elsewhere/dir
gwr plain >/dev/null 2>&1
check "branch != path: worktree removed" not has_worktree elsewhere/dir
check "branch != path: branch deleted" not has_branch plain

# detached worktree: remove it, delete nothing
git worktree add -q --detach worktree/det
gwr worktree/det >/dev/null 2>&1
check "detached: worktree removed" not has_worktree worktree/det
check "detached: main untouched" has_branch main

# extra args forwarded (--force on dirty worktree)
git worktree add -q -b feat/dirty worktree/feat/dirty
touch worktree/feat/dirty/junk
gwr feat/dirty --force >/dev/null 2>&1
check "--force forwarded: worktree removed" not has_worktree worktree/feat/dirty
check "--force forwarded: branch deleted" not has_branch feat/dirty

# dirty worktree without --force: keep branch (no data loss)
git worktree add -q -b feat/keep worktree/feat/keep
touch worktree/feat/keep/junk
gwr feat/keep >/dev/null 2>&1
check "remove fails: worktree kept" has_worktree worktree/feat/keep
check "remove fails: branch kept" has_branch feat/keep

# unknown input fails
check "unknown input: non-zero exit" not gwr nope/missing

echo
(( fails == 0 )) && echo "all passed" || { echo "$fails failed"; exit 1 }
