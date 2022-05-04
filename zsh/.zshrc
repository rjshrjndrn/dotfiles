if [ -e ~/.nix-profile/etc/profile.d/nix.sh ]; then . ~/.nix-profile/etc/profile.d/nix.sh; fi # added by Nix installer
source ~/aliases
source ~/.zsh_plugins.sh
eval "$(starship init zsh)"
