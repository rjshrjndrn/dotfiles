source <(kubectl completion zsh)
source <(stern --completion=zsh)
source <(helm completion zsh)
# source <(k3d completion zsh)
# source <(eksctl completion zsh)
# source <(argocd completion zsh)

# Tab completion for gwc function
_gwc() {
    local branches worktrees
    worktrees=($(git worktree list | awk '{print $3}' | sed 's/\[//g; s/\]//g'))
    _describe 'worktrees' worktrees
}
# Register the completion function
compdef _gwc gwc

# Tab completion for gwa function
_gwa() {
    local branches worktrees
    worktrees=($(git worktree list | awk 'NR>1 {print $3}' | sed 's/\[//g; s/\]//g'))
    branches=($(git branch -a | sed 's/^[ *+]*//; s/remotes\///; s/origin\///' | awk '{print $1}' | grep -v -F -f <(printf '%s\n' "${worktrees[@]}")))
    _describe 'branches' branches
}
# Register the completion function
compdef _gwc gwc
compdef _gwa gwa
