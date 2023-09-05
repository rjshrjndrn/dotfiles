export EDITOR=nvim
# export TERM=screen-256color
export PATH=$PATH:~/apps/bin:${HOME}/.krew/bin:${HOME}/.local/bin:${HOME}/go/bin:/var/lib/flatpak/exports/bin/
export FZF_COMPLETION_TRIGGER="cc"
# export XDG_DATA_DIRS=${HOME}/.nix-profile/share:$XDG_DATA_DIRS
# This is for nix gui packages. Especially zoom
# Ref: https://github.com/NixOS/nixpkgs/issues/82959#issuecomment-657306112
# export QT_XCB_GL_INTEGRATION=none
# For nix locale
# Ref: https://github.com/NixOS/nix/issues/599#issuecomment-130359048
export LOCALE_ARCHIVE=/usr/lib/locale/locale-archive
