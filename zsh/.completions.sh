source <(kubectl completion zsh)
source <(stern --completion=zsh)
source <(helm completion zsh)
source <(k3d completion zsh)
source <(eksctl completion zsh)
source <(argocd completion zsh)

# Tab completion for gwc function
_gwc() {
    local branches worktrees
    worktrees=($(git worktree list | awk '{print $1}'))
    _describe 'worktrees' worktrees
}
# Register the completion function
compdef _gwc gwc
