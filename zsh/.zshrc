if [ -e ~/.nix-profile/etc/profile.d/nix.sh ]; then . ~/.nix-profile/etc/profile.d/nix.sh; fi # added by Nix installer
export ZSH="$HOME/.oh-my-zsh"

plugins=(
    git
    vi-mode
    history
    history-substring-search
    z
    zsh-autosuggestions
    # forgit
    terraform
    # pulumi
    lxd
    fzf
    # zsh-syntax-highlighting
    )

source $ZSH/oh-my-zsh.sh

source ~/aliases
source ~/.completions.sh
source ~/.key_bindings.sh
eval "$(starship init zsh)"

[ -f ~/.fzf.zsh ] && source ~/.fzf.zsh
