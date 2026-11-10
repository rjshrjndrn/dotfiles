#!/usr/bin/env bash
# Spec: tmux-like keymap on leader C-f, so muscle memory from tmux.conf carries over.
# Asserts against `wezterm show-keys --lua`, the config wezterm actually resolved.
# Callbacks only show as EmitEvent, so their behaviour is a manual check (see AGENTS.md).
set -u
CONF="$(cd "$(dirname "$0")/.." && pwd)/.config/wezterm/wezterm.lua"
KEYS="$(wezterm --config-file "$CONF" show-keys --lua 2>/dev/null)"
PLAIN="$(wezterm --config-file "$CONF" show-keys 2>/dev/null)"
fails=0

# expect <key as printed> <mods> <action prefix as printed>
expect() {
	local line="{ key = '$1', mods = '$2', action = act.$3"
	grep -qF -- "$line" <<<"$KEYS" || { echo "FAIL: missing $line"; fails=$((fails + 1)); }
}
# shifted punctuation is bound with and without SHIFT so either key report matches.
# Uppercase letters need no twin: wezterm folds SHIFT+H into H.
expect_shifted() { expect "$1" LEADER "$2"; expect "$1" SHIFT\|LEADER "$2"; }

grep -qF "Leader: Char('f') CTRL" <<<"$PLAIN" || { echo "FAIL: leader is not C-f"; fails=$((fails + 1)); }

expect f CTRL\|LEADER "SendKey{ key =  'f', mods =  'CTRL' }"

# panes
expect '\\' LEADER "SplitHorizontal{ domain =  'CurrentPaneDomain' }"
expect - LEADER "SplitVertical{ domain =  'CurrentPaneDomain' }"
expect_shifted % "SplitHorizontal{ domain =  'CurrentPaneDomain' }"
expect_shifted '\"' "SplitVertical{ domain =  'CurrentPaneDomain' }"
expect LeftArrow LEADER "ActivatePaneDirection 'Left'"
expect RightArrow LEADER "ActivatePaneDirection 'Right'"
expect UpArrow LEADER "ActivatePaneDirection 'Up'"
expect DownArrow LEADER "ActivatePaneDirection 'Down'"
expect o LEADER "ActivatePaneDirection 'Next'"
expect q LEADER "PaneSelect"
expect z LEADER "TogglePaneZoomState"
expect x LEADER "CloseCurrentPane{ confirm = true }"
expect_shifted ! "EmitEvent 'user-defined-"

# resize: like tmux `bind -r`, first press resizes, repeats within 500ms keep resizing
expect H LEADER "Multiple{ { AdjustPaneSize = { 'Left', 5 } }, { ActivateKeyTable = { name =  'resize'"
expect J LEADER "Multiple{ { AdjustPaneSize = { 'Down', 5 } }, { ActivateKeyTable = { name =  'resize'"
expect K LEADER "Multiple{ { AdjustPaneSize = { 'Up', 5 } }, { ActivateKeyTable = { name =  'resize'"
expect L LEADER "Multiple{ { AdjustPaneSize = { 'Right', 5 } }, { ActivateKeyTable = { name =  'resize'"
expect H NONE "AdjustPaneSize{ 'Left', 5 }"
expect J NONE "AdjustPaneSize{ 'Down', 5 }"
expect K NONE "AdjustPaneSize{ 'Up', 5 }"
expect L NONE "AdjustPaneSize{ 'Right', 5 }"

# windows (wezterm tabs)
expect c LEADER "SpawnTab 'CurrentPaneDomain'"
expect C LEADER "PromptInputLine{"
expect , LEADER "PromptInputLine{"
expect_shifted '&' "CloseCurrentTab{ confirm = true }"
expect n LEADER "ActivateTabRelative(1)"
expect p LEADER "ActivateTabRelative(-1)"
expect l LEADER "ActivateLastTab"
for i in 1 2 3 4 5 6 7 8 9; do expect "$i" LEADER "ActivateTab($((i - 1)))"; done
expect f LEADER "ShowLauncherArgs{ flags =  'FUZZY|TABS' }"
expect w LEADER "ShowLauncherArgs{ flags =  'FUZZY|TABS' }"
expect ';' LEADER "EmitEvent 'user-defined-"

# sessions (wezterm workspaces)
expect S LEADER "PromptInputLine{"
expect F LEADER "ShowLauncherArgs{ flags =  'FUZZY|WORKSPACES' }"
expect s LEADER "ShowLauncherArgs{ flags =  'FUZZY|WORKSPACES' }"
expect_shifted '$' "PromptInputLine{"
expect "\\'" LEADER "EmitEvent 'user-defined-"
expect d LEADER "DetachDomain 'CurrentPaneDomain'"

# copy / misc
expect v LEADER "ActivateCopyMode"
expect [ LEADER "ActivateCopyMode"
expect ] LEADER "PasteFrom 'Clipboard'"
expect u LEADER "QuickSelectArgs{"
expect r LEADER "ReloadConfiguration"
expect_shifted : "ActivateCommandPalette"

# pre-existing ALT+n tab switching must survive
for i in 1 2 3 4 5 6 7 8; do expect "$i" ALT "ActivateTab($((i - 1)))"; done

[ "$fails" -eq 0 ] || { echo "FAIL: test_keys ($fails missing)"; exit 1; }
echo "PASS: test_keys"
