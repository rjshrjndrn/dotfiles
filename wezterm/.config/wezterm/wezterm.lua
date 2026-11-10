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
