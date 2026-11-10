#!/usr/bin/env bash
# Run inside a test pane: fire bindings through tests/harness.lua one at a time,
# waiting for each to be acked in $HOME/out. Usage: fire.sh "keys CTRL h" ...
set -u
send() { printf '\033]1337;SetUserVar=TEST_KEY=%s\007' "$(printf %s "$1" | base64)"; }
acked() { grep -qF -- "$1 ->" "$HOME/out" 2>/dev/null; }
id="${FIRE_TAG:-$$}"
# the GUI drops events for panes it has not attached yet: probe until one lands.
# WANT_TITLE: also wait until the GUI sees this pane title (it lags the OSC from the server).
seen() { grep -F "probe x x #$id -> " "$HOME/out" 2>/dev/null | tail -1 | grep -qF "title=${WANT_TITLE:-}"; }
until seen; do
	send "probe x x #$id"
	sleep 0.3
done
i=0
for k in "$@"; do
	i=$((i + 1))
	send "$k #$id-$i"
	until acked "$k #$id-$i"; do sleep 0.1; done
done
