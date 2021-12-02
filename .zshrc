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
    terraform
    pulumi
    lxd
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

## Loading plugins
# To install zplug
# curl -sL --proto-redir -all,https https://raw.githubusercontent.com/zplug/installer/master/installer.zsh | zsh
source ~/.zplug/init.zsh
zplug "changyuheng/fz", defer:1
zplug "rupa/z", use:z.sh
zplug "zsh-users/zsh-completions"
zplug load
# Aliases
function sk() {
    local org=${1:-ekstep}
    eval $(ssh-agent -s) > /dev/null
    find ~/.cred/${org} -maxdepth 1 -type f -iname "*.pem" -exec ssh-add {} &> /dev/null \;
}

sk

function k3c() {
    k3d create cluster $1 --k3s-server-arg --no-deploy --k3s-server-arg traefik --network kubelocal --k3s-server-arg --no-deploy --k3s-server-arg local-storage --k3s-server-arg --kubelet-arg --k3s-server-arg containerd=/run/k3s/containerd/containerd.sock --api-port ${2:-16433}  --image rancher/k3s:v1.0.1
}
function k3g() {
    k3d kubeconfig get $1 -o ~/.k3d/kube/$1
    sleep .5
    export KUBECONFIG=~/.k3d/kube/$1
}

function pr() {
    opts=$1
    branch=${2:-$(git rev-parse --abbrev-ref HEAD | cut -d ':' -f2 | cut -d '/' -f2)}
    # upstream=${3:-$(git config --get remote.origin.url | awk -F: '{print $NF}' |awk -F/ '{print $(NF-2)}'|cut -d '.' -f1)}
    upstream_tmp=${3:-$(git config --get remote.origin.url | awk -F: '{print $NF}' |awk -F/ '{print $(NF-2)}')}
    # Removing the .git part from repos
    # Ref: https://stackoverflow.com/questions/27658675/how-to-remove-last-n-characters-from-a-string-in-bash
    upstream=${upstream_tmp%.git}
    echo hub pull-request -b $upstream:$branch -h ${branch} -f $opts
    hub pull-request -b $upstream:$branch -h $(git rev-parse --abbrev-ref HEAD | cut -d ':' -f2 | cut -d '/' -f2) -f $opts
}

function sendfile(){
    curl -F "file=@${1}" https://file.io | jq ".link"
}

csh (){
    curl cheat.sh/$1
}


gps(){
    gopass otp -c $1 $(gopass $1) > /dev/null
}
alias ek='export KUBECONFIG='
alias m='mkdir'
alias clea='clear'
alias sk=sk
alias ll='ls -alF'
alias la='ls -A'
alias l='ls -CF'
alias cx='chmod +x'
alias py='function py(){ touch $1;echo -e "#!/usr/bin/env python3\n" >> $1; };py'
alias p='python3'
alias sovp='gps svpn; sudo openvpn --config ~/.cred/sunbird-staging.ovpn --auth-user-pass ~/.cred/ntp/vpn'
alias ovp="gps svpn; docker run -it --rm -e JENKINS_ADDR=10.20.0.9:8080 --privileged -p 8081:8080 -v ${HOME}/.cred/sunbird-staging.ovpn:/tmp/l.ovpn:ro -v ${HOME}/.cred/ntp/vpn:/tmp/vpn:ro rjshrjndrn/openvpn:latest /bin/sh -c '/tmp/socat.sh; /usr/sbin/openvpn --config /tmp/l.ovpn --auth-user-pass /tmp/vpn --ask-pass' "
alias sovpd='gps dvpn; sudo openvpn --config ~/.cred/sunbird-dev.ovpn --auth-user-pass ~/.cred/ntp/vpn'
alias ovpd="gps dvpn; docker run -it --rm -e JENKINS_ADDR=10.20.0.14:443 --privileged -p 443:8080 -v ${HOME}/.cred/sunbird-dev.ovpn:/tmp/l.ovpn:ro -v ${HOME}/.cred/ntp/vpn:/tmp/vpn:ro rjshrjndrn/openvpn:latest /bin/sh -c '/tmp/socat.sh; /usr/sbin/openvpn --config /tmp/l.ovpn --auth-user-pass /tmp/vpn --ask-pass' "
alias sovpl='gps lvpn; sudo openvpn --config ~/.cred/loadtest.ovpn --auth-user-pass ~/.cred/ntp/vpn'
alias ovpl="gps lvpn; docker run -it --rm -e JENKINS_ADDR=27.0.0.11:8080 --privileged -p 8082:8080 -v ${HOME}/.cred/loadtest.ovpn:/tmp/l.ovpn:ro -v ${HOME}/.cred/ntp/vpn:/tmp/vpn:ro rjshrjndrn/openvpn:latest /bin/sh -c '/tmp/socat.sh; /usr/sbin/openvpn --config /tmp/l.ovpn --auth-user-pass /tmp/vpn --ask-pass' "
alias vn='nvim -u ~/.essential.vim -N'
alias vim='/usr/bin/nvim -u ~/.config/nvim/minimal.vim'
alias gvim='neovide -u ~/.config/nvim/minimal.vim'
alias sv='cat | vim'
alias x='xdg-open'
# alias emacs='emacs --no-window-system'

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
alias gs='git status'
alias gc='git checkout'
alias gpl='git pull --rebase'
alias gplo='git pull --rebase origin heads/$(git rev-parse --abbrev-ref HEAD | rev | cut -d '/' -f1 | rev)'
alias gplr='git pull --rebase rjshrjndrn $(git rev-parse --abbrev-ref HEAD)'
alias gpo='git push origin $(git rev-parse --abbrev-ref HEAD)'
alias gpr='git push rjshrjndrn $(git rev-parse --abbrev-ref HEAD)'
alias gpso='git push --set-upstream origin $(git rev-parse --abbrev-ref HEAD)'
alias gpsr='git push --set-upstream rjshrjndrn HEAD:$(git rev-parse --abbrev-ref HEAD)'
alias grc='git rebase --continue'
alias grs='git rebase --skip'
alias grb='git rebase'
alias gst='git stash'
alias gstp='git stash pop'
# alias glo='git log --graph --pretty=oneline --abbrev-commit'
alias tf="terraform"
alias pu="pulumi"
alias hn='hugo new'

