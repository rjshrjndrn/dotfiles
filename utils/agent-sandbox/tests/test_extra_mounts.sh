#!/usr/bin/env bash
# Spec for configurable extra binds via EXTRA_RO / EXTRA_RW env vars.
#   EXTRA_RO="a b"  -> each added as --ro-bind-try
#   EXTRA_RW="a b"  -> each added as --bind-try
# Space-separated, multiple entries supported.
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

echo "== pi-sandbox extra-mounts spec =="

OUT="$(cd "$SCRIPT_DIR" && EXTRA_RO="/data/ro1 /data/ro2" EXTRA_RW="/data/rw1" "$SANDBOX" --dry-run 2>&1)"
has()    { printf '%s' "$OUT" | grep -qF -- "$1"; }
hasnot() { ! printf '%s' "$OUT" | grep -qF -- "$1"; }

check "first EXTRA_RO bound RO"   has "--ro-bind-try /data/ro1 /data/ro1"
check "second EXTRA_RO bound RO"  has "--ro-bind-try /data/ro2 /data/ro2"
check "EXTRA_RW bound RW"         has "--bind-try /data/rw1 /data/rw1"

# When unset, no phantom binds appear.
OUT="$(cd "$SCRIPT_DIR" && "$SANDBOX" --dry-run 2>&1)"
check "no extra binds when unset" hasnot "/data/"

echo "-- $pass passed, $fail failed --"
[ "$fail" -eq 0 ]
