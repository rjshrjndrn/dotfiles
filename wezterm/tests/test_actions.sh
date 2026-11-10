#!/usr/bin/env bash
# Spec: bound actions behave like tmux against real mux panes.
# tests/harness.lua lets a pane fire a binding via user var, so no OS keystrokes needed.
# Isolated HOME: the real mux is never touched.
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
export WEZ_REAL_CONFIG="$DIR/../.config/wezterm/wezterm.lua"
export WEZTERM_CONFIG_FILE="$DIR/harness.lua"
export HOME; HOME="$(mktemp -d /tmp/wez-test.XXXX)"
SOCK="$HOME/.local/share/wezterm/sock"
GUI=""
fails=0

cleanup() {
	[ -n "$GUI" ] && kill "$GUI" 2>/dev/null
	[ -S "$SOCK" ] && lsof -t "$SOCK" 2>/dev/null | xargs kill 2>/dev/null
	rm -rf "$HOME"
}
trap cleanup EXIT
fail() { echo "FAIL: $*"; fails=$((fails + 1)); }
wait_for() { for _ in $(seq 1 20); do eval "$1" && return 0; sleep 0.5; done; return 1; }
# fire "keys CTRL h" ... -> shell snippet that triggers bindings from inside a pane
fire() { printf 'FIRE_TAG=%q ' "${FIRE_TAG:-}"; printf '%q ' "$DIR/fire.sh" "$@"; printf ';'; }
# per-check tag so each check reads only its own log lines
TAG=0; next_tag() { TAG=$((TAG + 1)); FIRE_TAG="t$TAG"; }
pane_json() { wezterm cli list --format json | python3 -c "import json,sys;p=[x for x in json.load(sys.stdin) if x['pane_id']==$1][0];print(p['$2'])"; }
fresh_window() { wezterm cli spawn --new-window -- bash -c "sleep 60"; }

wezterm >/dev/null 2>&1 & GUI=$!
wait_for 'wezterm cli list >/dev/null 2>&1' || { echo "FAIL: mux not up"; exit 1; }

# --- harness sanity: LEADER z zooms the pane that fired it
A=$(fresh_window)
B=$(wezterm cli split-pane --pane-id "$A" --right -- bash -c "$(fire 'keys LEADER z') sleep 60")
wait_for '[ "$(pane_json $B is_zoomed)" = True ]' || fail "harness: LEADER z did not zoom pane $B"

# Did binding $1 move focus off the pane that fired it? -> moved | stayed | none
# Uses the harness log (GUI pane ids). GUI ids differ from `cli` ids under the mux client,
# and `cli list` is_active lags, so compare from/active within the log only.
# Tabs here hold two panes, so "moved" means it reached the one neighbour.
focus_after() {
	wait_for "grep -q '^$1 #$2-' \$HOME/out" || { echo none; return; }
	grep "^$1 #$2-" "$HOME/out" | tail -1 | sed -E 's/.*from=([0-9]+) active=([0-9]+) .*/\1 \2/' |
		awk '{ print ($1 == $2 ? "stayed" : "moved") }'
}

# --- C-h in a shell pane moves focus left
next_tag
A=$(fresh_window)
B=$(wezterm cli split-pane --pane-id "$A" --right -- bash -c "$(fire 'keys CTRL h') sleep 60")
[ "$(focus_after 'keys CTRL h' "$FIRE_TAG")" = moved ] || fail "C-h in shell pane did not focus left pane"

# --- C-l moves focus right
next_tag
A=$(fresh_window)
B=$(wezterm cli split-pane --pane-id "$A" --left -- bash -c "$(fire 'keys CTRL l') sleep 60")
[ "$(focus_after 'keys CTRL l' "$FIRE_TAG")" = moved ] || fail "C-l in shell pane did not focus right pane"

# --- C-h in a vim pane is passed to vim, focus stays
next_tag
A=$(fresh_window)
B=$(wezterm cli split-pane --pane-id "$A" --right -- bash -c \
	"stty -icanon -echo; printf '\\033]2;nvim\\007'; WANT_TITLE=nvim $(fire 'keys CTRL h') IFS= read -rsn1 k; printf %q \"\$k\" > $HOME/got; sleep 60")
[ "$(focus_after 'keys CTRL h' "$FIRE_TAG")" = stayed ] || fail "focus left the vim pane"
wait_for '[ -s $HOME/got ]' || fail "vim pane never received a key"
[ "$(cat "$HOME/got" 2>/dev/null)" = "\$'\\b'" ] || fail "vim pane got '$(cat "$HOME/got" 2>/dev/null)', want C-h (\$'\\b')"

[ "$fails" -eq 0 ] || { echo "FAIL: test_actions ($fails)"; ls "$HOME"; cat "$HOME/out"; wezterm cli list; exit 1; }
echo "PASS: test_actions"
