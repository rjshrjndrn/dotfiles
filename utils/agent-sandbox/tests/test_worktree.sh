#!/usr/bin/env bash
# Spec: git must work when launched from a linked worktree.
#
# A worktree's working tree lives at --show-toplevel, but its .git file
# points (by absolute path) into the MAIN repo's .git/worktrees/<name>,
# and the object store lives at --git-common-dir. Binding only the
# worktree dir leaves git blind. The launcher must also bind the common
# git dir at its own absolute path.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SANDBOX="$SCRIPT_DIR/pi-sandbox"

pass=0
fail=0
check() {
  local desc="$1"; shift
  if "$@"; then printf '  ok   %s\n' "$desc"; pass=$((pass+1))
  else printf '  FAIL %s\n' "$desc"; fail=$((fail+1)); fi
}

echo "== pi-sandbox worktree spec =="

# fixture: a linked worktree off this repo
MAINROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
WT="$(mktemp -d /tmp/pi-sbx-wt.XXXXXX)"
rm -rf "$WT"
git -C "$MAINROOT" worktree add -q "$WT" HEAD
trap 'git -C "$MAINROOT" worktree remove --force "$WT" 2>/dev/null; rm -rf "$WT"' EXIT

COMMON="$(git -C "$WT" rev-parse --path-format=absolute --git-common-dir)"

# dry-run from inside the worktree
OUT="$(cd "$WT" && "$SANDBOX" --dry-run 2>&1)"
has() { printf '%s' "$OUT" | grep -qF -- "$1"; }

check "worktree dir bound RW"       has "--bind $WT $WT"
check "git common dir bound RW"     has "--bind-try $COMMON $COMMON"

# live: git actually works inside the sandbox from the worktree
CMD="$(cd "$WT" && "$SANDBOX" --dry-run)"
BWRAP_ARGS="${CMD% pi}"
LIVE="$(cd "$WT" && eval "$BWRAP_ARGS /usr/bin/bash -c 'cd $WT && git rev-parse --is-inside-work-tree 2>&1 && git status --porcelain 2>&1; echo rc=\$?'" 2>&1)"
check "git works inside sandbox" bash -c 'printf "%s" "$0" | grep -q "rc=0"' "$LIVE"
check "no fatal git error"       bash -c '! printf "%s" "$0" | grep -qi "fatal"' "$LIVE"

echo "-- $pass passed, $fail failed --"
[ "$fail" -eq 0 ]
