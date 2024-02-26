local wezterm = require("wezterm")
local mux = wezterm.mux
local act = wezterm.action

wezterm.on("gui-startup", function()
	local _, pane, window = mux.spawn_window({})
	window:gui_window():maximize()
end)

local config = {
	hide_tab_bar_if_only_one_tab = true,
	window_padding = {
		left = 0,
		right = 0,
		top = 0,
		bottom = 0,
	},
	window_decorations = "NONE",
	-- window_decorations = "RESIZE",
	color_scheme = "Gogh (Gogh)",
	-- color_scheme = "Darkside",
	window_background_opacity = 0.95,
	audible_bell = "Disabled",
	-- text_background_opacity = .3,
	-- Don't use keyboard interruption
	use_ime = false,
}

config.keys = {}
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
