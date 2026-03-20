export EDITOR=nvim
# export TERM=screen-256color
export PATH=/opt/homebrew/bin:$PATH:~/apps/bin:${HOME}/.krew/bin:${HOME}/.local/bin:${HOME}/go/bin:/var/lib/flatpak/exports/bin/:~/apps/flutter/bin:~/apps/android-studio/bin:~/go/bin/

[[ $(command -v brew) ]] && {
    export PATH="$(brew --prefix)/opt/gnu-tar/libexec/gnubin:$PATH"
}
export HOMEBREW_NO_AUTO_UPDATE=1
export FZF_COMPLETION_TRIGGER="cc"
# export XDG_DATA_DIRS=${HOME}/.nix-profile/share:$XDG_DATA_DIRS
# This is for nix gui packages. Especially zoom
# Ref: https://github.com/NixOS/nixpkgs/issues/82959#issuecomment-657306112
# export QT_XCB_GL_INTEGRATION=none

# For nix locale
# Ref: https://github.com/NixOS/nix/issues/599#issuecomment-130359048
export LOCALE_ARCHIVE=/usr/lib/locale/locale-archive

# export SSH_AUTH_SOCK=~/.var/app/com.bitwarden.desktop/data/.bitwarden-ssh-agent.sock
export MANPAGER="nvim +Man!"

export LC_ALL=C.UTF-8
export LANG=C.UTF-8
# export LANG="en_US.UTF-8"

export REGISTRY_AUTH_FILE=~/.docker/config.json
# enable k9s node shell
export K9S_FEATURE_GATE_NODE_SHELL=true

source "${HOME}/.shell.sh"

# tmux has ghostty issue
if [[ "$TERM_PROGRAM" == "ghostty" ]]; then
    export TERM=xterm-256color
fi

export OPENCODE_EXPERIMENTAL_LSP_TOOL=true

# for macos config path
export XDG_CONFIG_HOME="$HOME/.config"
