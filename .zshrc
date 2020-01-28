# If you come from bash you might have to change your $PATH.
# export PATH=$HOME/bin:/usr/local/bin:$PATH

# Path to your oh-my-zsh installation.
export ZSH="${HOME}/.oh-my-zsh"

HISTFILE=~/.histfile
HISTSIZE=10000
SAVEHIST=10000
setopt appendhistory

# Set name of the theme to load --- if set to "random", it will
# load a random theme each time oh-my-zsh is loaded, in which case,
# to know which specific one was loaded, run: echo $RANDOM_THEME
# See https://github.com/robbyrussell/oh-my-zsh/wiki/Themes
# ZSH_THEME="spaceship"

# Set list of themes to pick from when loading at random
# Setting this variable when ZSH_THEME=random will cause zsh to load
# a theme from this variable instead of looking in ~/.oh-my-zsh/themes/
# If set to an empty array, this variable will have no effect.
# ZSH_THEME_RANDOM_CANDIDATES=( "robbyrussell" "agnoster" )

# Uncomment the following line to use case-sensitive completion.
# CASE_SENSITIVE="true"

# Uncomment the following line to use hyphen-insensitive completion.
# Case-sensitive completion must be off. _ and - will be interchangeable.
# HYPHEN_INSENSITIVE="true"

# Uncomment the following line to disable bi-weekly auto-update checks.
# DISABLE_AUTO_UPDATE="true"

# Uncomment the following line to automatically update without prompting.
# DISABLE_UPDATE_PROMPT="true"

# Uncomment the following line to change how often to auto-update (in days).
# export UPDATE_ZSH_DAYS=13

# Uncomment the following line if pasting URLs and other text is messed up.
# DISABLE_MAGIC_FUNCTIONS=true

# Uncomment the following line to disable colors in ls.
# DISABLE_LS_COLORS="true"

# Uncomment the following line to disable auto-setting terminal title.
# DISABLE_AUTO_TITLE="true"

# Uncomment the following line to enable command auto-correction.
# ENABLE_CORRECTION="true"

# Uncomment the following line to display red dots whilst waiting for completion.
# COMPLETION_WAITING_DOTS="true"

# Uncomment the following line if you want to disable marking untracked files
# under VCS as dirty. This makes repository status check for large repositories
# much, much faster.
# DISABLE_UNTRACKED_FILES_DIRTY="true"

# Uncomment the following line if you want to change the command execution time
# stamp shown in the history command output.
# You can set one of the optional three formats:
# "mm/dd/yyyy"|"dd.mm.yyyy"|"yyyy-mm-dd"
# or set a custom format using the strftime function format specifications,
# see 'man strftime' for details.
# HIST_STAMPS="mm/dd/yyyy"

# Would you like to use another custom folder than $ZSH/custom?
# ZSH_CUSTOM=/path/to/new-custom-folder

# Which plugins would you like to load?
# Standard plugins can be found in ~/.oh-my-zsh/plugins/*
# Custom plugins may be added to ~/.oh-my-zsh/custom/plugins/
# Example format: plugins=(rails git textmate ruby lighthouse)
# Add wisely, as too many plugins slow down shell startup.
plugins=(
    git
    vi-mode
    history
    history-substring-search
    z
    zsh-autosuggestions
    forgit
    # zsh-syntax-highlighting
    )

source $ZSH/oh-my-zsh.sh

# User configuration

# export MANPATH="/usr/local/man:$MANPATH"

# You may need to manually set your language environment
# export LANG=en_US.UTF-8

# Preferred editor for local and remote sessions
# if [[ -n $SSH_CONNECTION ]]; then
#   export EDITOR='vim'
# else
#   export EDITOR='mvim'
# fi

# Compilation flags
# export ARCHFLAGS="-arch x86_64"

# Set personal aliases, overriding those provided by oh-my-zsh libs,
# plugins, and themes. Aliases can be placed here, though oh-my-zsh
# users are encouraged to define aliases within the ZSH_CUSTOM folder.
# For a full list of active aliases, run `alias`.
#
# Example aliases
# alias zshconfig="mate ~/.zshrc"
# alias ohmyzsh="mate ~/.oh-my-zsh"