# hub alias
# Sourcing hub for git
eval "$(hub alias -s)"
alias at='docker run --rm -it -v $(pwd):/work -w /work -urajeshr ansible_ubuntu:16.04 bash'
# simpl3 git todo
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
    mosh --ssh='ssh -o "UserKnownHostsFile /dev/null" -o "StrictHostKeyChecking false"' -p 60011 $1
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
nso(){
    nssh ops@$1
}
# ansible aliases
alias ap='ansible-playbook'
alias apc='ansible-playbook -c local'
alias apcc="ansible-playbook -i $2 $1 --syntax-check -e 'hosts=dummy'"
alias apn='ansible-playbook -i ntp_preprod_inventory/env/ --vault-password-file=ntp_preprod_inventory/pass_file  -e ansible_ssh_user=rajeshr'

alias c="setxkbmap -option caps:escape"
alias yay="yay --sudoloop"
# Docker
alias d='docker'
alias dr='docker run'
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
alias civo="docker run -it --rm -v ${HOME}/.cred/civo/civo.json:/.civo.json civo/cli:latest"

alias xc='xclip -sel clip'

function uf() {
    url=$(echo $1 | rev | cut -d'/' -f 1 | rev)
    echo " curl --upload-file $url https://transfer.sh/$url -H 'Max-Downloads: 1' "
    curl --upload-file $url https://transfer.sh/$url -H 'Max-Downloads: 1'
}

# Window manager
alias a='wmctrl -a'
# Exporting vars
export GOROOT=/usr/lib/go
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
# pip local packages
# to see the directory: python3 -c 'import site; print(site.USER_BASE)')/bin
export PATH=$PATH:~/apps/bin:~/go_code/bin:${HOME}/.local/bin

export FZF_DEFAULT_OPTS='--bind tab:down,shift-tab:up'

[ -f ~/.fzf.zsh ] && source ~/.fzf.zsh
if [ /home/rajeshr/apps/bin/kubectl ]; then source <(kubectl completion zsh); fi
# xinput disable 9
source <(stern --completion=zsh)
source <(helm completion zsh)
source <(linkerd completion zsh)
source <(k3d completion zsh)
source <(eksctl completion zsh)
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
export PATH=$PATH:${HOME}/.krew/bin
# for what ever LANG, tmux should show proper glyphs
export LANG=en_IN.UTF-8
# loding custom sources
if [ -d ~/.config/tweaks ]; then
  for file in ~/.config/tweaks/*; do
    . $file
  done
fi
# Vault configs
export VAULT_ADDR="http://localhost:8200"
export VAULT_TOKEN="s.tT8SPJfc5Obr8xJUTvCJGiTx"

bindkey -v
bindkey -M viins '^r' fzf-history-widget # r for reverse history search
bindkey -M viins '^x^v' fzf-cd-widget # v for jump
bindkey -M viins '^x^f' fzf-file-widget # f for file
bindkey -M viins '^t' transpose-chars # t for transpose
bindkey -M viins '\ec' capitalize-word # c for capitalizae

# Starship config
eval "$(starship init zsh)"

###-begin-cfpack-completions-###
#
# yargs command completion script
#
# Installation: cfpack completion >> ~/.zshrc
#    or cfpack completion >> ~/.zsh_profile on OSX.
#
_cfpack_yargs_completions()
{
  local reply
  local si=$IFS
  IFS=$'
' reply=($(COMP_CWORD="$((CURRENT-1))" COMP_LINE="$BUFFER" COMP_POINT="$CURSOR" cfpack --get-yargs-completions "${words[@]}"))
  IFS=$si
  _describe 'values' reply
}
compdef _cfpack_yargs_completions cfpack
###-end-cfpack-completions-###

