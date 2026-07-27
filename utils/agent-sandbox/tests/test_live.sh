#!/usr/bin/env bash
# Live integration spec for pi-sandbox.
# Actually enters the sandbox and proves the filesystem boundary holds:
#   - a host secret in $HOME is invisible
#   - ~/.ssh is invisible
#   - pi is found on PATH
#   - git root is writable
#   - ~/.pi is writable
#
# Instead of launching pi, we override the sandboxed command to a probe
# script by pointing pi-sandbox at `bash`. We do this by running the same
# bwrap invocation the launcher prints via --dry-run, swapping the final
# `pi ...` for our probe.
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

echo "== pi-sandbox live boundary spec =="

# plant a host secret; guarantee cleanup on exit
SECRET="$HOME/.pi_sandbox_test_secret"
echo "HOST-ONLY-SECRET" > "$SECRET"
trap 'rm -f "$SECRET"' EXIT

# Build the bwrap command the launcher would use, but run a probe instead
# of pi. Grab everything up to (but not including) the trailing " pi".
CMD="$(cd "$SCRIPT_DIR" && "$SANDBOX" --dry-run)"
BWRAP_ARGS="${CMD% pi}"   # strip trailing " pi"

PROBE='
  { cat "$HOME/.pi_sandbox_test_secret" >/dev/null 2>&1 && echo SECRET_VISIBLE; } || echo SECRET_HIDDEN
  { ls "$HOME/.ssh" >/dev/null 2>&1 && echo SSH_VISIBLE; } || echo SSH_HIDDEN
  { command -v pi >/dev/null 2>&1 && echo PI_FOUND; } || echo PI_MISSING
  GR="$(git rev-parse --show-toplevel 2>/dev/null)"
  { touch "$GR/.sbx_wtest" 2>/dev/null && rm -f "$GR/.sbx_wtest" && echo GITROOT_RW; } || echo GITROOT_RO
  { touch "$HOME/.pi/.sbx_wtest" 2>/dev/null && rm -f "$HOME/.pi/.sbx_wtest" && echo DOTPI_RW; } || echo DOTPI_RO
'

# Execute: reuse the exact bwrap args, run bash -c PROBE as the sandboxed cmd.
OUT="$(cd "$SCRIPT_DIR" && eval "$BWRAP_ARGS /usr/bin/bash -c '$PROBE'" 2>&1)"

has() { printf '%s' "$OUT" | grep -q "$1"; }

check "host secret invisible"  has "SECRET_HIDDEN"
check "~/.ssh invisible"        has "SSH_HIDDEN"
check "pi found on PATH"        has "PI_FOUND"
check "git root writable"       has "GITROOT_RW"
check "~/.pi writable"          has "DOTPI_RW"

echo "-- $pass passed, $fail failed --"
[ "$fail" -eq 0 ]