# Aliases
function sk() {
    local org=${1:-ekstep}
    eval $(ssh-agent -s) > /dev/null
    find ~/.cred/${org} -maxdepth 1 -type f -iname "*.pem" -exec ssh-add {} &> /dev/null \;
}

sk

function pr() {

    branch=${1:-$(git rev-parse --abbrev-ref HEAD | cut -d ':' -f2 | cut -d '/' -f2)}
    upstream=${2:-$(git config --get remote.origin.url | awk -F: '{print $NF}' |awk -F/ '{print $(NF-2)}'|cut -d '.' -f1)}
    echo hub pull-request -b $upstream:$branch -h $(git rev-parse --abbrev-ref HEAD | cut -d ':' -f2 | cut -d '/' -f2) -f
    hub pull-request -b $upstream:$branch -h $(git rev-parse --abbrev-ref HEAD | cut -d ':' -f2 | cut -d '/' -f2) -f
}
alias m='mkdir'
alias clea='clear'
alias sk=sk
alias ll='ls -alF'
alias la='ls -A'
alias l='ls -CF'
alias cx='chmod +x'
alias py='function py(){ touch $1;echo -e "#!/usr/bin/env python3\n" >> $1; };py'
alias p='python3'
alias ovp='sudo openvpn --config ~/.cred/sunbird-staging.ovpn --auth-user-pass ~/.cred/ntp/vpn'
alias ovpd='sudo openvpn --config ~/.cred/sunbird-dev.ovpn --auth-user-pass ~/.cred/ntp/vpn'
alias vn='nvim -u ~/.essential.vim -N'
alias vv='/usr/bin/vim'
alias vim='nvim'
alias v='vim'
alias x='xdg-open'
# function vim(){
#     [[ -f Session.vim ]] && nvim -S || nvim -c Obsession $@
# }
alias nvd='nvim -d'
# Tmux alias
alias t='tmux'
alias ta='tmux attach -t $@'
alias tl='tmux ls'
alias tc="tmux new -s $@"
alias tk='tmux kill-session -t'
# git aliases
alias g='git'
alias gb='git branch'
alias gl='git log'
alias ga='git add'
alias gs='git status -sb'
alias gc='git checkout'
alias gpl='git pull --rebase'
alias gplo='git pull --rebase origin $(git rev-parse --abbrev-ref HEAD)'
alias gplr='git pull --rebase rjshrjndrn $(git rev-parse --abbrev-ref HEAD)'
alias gpo='git push origin $(git rev-parse --abbrev-ref HEAD)'
alias gpr='git push rjshrjndrn $(git rev-parse --abbrev-ref HEAD)'
alias gpso='git push --set-upstream origin $(git rev-parse --abbrev-ref HEAD)'
alias gpsr='git push --set-upstream rjshrjndrn $(git rev-parse --abbrev-ref HEAD)'
alias grc='git rebase --continue'
alias grs='git rebase --skip'
alias gst='git stash'
alias gstp='git stash pop'

# hub alias
# Sourcing hub for git
eval "$(hub alias -s)"
alias at='docker run --rm -it -v $(pwd):/work -w /work -urajeshr ansible_ubuntu:16.04 bash'
# simple git todo
gt() {
  git commit --allow-empty -m "TODO: $*"
}

glt() {
  git log --grep=TODO: --oneline
}

#shell alias
alias cl='clear'
alias ssh='ssh -A'
# skiping knownkeys saving
alias nssh='ssh -o "UserKnownHostsFile /dev/null" -o "StrictHostKeyChecking false"'
alias nscp='scp -o "UserKnownHostsFile /dev/null" -o "StrictHostKeyChecking false"'

nmosh(){
    mosh --ssh='ssh -o "UserKnownHostsFile /dev/null" -o "StrictHostKeyChecking false"' -p 60001 $1
}

jt(){
    nvim $1**
}
nsr(){
    nssh rajeshr@$1
}
nsu(){
    nssh ubuntu@$1
}
# ansible aliases
alias ap='ansible-playbook'
alias apc="ansible-playbook -i $2 $1 --syntax-check -e 'hosts=dummy'"
alias apn='ansible-playbook -i ntp_preprod_inventory/env/ --vault-password-file=ntp_preprod_inventory/pass_file  -e ansible_ssh_user=rajeshr'

