# install nix
curl -L https://nixos.org/nix/install | sh

# source nix
. ~/.nix-profile/etc/profile.d/nix.sh

# install packages
nix-env -iA \
        nixpkgs.zsh \
        nixpkgs.git \
        nixpkgs.tree \
        nixpkgs.neovim \
        nixpkgs.tmux \
        nixpkgs.stow \
        nixpkgs.fzf \
        nixpkgs.ripgrep \
        nixpkgs.bat \
        nixpkgs.gnumake \
        nixpkgs.gcc \
        nixpkgs.k9s \
        nixpkgs.stern \
        nixpkgs.kubectl

# stow dotfiles
stow tmux
stow zsh

# Install tmux plugin
git clone https://github.com/tmux-plugins/tpm ~/.tmux/plugins/tpm
