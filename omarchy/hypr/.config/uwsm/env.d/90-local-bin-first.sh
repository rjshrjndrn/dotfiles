# Prepend ~/.local/bin ahead of system paths for the uwsm graphical session.
#
# env-bootstrap (10-omarchy) deliberately APPENDS ~/.local/bin so system
# binaries win. We need the opposite for a few user shims (e.g.
# omarchy-brightness-keyboard) to shadow the packaged /usr/bin copies.
#
# uwsm sources ~/.config/uwsm/env.d/* after /usr/share/uwsm/env.d/*, so this
# prepend takes effect last. Requires a session restart to apply.
export PATH="$HOME/.local/bin:$PATH"