alias c="setxkbmap -option caps:escape"
alias yay="yay --sudoloop"
# Docker
alias d='docker'
alias k='kubectl'
alias kg='kubectl get'
alias kga='kubectl get all'
alias kgaa='kubectl get all --all-namespaces'
alias ka='kubectl apply -f'
alias kd='kubectl describe'
alias kdl='kubectl delete'
alias ke='kubectl edit'
alias kl='kubectl logs'
alias kex='kubectl exec'
alias kx='kubectx'
alias kn='kubens'
alias knc='kubens -c'
alias kc='kubectl create'

alias h3='helm'

# Window manager
alias a='wmctrl -a'
# Exporting vars
#export GOROOT=~/go
export GOPATH=~/go_code
#export GOBIN=$GOPATH/bin
#export PATH=$PATH:$GOROOT/bin:$GOPATH:$GOBIN

# history substring search
bindkey -M vicmd 'k' history-substring-search-up
bindkey -M vicmd 'j' history-substring-search-down

# Auto accept suggestion
bindkey '^n' autosuggest-accept

# Custom applications
# All applications are configured in ~/apps
# and binaries linked to ~/apps/bin

export VISUAL=nvim
export EDITOR=nvim
export PATH=$PATH:~/apps/bin:~/go_code/bin

[ -f ~/.fzf.zsh ] && source ~/.fzf.zsh
if [ /home/rajeshr/apps/bin/kubectl ]; then source <(kubectl completion zsh); fi
# xinput disable 9
source <(stern --completion=zsh)
source <(helm completion zsh)
source <(linkerd completion zsh)
# [[ $(xmodmap -pk | grep Caps | awk '{ print $1 }') -ne 9 ]] && setxkbmap -option caps:escape

##### Tmux functions #####

# tm - create new tmux session, or switch to existing one. Works from within tmux too. (@bag-man)
# `tm` will allow you to select your tmux session via fzf.
# `tm irc` will attach to the irc session (if it exists), else it will create it.

tm() {
  [[ -n "$TMUX" ]] && change="switch-client" || change="attach-session"
  if [ $1 ]; then
    tmux $change -t "$1" 2>/dev/null || (tmux new-session -d -s $1 && tmux $change -t "$1"); return
  fi
  session=$(tmux list-sessions -F "#{session_name}" 2>/dev/null | fzf --exit-0) &&  tmux $change -t "$session" || echo "No sessions found."
}

# fs [FUZZY PATTERN] - Select selected tmux session
#   - Bypass fuzzy finder if there's only one match (--select-1)
#   - Exit if there's no match (--exit-0)
fs() {
  local session
  session=$(tmux list-sessions -F "#{session_name}" | \
    fzf --query="$1" --select-1 --exit-0) &&
  tmux switch-client -t "$session"
}

# ftpane - switch pane (@george-b)
ftpane() {
  local panes current_window current_pane target target_window target_pane
  panes=$(tmux list-panes -s -F '#I:#P - #{pane_current_path} #{pane_current_command}')
  current_pane=$(tmux display-message -p '#I:#P')
  current_window=$(tmux display-message -p '#I')

  target=$(echo "$panes" | grep -v "$current_pane" | fzf +m --reverse) || return

  target_window=$(echo $target | awk 'BEGIN{FS=":|-"} {print$1}')
  target_pane=$(echo $target | awk 'BEGIN{FS=":|-"} {print$2}' | cut -c 1)

  if [[ $current_window -eq $target_window ]]; then
    tmux select-pane -t ${target_window}.${target_pane}
  else
    tmux select-pane -t ${target_window}.${target_pane} &&
    tmux select-window -t $target_window
  fi
}

# bare git for dot files
alias config='/usr/bin/git --git-dir=$HOME/dotfiles/ --work-tree=$HOME'
# Command to hide all other files
# config config --local status.showUntrackedFiles no
export PATH=$PATH:~/.kube/plugins/jordanwilson230
# Starship config
eval "$(starship init zsh)"

