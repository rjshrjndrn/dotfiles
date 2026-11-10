local wezterm = require("wezterm")
local mux = wezterm.mux
local act = wezterm.action

-- gui-startup does not fire on `connect`; gui-attached does.
wezterm.on("gui-attached", function()
	local workspace = mux.get_active_workspace()
	for _, window in ipairs(mux.all_windows()) do
		if window:get_workspace() == workspace then
			window:gui_window():maximize()
		end
	end
end)

local config = {
	hide_tab_bar_if_only_one_tab = true,
	window_padding = {
		left = 0,
		right = 0,
		top = 0,
		bottom = 0,
	},
	-- window_decorations = "NONE",
	-- window_decorations = "RESIZE",
	color_scheme = "Gogh (Gogh)",
	-- color_scheme = "Darkside",
	window_background_opacity = 1,
	audible_bell = "Disabled",
	-- text_background_opacity = .3,
	-- Don't use keyboard interruption
	use_ime = false,
	font_size = 16,
	-- tmux-like persistence: panes live in wezterm-mux-server and survive GUI crashes.
	unix_domains = { { name = "unix" } },
	default_gui_startup_args = { "connect", "unix" },
}

-- wezterm ls-fonts --list-system | grep -i jet

config.font = wezterm.font_with_fallback({
	{
		family = "JetBrains Mono",
		-- family = "Iosevka",
		-- weight = "Medium",
		style = "Italic",
		weight = "Medium",
		stretch = "Normal",
		italic = true,
	},
	{ family = "Terminus", weight = "Bold" },
	"Noto Color Emoji",
})

-- tmux-like keymap: leader C-f, same keys as tmux/.tmux.conf. Reference: wezterm/AGENTS.md
config.leader = { key = "f", mods = "CTRL", timeout_milliseconds = 1000 }

-- tmux `switch-client -l`: remember the previously active workspace
wezterm.on("update-status", function(window)
	local ws = window:active_workspace()
	if wezterm.GLOBAL.cur_ws ~= ws then
		wezterm.GLOBAL.prev_ws = wezterm.GLOBAL.cur_ws
		wezterm.GLOBAL.cur_ws = ws
	end
end)

local function prompt(description, fn)
	return act.PromptInputLine({
		description = description,
		action = wezterm.action_callback(function(window, pane, line)
			if line and line ~= "" then
				fn(window, pane, line)
			end
		end),
	})
end

local split_h = act.SplitHorizontal({ domain = "CurrentPaneDomain" })
local split_v = act.SplitVertical({ domain = "CurrentPaneDomain" })
local tabs = act.ShowLauncherArgs({ flags = "FUZZY|TABS" })
local workspaces = act.ShowLauncherArgs({ flags = "FUZZY|WORKSPACES" })

local function resize(dir)
	return act.Multiple({
		act.AdjustPaneSize({ dir, 5 }),
		act.ActivateKeyTable({ name = "resize", one_shot = false, timeout_milliseconds = 500 }),
	})
end

