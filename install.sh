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
        nixpkgs.kitty \
        nixpkgs.tmux \
        nixpkgs.stow \
        nixpkgs.fzf \
        nixpkgs.ripgrep \
        nixpkgs.bat \
        nixpkgs.starship \
        nixpkgs.gnumake \
        nixpkgs.gcc \
        nixpkgs.k9s \
        nixpkgs.stern \
        nixpkgs.kubectl

# stow dotfiles
stow tmux
stow zsh
stow kitty

# Install tmux plugin
git clone https://github.com/tmux-plugins/tpm ~/.tmux/plugins/tpm

# add zsh as a login shell
command -v zsh | sudo tee -a /etc/shells

# use zsh as default shell
sudo chsh -s $(which zsh) $USER

# bundle zsh plugins 
antibody bundle < ~/.zsh_plugins.txt > ~/.zsh_plugins.sh

# install neovim plugins
nvim --headless +PlugInstall +qall
