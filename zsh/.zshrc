if [ -e ~/.nix-profile/etc/profile.d/nix.sh ]; then . ~/.nix-profile/etc/profile.d/nix.sh; fi # added by Nix installer

autoload -Uz compinit
compinit

source ~/aliases
source ~/.zsh_plugins.sh

eval "$(starship init zsh)"