-- {key, action} pairs under LEADER
local leader_keys = {
	{ "\\", split_h },
	{ "-", split_v },
	{ "LeftArrow", act.ActivatePaneDirection("Left") },
	{ "RightArrow", act.ActivatePaneDirection("Right") },
	{ "UpArrow", act.ActivatePaneDirection("Up") },
	{ "DownArrow", act.ActivatePaneDirection("Down") },
	{ "o", act.ActivatePaneDirection("Next") },
	{ "q", act.PaneSelect },
	{ "z", act.TogglePaneZoomState },
	{ "x", act.CloseCurrentPane({ confirm = true }) },
	{ "c", act.SpawnTab("CurrentPaneDomain") },
	{ ",", prompt("Rename window", function(window, _, line)
		window:active_tab():set_title(line)
	end) },
	{ "n", act.ActivateTabRelative(1) },
	{ "p", act.ActivateTabRelative(-1) },
	{ "l", act.ActivateLastTab },
	{ "f", tabs },
	{ "w", tabs },
	{ ";", wezterm.action_callback(function(window, pane)
		for _, tab in ipairs(window:mux_window():tabs()) do
			if tab:get_title() == "notes" then
				return tab:activate()
			end
		end
		local tab = window:mux_window():spawn_tab({})
		tab:set_title("notes")
	end) },
	{ "s", workspaces },
	{ "'", wezterm.action_callback(function(window, pane)
		local prev = wezterm.GLOBAL.prev_ws
		if prev then
			window:perform_action(act.SwitchToWorkspace({ name = prev }), pane)
		end
	end) },
	{ "d", act.DetachDomain("CurrentPaneDomain") },
	{ "v", act.ActivateCopyMode },
	{ "[", act.ActivateCopyMode },
	{ "]", act.PasteFrom("Clipboard") },
	-- tmux-open replacement: pick a URL on screen and open it
	{ "u", act.QuickSelectArgs({
		label = "open url",
		patterns = { "https?://\\S+" },
		action = wezterm.action_callback(function(window, pane)
			wezterm.open_with(window:get_selection_text_for_pane(pane))
		end),
	}) },
	{ "r", act.ReloadConfiguration },
	{ "H", resize("Left") },
	{ "J", resize("Down") },
	{ "K", resize("Up") },
	{ "L", resize("Right") },
	{ "C", prompt("New window name", function(window, _, line)
		local tab = window:mux_window():spawn_tab({})
		tab:set_title(line)
	end) },
	{ "S", prompt("New session name", function(window, pane, line)
		window:perform_action(act.SwitchToWorkspace({ name = line }), pane)
	end) },
	{ "F", workspaces },
}

-- shifted punctuation may arrive with or without SHIFT, so bind both.
-- Uppercase letters need no twin: wezterm folds SHIFT+H into H.
local leader_shifted = {
	{ "%", split_h },
	{ '"', split_v },
	{ "!", wezterm.action_callback(function(_, pane)
		pane:move_to_new_tab()
	end) },
	{ "&", act.CloseCurrentTab({ confirm = true }) },
	{ "$", prompt("Rename session", function(_, _, line)
		mux.rename_workspace(mux.get_active_workspace(), line)
	end) },
	{ ":", act.ActivateCommandPalette },
}

config.keys = {
	{ key = "f", mods = "LEADER|CTRL", action = act.SendKey({ key = "f", mods = "CTRL" }) },
}
for _, k in ipairs(leader_keys) do
	table.insert(config.keys, { key = k[1], mods = "LEADER", action = k[2] })
end
for _, k in ipairs(leader_shifted) do
	table.insert(config.keys, { key = k[1], mods = "LEADER", action = k[2] })
	table.insert(config.keys, { key = k[1], mods = "LEADER|SHIFT", action = k[2] })
end
for i = 1, 9 do
	table.insert(config.keys, { key = tostring(i), mods = "LEADER", action = act.ActivateTab(i - 1) })
end

-- C-h/j/k/l like vim-tmux-navigator: move between panes, but leave the key to vim.
-- Mux panes report no foreground process, so the title is the only vim signal.
local function is_vim(pane)
	local t = pane:get_title():lower()
	return t:find("^n?vim$") or t:find("^n?vim ") or t:find("%- n?vim$")
end
for key, dir in pairs({ h = "Left", j = "Down", k = "Up", l = "Right" }) do
	table.insert(config.keys, {
		key = key,
		mods = "CTRL",
		action = wezterm.action_callback(function(window, pane)
			if is_vim(pane) then
				window:perform_action(act.SendKey({ key = key, mods = "CTRL" }), pane)
			else
				window:perform_action(act.ActivatePaneDirection(dir), pane)
			end
		end),
	})
end

config.key_tables = { resize = { { key = "Escape", action = "PopKeyTable" } } }
for key, dir in pairs({ H = "Left", J = "Down", K = "Up", L = "Right" }) do
	table.insert(config.key_tables.resize, { key = key, action = act.AdjustPaneSize({ dir, 5 }) })
end

for i = 1, 8 do
	-- CTRL+ALT + number to activate that tab
	table.insert(config.keys, {
		key = tostring(i),
		-- mods = 'CTRL|ALT',
		mods = "ALT",
		action = act.ActivateTab(i - 1),
	})
end

return config
