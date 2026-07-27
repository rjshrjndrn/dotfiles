#!/usr/bin/env bash
# Spec: DNS must work inside the sandbox.
# On systemd hosts /etc/resolv.conf is a symlink into /run, which is not
# mounted, so the launcher must bind the *resolved* resolv.conf onto the
# canonical /etc/resolv.conf path.
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

echo "== pi-sandbox dns spec =="

# 1. dry-run: the resolved resolv.conf target is bound at its own path so
#    the /etc/resolv.conf symlink resolves without writing into RO /etc.
RESOLV="$(readlink -f /etc/resolv.conf 2>/dev/null || echo /etc/resolv.conf)"
OUT="$(cd "$SCRIPT_DIR" && "$SANDBOX" --dry-run 2>&1)"
check "resolv.conf target bound at own path" \
  bash -c 'printf "%s" "$0" | grep -qF -- "--ro-bind-try $1 $1"' "$OUT" "$RESOLV"

# 2. live: resolv.conf is readable and DNS resolves inside the sandbox
CMD="$(cd "$SCRIPT_DIR" && "$SANDBOX" --dry-run)"
BWRAP_ARGS="${CMD% pi}"
LIVE="$(cd "$SCRIPT_DIR" && eval "$BWRAP_ARGS /usr/bin/bash -c 'getent hosts api.anthropic.com >/dev/null 2>&1 && echo DNS_OK || echo DNS_FAIL'" 2>&1)"
check "DNS resolves inside sandbox" bash -c 'printf "%s" "$0" | grep -q DNS_OK' "$LIVE"

echo "-- $pass passed, $fail failed --"
[ "$fail" -eq 0 ]
