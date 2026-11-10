# wezterm (tmux replacement)

Goal: replace local tmux with wezterm and keep tmux muscle memory.
tmux config being replaced: `tmux/.tmux.conf`.

```
 wezterm GUI ──unix socket──▶ wezterm-mux-server ──▶ shells
 (renders, keys)              (owns panes; survives GUI crash/kill -9)
```

- Plain `wezterm` connects to the `unix` domain (`default_gui_startup_args`).
  `wezterm start` bypasses the mux. Launch only plain `wezterm`.
- If the mux server dies, every pane dies too (same as the tmux server).
- `gui-startup` never fires on `connect`, so window setup lives in `gui-attached`.
- Build: `wezterm@nightly` cask. The last stable tag is from 2024-02. The GUI
  and mux server versions must match, so restart the mux after upgrading
  (`wezterm cli list-clients`, then kill `wezterm-mux-server`).

## Layout

| Path | What |
|---|---|
| `.config/wezterm/wezterm.lua` | config, stowed to `~/.config/wezterm` |
| `tests/test_mux.sh` | processes survive GUI `kill -9`, GUI reattaches. Uses a throwaway HOME. |
| `tests/test_keys.sh` | keymap spec, asserted against `wezterm show-keys --lua` |
| `.stow-local-ignore` | keeps `tests/` and these docs out of `$HOME` |

Run: `make wezterm-test` from the repo root. TDD: change the test first, see it fail, then edit the config.

## Keymap (leader = `C-f`, 1s timeout)

| Keys | Action | tmux equivalent |
|---|---|---|
| `C-f C-f` | send `C-f` to the program | send-prefix |
| `\` `%` | split right (cwd kept by domain) | split-window -h |
| `-` `"` | split down | split-window -v |
| arrows | move between panes | select-pane |
| `o` / `q` | next pane / pick a pane by label | |
| `H J K L` | resize by 5; repeat within 500ms keeps resizing, `Esc` exits | `bind -r` resize-pane |
| `z` | zoom | resize-pane -Z |
| `x` / `&` | close pane / tab (confirm) | kill-pane / kill-window |
| `!` | move pane to a new tab | break-pane |
| `c` / `C` | new tab / new tab with a name prompt | new-window |
| `,` | rename tab | rename-window |
| `n` `p` `l` `1-9` | next / previous / last / by number | |
| `f` `w` | fuzzy tab picker | fzf window picker |
| `;` | focus or create the tab titled `notes` | notes window |
| `S` | new workspace with a name prompt | new-session |
| `F` `s` | fuzzy workspace picker | fzf session picker |
| `$` | rename workspace | rename-session |
| `'` | previous workspace (tracked in `update-status`) | switch-client -l |
| `d` | detach the GUI (panes keep running) | detach |
| `v` `[` | copy mode (vi keys; `v` select, `y` copy to clipboard) | copy-mode |
| `]` | paste from the clipboard | paste-buffer |
| `u` | quick-select a URL and open it | tmux-open |
| `r` | reload config | source-file |
| `:` | command palette | command-prompt |

Kept from before: `ALT+1..8` switches tabs. Mouse selection and scrollback are native.

## Gotchas found while testing

- `show-keys --lua` prints some actions with parentheses (`ActivateTab(0)`) and some with a space (`SpawnTab 'CurrentPaneDomain'`, `ActivatePaneDirection 'Left'`). Copy the exact text from the output when adding a test row.
- Uppercase letters with SHIFT fold into one entry, so bind them once. Shifted punctuation is bound with and without SHIFT.
- `action_callback` actions only appear as `EmitEvent 'user-defined-N'`, so their behaviour isn't covered by the tests. Check them by hand after editing: `;` `'` `C` `S` `$` `!` `u`.
- `wezterm cli list` shows pane titles, not commands. Match on `pane_id` from `cli list --format json`.

## Not done yet (planned order)

1. Navigation shared with nvim on `C-h/j/k/l` (`smart-splits.nvim`; replaces vim-tmux-navigator).
2. Status bar: kube context and pomodoro (`P` toggle, `_` cancel), via `update-status` and `window:set_right_status`.
3. `resurrect.wezterm` with periodic saves (replaces tmux-resurrect and continuum).
4. Synchronize panes (tmux `a`) has no native equivalent and is skipped for now.

tmux stays installed and is still used on remote servers.
