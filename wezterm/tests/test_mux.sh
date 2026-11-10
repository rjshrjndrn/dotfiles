#!/usr/bin/env bash
# Spec: plain `wezterm` attaches to the unix-domain mux server, so programs
# survive a GUI crash and a new GUI reattaches to them.
# Isolated via a throwaway HOME, so the real mux/socket is never touched.
set -u
CONF="$(cd "$(dirname "$0")/.." && pwd)/.config/wezterm/wezterm.lua"
export HOME; HOME="$(mktemp -d /tmp/wez-test.XXXX)"
export WEZTERM_CONFIG_FILE="$CONF"
SOCK="$HOME/.local/share/wezterm/sock"
MARK="sleep 7$$"
GUI=""

cleanup() {
	[ -n "$GUI" ] && kill "$GUI" 2>/dev/null
	pkill -f "$MARK" 2>/dev/null
	[ -S "$SOCK" ] && lsof -t "$SOCK" 2>/dev/null | xargs kill 2>/dev/null
	rm -rf "$HOME"
}
trap cleanup EXIT
fail() { echo "FAIL: $*"; exit 1; }
wait_for() { for _ in $(seq 1 20); do eval "$1" && return 0; sleep 0.5; done; return 1; }

wezterm >/dev/null 2>&1 & GUI=$!
wait_for '[ -S "$SOCK" ]' || fail "plain wezterm did not start a unix-domain mux server"
wait_for 'wezterm cli list >/dev/null 2>&1' || fail "mux server not answering"

PANE=$(wezterm cli spawn --new-window -- $MARK) || fail "cli spawn failed"
wait_for 'pgrep -f "$MARK" >/dev/null' || fail "marker process not running"

kill -9 "$GUI"; wait "$GUI" 2>/dev/null; GUI=""
sleep 1
pgrep -f "$MARK" >/dev/null || fail "marker died with the GUI"
LIST=$(wezterm cli list --format json); echo "$LIST" | grep -q "\"pane_id\": *$PANE," || fail "mux server lost pane $PANE"

wezterm >/dev/null 2>&1 & GUI=$!
wait_for '[ "$(wezterm cli list-clients 2>/dev/null | wc -l)" -ge 2 ]' || fail "new GUI did not reattach"
pgrep -f "$MARK" >/dev/null || fail "marker died on reattach"

echo "PASS: test_mux"
