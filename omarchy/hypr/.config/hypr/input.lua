-- Control your input devices.
-- https://wiki.hypr.land/Configuring/Basics/Variables/#input

hl.config({
  input = {
    kb_layout = "us",
    kb_options = "compose:caps",

    -- Change speed of keyboard repeat.
    repeat_rate = 40,
    repeat_delay = 600,

    -- Start with numlock on by default.
    numlock_by_default = true,

    -- Natural scroll for mouse (reverse scroll direction).
    natural_scroll = true,

    touchpad = {
      -- Use natural (inverse) scrolling.
      natural_scroll = true,
      -- Control the speed of your scrolling.
      scroll_factor = 0.4,
      -- Disable the touchpad while typing.
      disable_while_typing = true,
    },
  },
})

-- Scroll nicely in the terminal.
o.window("(Alacritty|kitty)", { scroll_touchpad = 1.5 })
o.window("com.mitchellh.ghostty", { scroll_touchpad = 0.2 })

-- Enable touchpad gestures for changing workspaces.
hl.gesture({ fingers = 3, direction = "horizontal", action = "workspace" })
