-- See https://wiki.hypr.land/Configuring/Basics/Monitors/
-- List current monitors and supported resolutions with: hyprctl monitors all
--
-- Optimized for retina-class 2x displays, like 13" 2.8K, 27" 5K, 32" 6K.

hl.env("GDK_SCALE", "2")

-- LG Ultrafine 4K - left side (enumerates as HDMI-A-1 or DP-1 depending on port).
hl.monitor({ output = "HDMI-A-1", mode = "3840x2160@60", position = "0x0", scale = 2 })
hl.monitor({ output = "DP-1", mode = "3840x2160@60", position = "0x0", scale = 2 })

-- Laptop - right of LG, vertically centered.
hl.monitor({ output = "eDP-1", mode = "2880x1800@120", position = "1920x90", scale = 2, vrr = 1 })

-- Workspace assignments - LG (DP-1) as primary.
hl.workspace_rule({ workspace = "1", monitor = "DP-1", default = true })
hl.workspace_rule({ workspace = "2", monitor = "DP-1" })
hl.workspace_rule({ workspace = "3", monitor = "DP-1" })
hl.workspace_rule({ workspace = "4", monitor = "DP-1" })
hl.workspace_rule({ workspace = "5", monitor = "DP-1", default = true })
hl.workspace_rule({ workspace = "6", monitor = "eDP-1" })

-- Fallback for any other monitor.
hl.monitor({ output = "", mode = "preferred", position = "auto", scale = "auto" })
