source <(kubectl completion zsh)
source <(stern --completion=zsh)
source <(helm completion zsh)
# source <(k3d completion zsh)
# source <(eksctl completion zsh)
# source <(argocd completion zsh)

# Tab completion for gwc function
# Lists worktree branch names for switching between worktrees
# For detached HEAD (e.g., tags), shows the folder basename instead of "detached"
_gwc() {
    local worktrees
    worktrees=($(git worktree list | awk '{
        branch = $3
        gsub(/[\[\]]/, "", branch)
        # detached HEAD shows as "(detached" - use folder name instead
        if (branch ~ /^\(detached/) {
            n = split($1, parts, "/")
            print parts[n]
        } else {
            print branch
        }
    }'))
    _describe 'worktrees' worktrees
}
compdef _gwc gwc

# Tab completion for gwa function
# Lists branches available for creating new worktrees
# Excludes branches that already have a worktree
_gwa() {
    local -a branches worktrees
    # get existing worktree branches to exclude them
    worktrees=($(git worktree list 2>/dev/null | awk '{print $3}' | sed 's/\[//g; s/\]//g'))
    # list all branches (local + remote), exclude ones already in worktrees
    branches=($(git branch -a 2>/dev/null | sed 's/^[ *+]*//; s/remotes\///; s/origin\///' | awk '{print $1}' | grep -v -F -f <(printf '%s\n' "${worktrees[@]}") 2>/dev/null))
    _describe 'branches' branches
}

# Tab completion for gwr function
# Lists worktree branch names for removing worktrees
# For detached HEAD (e.g., tags), shows the folder basename instead of "detached"
_gwr() {
    local worktrees
    worktrees=($(git worktree list | awk '{
        branch = $3
        gsub(/[\[\]]/, "", branch)
        # detached HEAD shows as "(detached" - use folder name instead
        if (branch ~ /^\(detached/) {
            n = split($1, parts, "/")
            print parts[n]
        } else {
            print branch
        }
    }'))
    _describe 'worktrees' worktrees
}

compdef _gwa gwa
compdef _gwr gwr
