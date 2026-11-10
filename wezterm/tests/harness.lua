-- Test harness: the real config plus a hook that lets a pane fire any binding.
-- A pane emits user var TEST_KEY="<table> <mods> <key>" (table = keys | <key_table name>);
-- the matching binding's action runs on that pane, the result is logged to $HOME/out.
local wezterm = require("wezterm")
local config = dofile(os.getenv("WEZ_REAL_CONFIG"))

local function find(entries, key, mods)
	for _, e in ipairs(entries or {}) do
		if e.key == key and (e.mods or "NONE") == mods then
			return e.action
		end
	end
end

wezterm.on("user-var-changed", function(window, pane, name, value)
	if name ~= "TEST_KEY" then
		return
	end
	-- trailing " #tag" makes each event unique so fire.sh can wait for its ack
	local tbl, mods, key = value:match("^(%S+) (%S+) (.-) #%S+$")
	local entries = tbl == "keys" and config.keys or (config.key_tables or {})[tbl]
	local action = tbl ~= "probe" and find(entries, key, mods)
	if action then
		pane:activate() -- real keys always come from the focused pane
		window:perform_action(action, pane)
	end
	-- the GUI's own focus view; `cli list` is_active lags and flaps under the mux client
	local active = window:active_pane():pane_id()
	local f = io.open(os.getenv("HOME") .. "/out", "a")
	f:write(value .. " -> " .. (action and "ok" or "missing") .. " from=" .. pane:pane_id() .. " active=" .. active .. " title=" .. pane:get_title() .. "\n")
	f:close()
end)

return config
