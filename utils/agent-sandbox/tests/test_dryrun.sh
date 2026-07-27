#!/usr/bin/env bash
# TDD spec for pi-sandbox --dry-run.
# Asserts the generated bwrap command has the right filesystem boundary:
#   - git root mounted RW
#   - $HOME wiped with tmpfs then toolchain restored RO
#   - working dir preserved via --chdir
#   - host secrets (~/.ssh, ~/.aws) NEVER bound
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SANDBOX="$SCRIPT_DIR/pi-sandbox"

pass=0
fail=0

check() { # desc, condition already evaluated via $? -> use check "desc" && ...
  local desc="$1"; shift
  if "$@"; then
    printf '  ok   %s\n' "$desc"; pass=$((pass+1))
  else
    printf '  FAIL %s\n' "$desc"; fail=$((fail+1))
  fi
}

# Capture dry-run output. Run from a known git dir (this repo).
GITROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
OUT="$(cd "$SCRIPT_DIR" && "$SANDBOX" --dry-run 2>&1)"

contains()     { printf '%s' "$OUT" | grep -qF -- "$1"; }
not_contains() { ! printf '%s' "$OUT" | grep -qF -- "$1"; }

echo "== pi-sandbox --dry-run spec =="

# git root mounted read-write
check "git root bound RW"            contains "--bind $GITROOT $GITROOT"

# home erased then toolchain restored
check "home wiped with tmpfs"        contains "--tmpfs $HOME"
check "mise toolchain restored RO"   contains "--ro-bind $HOME/.local/share/mise $HOME/.local/share/mise"

# system tools available read-only
check "system /usr bound RO"         contains "--ro-bind /usr /usr"

# working directory preserved (same abs path so worktree .git resolves)
check "chdir to current dir"         contains "--chdir $SCRIPT_DIR"

# pi config persists read-write
check ".pi bound RW"                 contains "--bind-try $HOME/.pi $HOME/.pi"

# secrets must NOT leak into the sandbox
check "no ~/.ssh bind"               not_contains "$HOME/.ssh"
check "no ~/.aws bind"               not_contains "$HOME/.aws"

# command must actually invoke pi
check "invokes pi"                   contains "pi"

echo "-- $pass passed, $fail failed --"
[ "$fail" -eq 0 ]
