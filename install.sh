# install nix
[[ -x "$(command -v nix-env)" ]] || {
    curl -L https://nixos.org/nix/install | sh
}

# source nix
. ~/.nix-profile/etc/profile.d/nix.sh

# install packages
nix-env -iA \
        nixpkgs.zsh \
        nixpkgs.git \
        nixpkgs.hub \
        nixpkgs.antibody \
        nixpkgs.aria \
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
        nixpkgs.kubernetes-helm \
        nixpkgs.kubectl

# stow dotfiles
stow tmux
stow zsh
stow kitty
stow nvim

# Install tmux plugin
git clone https://github.com/tmux-plugins/tpm ~/.tmux/plugins/tpm

# add zsh as a login shell
command -v zsh | sudo tee -a /etc/shells

# use zsh as default shell
sudo chsh -s $(which zsh) $USER

# bundle zsh plugins 
antibody bundle < ~/.zsh_plugins.txt > ~/.zsh_plugins.sh

# Installing vim-plug
sh -c 'curl -fLo "${XDG_DATA_HOME:-$HOME/.local/share}"/nvim/site/autoload/plug.vim --create-dirs \
       https://raw.githubusercontent.com/junegunn/vim-plug/master/plug.vim'

# install neovim plugins
nvim --headless +PlugInstall +qall
