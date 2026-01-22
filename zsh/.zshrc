export ZSH="$HOME/.oh-my-zsh"
HISTFILE=~/.histfile
HISTSIZE=10000
SAVEHIST=10000
setopt HIST_IGNORE_ALL_DUPS
setopt HIST_IGNORE_SPACE
setopt appendhistory
eval "$(~/.local/bin/mise activate zsh)"
ZSH_THEME="robbyrussell"
plugins=(
    git
    history-substring-search
    z
    zsh-autosuggestions
    fzf-tab
    )
source $ZSH/oh-my-zsh.sh
source ~/.aliases
source ~/.key_bindings.sh
source ~/.exports.sh
eval "$(starship init zsh)"
eval "$(direnv hook zsh)"
[ -f ~/.fzf.zsh ] && source ~/.fzf.zsh

autoload -U +X bashcompinit && bashcompinit
# Bind ctrl-r but not up arrow
eval "$(atuin init zsh --disable-up-arrow)"

# Scaleway CLI autocomplete initialization.
eval "$(scw autocomplete script shell=zsh)"
eval "$(mise completion zsh)"

# manual completions
source ~/.completions.sh

# bun completions
[ -s "/home/skyline/.bun/_bun" ] && source "/home/skyline/.bun/_bun"

# bun
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
