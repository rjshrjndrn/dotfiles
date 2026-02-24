#!/usr/bin/env bash

# Focus the first window whose title or class matches the given argument.
# Usage: focus-window.sh <search-term>

if [[ -z "$1" ]]; then
  echo "Usage: focus-window.sh <search-term>" >&2
  exit 1
fi

WIN_ID=$(kdotool search --name --class --limit 1 "$1")
if [[ -z "$WIN_ID" ]]; then
  echo "focus-window: no window found matching '$1'" >&2
  exit 1
fi

DESKTOP=$(kdotool get_desktop_for_window "$WIN_ID")
kdotool set_desktop "$DESKTOP"
kdotool windowactivate "$WIN_ID"
