#!/bin/sh
input=$(cat)

cwd=$(echo "$input" | jq -r '.cwd')
model=$(echo "$input" | jq -r '.model.display_name')
used=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
ctx_input=$(echo "$input" | jq -r '(.context_window.total_input_tokens // 0) + (.context_window.total_output_tokens // 0)')
ctx_max=$(echo "$input" | jq -r '.context_window.context_window_size // empty')

# Directory: show ~ for home
dir=$(echo "$cwd" | sed "s|^$HOME|~|")

# Git branch (skip optional locks)
branch=$(git -C "$cwd" --no-optional-locks symbolic-ref --short HEAD 2>/dev/null)

# Git status indicators
git_info=""
if [ -n "$branch" ]; then
  modified=$(git -C "$cwd" --no-optional-locks status --porcelain 2>/dev/null | grep -c '^ M\|^M')
  untracked=$(git -C "$cwd" --no-optional-locks status --porcelain 2>/dev/null | grep -c '^??')
  staged=$(git -C "$cwd" --no-optional-locks status --porcelain 2>/dev/null | grep -c '^[MADRC]')
  ahead=$(git -C "$cwd" --no-optional-locks rev-list @{u}..HEAD 2>/dev/null | wc -l | tr -d ' ')
  behind=$(git -C "$cwd" --no-optional-locks rev-list HEAD..@{u} 2>/dev/null | wc -l | tr -d ' ')

  symbols=""
  [ "$modified" -gt 0 ] 2>/dev/null && symbols="${symbols}*"
  [ "$untracked" -gt 0 ] 2>/dev/null && symbols="${symbols}?"
  [ "$staged" -gt 0 ] 2>/dev/null && symbols="${symbols}+"
  [ "$ahead" -gt 0 ] 2>/dev/null && symbols="${symbols}⇡${ahead}"
  [ "$behind" -gt 0 ] 2>/dev/null && symbols="${symbols}⇣${behind}"

  git_info=" | 🌱 ${branch}${symbols:+ ${symbols}}"
fi

# Kubernetes context
kube=""
kube_ctx=$(kubectl config current-context 2>/dev/null)
if [ -n "$kube_ctx" ]; then
  kube=" | ⛵ ${kube_ctx}"
fi

# Context usage
ctx_info=""
if [ -n "$ctx_input" ] && [ -n "$ctx_max" ]; then
  used_k=$(echo "$ctx_input" | awk '{printf "%dk", int($1/1000+0.5)}')
  max_k=$(echo "$ctx_max" | awk '{printf "%dk", int($1/1000+0.5)}')
  ctx_info=" | ctx: ${used}% (${used_k}/${max_k})"
elif [ -n "$used" ]; then
  ctx_info=" | ctx: ${used}%"
fi

printf '%s%s%s | %s%s' "$dir" "$git_info" "$kube" "$model" "$ctx_info"
