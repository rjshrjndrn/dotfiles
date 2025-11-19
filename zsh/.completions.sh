source <(kubectl completion zsh)
source <(stern --completion=zsh)
source <(helm completion zsh)
# source <(k3d completion zsh)
# source <(eksctl completion zsh)
# source <(argocd completion zsh)

# Tab completion for gwc function
_gwc() {
    local worktrees
    worktrees=($(git worktree list | awk '{print $3}' | sed 's/\[//g; s/\]//g'))
    _describe 'worktrees' worktrees
}
# Register the completion function
compdef _gwc gwc

# Tab completion for gwa function
_gwa() {
    local -a branches worktrees
    worktrees=($(git worktree list 2>/dev/null | awk '{print $3}' | sed 's/\[//g; s/\]//g'))
    branches=($(git branch -a 2>/dev/null | sed 's/^[ *+]*//; s/remotes\///; s/origin\///' | awk '{print $1}' | grep -v -F -f <(printf '%s\n' "${worktrees[@]}") 2>/dev/null))
    _describe 'branches' branches
}

# Tab completion for gwr function
_gwr() {
    local worktrees
    worktrees=($(git worktree list | awk '{print $3}' | sed 's/\[//g; s/\]//g'))
    _describe 'worktrees' worktrees
}

# Register the completion function
compdef _gwa gwa
compdef _gwr gwr
