-- Change the default Omarchy look'n'feel.

hl.config({
  general = {
    -- Change to niri-like side-scrolling layout.
    layout = "scrolling",
  },

  animations = {
    -- Disable all animations.
    enabled = false,
  },

  scrolling = {
    -- Don't auto-expand single column to full screen.
    fullscreen_on_one_column = false,
    -- Default new column width.
    column_width = 0.667,
    -- Preset widths for SUPER+M / SUPER+SHIFT+M cycling.
    explicit_column_widths = "0.667, 1.0",
    -- Center focused column in viewport (0 = center, 1 = fit).
    focus_fit_method = 0,
  },
})
