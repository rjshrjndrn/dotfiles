#!/usr/bin/env bash
# Spec: the user's git config must be visible inside the sandbox.
# $HOME is a tmpfs, so ~/.gitconfig (and any include it references) is
# gone unless explicitly bound. The launcher binds the resolved
# ~/.gitconfig onto ~/.gitconfig read-only, so user.name/email, signing,
# and aliases work.
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

echo "== pi-sandbox gitconfig spec =="

OUT="$(cd "$SCRIPT_DIR" && "$SANDBOX" --dry-run 2>&1)"
GC_REAL="$(readlink -f "$HOME/.gitconfig" 2>/dev/null || echo "$HOME/.gitconfig")"

check "gitconfig bound onto ~/.gitconfig" \
  bash -c 'printf "%s" "$0" | grep -qF -- "--ro-bind-try $1 $2/.gitconfig"' "$OUT" "$GC_REAL" "$HOME"

# live: git inside the sandbox reads the same user.name as the host
HOST_NAME="$(git config --global user.name 2>/dev/null)"
CMD="$(cd "$SCRIPT_DIR" && "$SANDBOX" --dry-run)"
BWRAP_ARGS="${CMD% pi}"
SBX_NAME="$(cd "$SCRIPT_DIR" && eval "$BWRAP_ARGS /usr/bin/bash -c 'git config --global user.name 2>&1'" 2>&1)"

check "user.name visible in sandbox" \
  bash -c '[ -n "$1" ] && [ "$1" = "$2" ]' _ "$HOST_NAME" "$SBX_NAME"

echo "-- $pass passed, $fail failed --"
[ "$fail" -eq 0 ]
