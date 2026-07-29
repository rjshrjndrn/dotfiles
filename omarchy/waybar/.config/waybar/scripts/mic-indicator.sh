#!/bin/bash
# Show an icon when a real microphone (not a playback monitor) is being captured.

active=0
declare -A monitor_src

# Build map of source-id -> is-monitor by parsing `pactl list sources`.
current_id=""
while IFS= read -r line; do
  if [[ $line =~ ^Source\ #([0-9]+) ]]; then
    current_id="${BASH_REMATCH[1]}"
  elif [[ $line =~ Name:\ (.+)$ ]] && [[ -n $current_id ]]; then
    name="${BASH_REMATCH[1]}"
    if [[ $name == *.monitor ]]; then
      monitor_src[$current_id]=1
    else
      monitor_src[$current_id]=0
    fi
    current_id=""
  fi
done < <(pactl list sources)

# Any source-output whose Source is a non-monitor => mic in use.
while IFS= read -r line; do
  if [[ $line =~ Source:\ ([0-9]+) ]]; then
    sid="${BASH_REMATCH[1]}"
    if [[ ${monitor_src[$sid]:-0} -eq 0 ]]; then
      active=1
      break
    fi
  fi
done < <(pactl list source-outputs)

if [[ $active -eq 1 ]]; then
  echo '{"text": "󰍬", "tooltip": "Microphone in use", "class": "active"}'
else
  echo '{"text": ""}'
fi
