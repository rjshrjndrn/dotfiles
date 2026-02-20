#!/usr/bin/env bash

# Focus the first window whose title or class contains "firefox"
WIN_ID=$(kdotool search --name --class --limit 1 "kitty")
[[ -z "$WIN_ID" ]] && exit 0

DESKTOP=$(kdotool get_desktop_for_window "$WIN_ID")
kdotool set_desktop "$DESKTOP"
kdotool windowactivate "$WIN_ID"
