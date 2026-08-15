-- Personal keybindings. Ported from the pre-quattro bindings.conf.
--
-- Omarchy loads its default binds first, so any combo we reuse must be
-- unbound before we rebind it or BOTH fire. rebind() does exactly that.

local function rebind(keys, description, dispatcher)
  hl.unbind(keys)
  o.bind(keys, description, dispatcher)
end

-- Alt+Tab toggles between the two most recent workspaces.
hl.config({
  binds = {
    workspace_back_and_forth = true,
  },
})
rebind("ALT + TAB", "Toggle recent workspace", hl.dsp.focus({ workspace = "previous" }))

-- Focus windows with vim keys.
rebind("SUPER + H", "Focus prev", hl.dsp.window.cycle_next({ next = false }))
rebind("SUPER + J", "Focus down", hl.dsp.focus({ direction = "d" }))
rebind("SUPER + K", "Focus up", hl.dsp.focus({ direction = "u" }))
rebind("SUPER + L", "Focus next", hl.dsp.window.cycle_next())

-- Move/stack windows in scrolling layout (h/l = columns, j/k = stack vertically).
rebind("SUPER + SHIFT + H", "Move window left", hl.dsp.window.swap({ direction = "l" }))
rebind("SUPER + SHIFT + J", "Move window down", hl.dsp.window.swap({ direction = "d" }))
rebind("SUPER + SHIFT + K", "Move window up", hl.dsp.window.swap({ direction = "u" }))
rebind("SUPER + SHIFT + L", "Move window right", hl.dsp.window.swap({ direction = "r" }))

-- Promote stacked window into its own column.
rebind("SUPER + P", "Promote window to new column", hl.dsp.layout("promote"))

-- Cycle column width (centers focused column in viewport).
rebind("SUPER + M", "Grow column width", hl.dsp.layout("colresize +conf"))
rebind("SUPER + SHIFT + M", "Shrink column width", hl.dsp.layout("colresize -conf"))

-- Quick workspace switching.
rebind("SUPER + A", "Workspace 1", hl.dsp.focus({ workspace = 1 }))
rebind("SUPER + S", "Workspace 2", hl.dsp.focus({ workspace = 2 }))
rebind("SUPER + D", "Workspace 3", hl.dsp.focus({ workspace = 3 }))
rebind("SUPER + F", "Workspace 4", hl.dsp.focus({ workspace = 4 }))

-- Auto-assign apps to workspaces.
o.window("kitty", { workspace = "1" })
o.window("slack", { workspace = "2" })
o.window("zen", { workspace = "4" })
o.window("org.telegram.desktop", { float = true, size = { 380, 519 } })
o.window("signal", { float = true, size = { 562, 654 } })

-- Omarchy menu on CTRL+SHIFT+SPACE (drop the default SUPER+ALT+SPACE).
hl.unbind("SUPER + ALT + SPACE")
rebind("CTRL + SHIFT + SPACE", "Omarchy menu", "omarchy-menu")

-- Application bindings.
rebind("SUPER + RETURN", "Terminal", 'uwsm-app -- xdg-terminal-exec --dir="$(omarchy-cmd-terminal-cwd)"')
rebind("SUPER + ALT + RETURN", "Tmux", 'uwsm-app -- xdg-terminal-exec --dir="$(omarchy-cmd-terminal-cwd)" bash -c "tmux attach || tmux new -s Work"')
rebind("SUPER + SHIFT + RETURN", "Browser", "omarchy-launch-browser")
rebind("SUPER + SHIFT + F", "File manager", "uwsm-app -- nautilus --new-window")
rebind("SUPER + ALT + SHIFT + F", "File manager (cwd)", 'uwsm-app -- nautilus --new-window "$(omarchy-cmd-terminal-cwd)"')
rebind("SUPER + SHIFT + B", "Browser", "omarchy-launch-browser")
rebind("SUPER + SHIFT + ALT + B", "Browser (private)", "omarchy-launch-browser --private")
rebind("SUPER + SHIFT + N", "Editor", "omarchy-launch-editor")
rebind("SUPER + SHIFT + D", "Docker", "omarchy-launch-tui lazydocker")
rebind("SUPER + SHIFT + G", "Signal", 'omarchy-launch-or-focus ^signal$ "uwsm-app -- signal-desktop"')
rebind("SUPER + SHIFT + O", "Obsidian", 'omarchy-launch-or-focus ^obsidian$ "uwsm-app -- obsidian"')
rebind("SUPER + SHIFT + W", "Typora", "uwsm-app -- typora --enable-wayland-ime")
rebind("SUPER + SHIFT + SLASH", "Passwords", "uwsm-app -- 1password")

-- Web apps.
rebind("SUPER + SHIFT + A", "ChatGPT", 'omarchy-launch-webapp "https://chatgpt.com"')
rebind("SUPER + SHIFT + T", "Kill Telegram", "pkill -f Telegram")
rebind("SUPER + SHIFT + ALT + A", "Grok", 'omarchy-launch-webapp "https://grok.com"')
rebind("SUPER + SHIFT + C", "Screenshot", "omarchy-capture-screenshot")
rebind("SUPER + SHIFT + E", "Email", 'omarchy-launch-webapp "https://app.hey.com"')
rebind("SUPER + SHIFT + Y", "YouTube", 'omarchy-launch-webapp "https://youtube.com/"')
rebind("SUPER + SHIFT + ALT + G", "WhatsApp", 'omarchy-launch-or-focus-webapp WhatsApp "https://web.whatsapp.com/"')
rebind("SUPER + SHIFT + CTRL + G", "Google Messages", 'omarchy-launch-or-focus-webapp "Google Messages" "https://messages.google.com/web/conversations"')
rebind("SUPER + SHIFT + P", "Google Photos", 'omarchy-launch-or-focus-webapp "Google Photos" "https://photos.google.com/"')
rebind("SUPER + SHIFT + X", "X", 'omarchy-launch-webapp "https://x.com/"')
rebind("SUPER + SHIFT + ALT + X", "X Post", 'omarchy-launch-webapp "https://x.com/compose/post"')
