if [ -e ~/.nix-profile/etc/profile.d/nix.sh ]; then . ~/.nix-profile/etc/profile.d/nix.sh; fi # added by Nix installer
export ZSH="$HOME/.oh-my-zsh"
HISTFILE=~/.histfile
HISTSIZE=10000
SAVEHIST=10000
setopt HIST_IGNORE_ALL_DUPS
setopt HIST_IGNORE_SPACE
setopt appendhistory
ZSH_THEME="robbyrussell"
plugins=(git
    history-substring-search
    z
    zsh-autosuggestions
    )
source $ZSH/oh-my-zsh.sh
source ~/.aliases
source ~/.key_bindings.sh
source ~/.exports.sh
source ~/.completions.sh
eval "$(starship init zsh)"
eval "$(direnv hook zsh)"
[ -f ~/.fzf.zsh ] && source ~/.fzf.zsh

autoload -U +X bashcompinit && bashcompinit
# Bind ctrl-r but not up arrow
# eval "$(atuin init zsh --disable-up-arrow)"
