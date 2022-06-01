if [ -e ~/.nix-profile/etc/profile.d/nix.sh ]; then . ~/.nix-profile/etc/profile.d/nix.sh; fi # added by Nix installer
export ZSH="$HOME/.oh-my-zsh"
HISTFILE=~/.histfile
HISTSIZE=10000
SAVEHIST=10000
setopt appendhistory
ZSH_THEME="robbyrussell"
plugins=(git
    history-substring-search
    z
    zsh-autosuggestions
    )
source $ZSH/oh-my-zsh.sh
source ~/aliases
source ~/.completions.sh
source ~/.key_bindings.sh
source ~/.exports.sh
eval "$(starship init zsh)"
[ -f ~/.fzf.zsh ] && source ~/.fzf.zsh
