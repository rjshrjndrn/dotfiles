# install nix
[[ -x "$(command -v nix-env)" ]] || {
    curl -L https://nixos.org/nix/install | sh
}

# source nix
. ~/.nix-profile/etc/profile.d/nix.sh

# install packages
nix-env -iA nixpkgs.stow

# stow dotfiles
configs=(tmux zsh kitty nvim starship nix)
for config in ${configs[*]};do
    stow $config
done

# Installing nix packages
nix-env -iA nixpkgs.myPackages

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
