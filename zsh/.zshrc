if [ -e ~/.nix-profile/etc/profile.d/nix.sh ]; then . ~/.nix-profile/etc/profile.d/nix.sh; fi # added by Nix installer

HISTFILE=~/.histfile
HISTSIZE=10000
SAVEHIST=10000
setopt appendhistory
setopt completealiases

source ~/aliases
source ~/.antigen_plugins.sh
source ~/.completions.sh

eval "$(starship init zsh)"
