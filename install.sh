# install nix
[[ -x "$(command -v nix-env)" ]] || {
    curl -L https://nixos.org/nix/install | sh
}

# source nix
. ~/.nix-profile/etc/profile.d/nix.sh

# Installing nix packages
nix-env -iA nixpkgs.stow

# stow dotfiles
configs=(tmux zsh kitty nvim starship nix git eget wezterm apps k9s)
for config in ${configs[*]}; do
    stow $config -t ~/
done

#root_configs=(keyd stubby dnsmasq)
#for config in ${root_configs[*]};do
#    sudo `which stow` $config -t /
#done

# Installing nix packages
nix-env -iA nixpkgs.myPackages

# Install tmux plugin
[[ -d ~/.tmux/plugins/tpm ]] || {
    git clone https://github.com/tmux-plugins/tpm ~/.tmux/plugins/tpm
}

# add zsh as a login shell
# command -v zsh | sudo tee -a /etc/shells

# use zsh as default shell
sudo chsh -s $(which zsh) $USER

# Installing ohmyzsh
sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended --skip-chsh --keep-zshrc
source ~/.zshrc

# Install zsh-autosuggestions plugin
git clone https://github.com/zsh-users/zsh-autosuggestions ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-autosuggestions

# # Installing vim-plug
# sh -c 'curl -fLo "${XDG_DATA_HOME:-$HOME/.local/share}"/nvim/site/autoload/plug.vim --create-dirs \
#        https://raw.githubusercontent.com/junegunn/vim-plug/master/plug.vim'
#
# Cloning the nvim repo
# rm -rf ~/.config/nvim

# git clone https://github.com/rjshrjndrn/nvim-basic-ide.git ~/.config/nvim

# install neovim plugins
nvim
