if ! stow --version &>/dev/null || ! zsh --version &>/dev/null; then
    echo stow and zsh are required to run this script.
fi

# install nix
[[ -x "$(command -v nix-env)" ]] || {
    curl -fsSL https://install.determinate.systems/nix | sh -s -- install --determinate
}

# source nix
. /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh

# Installing nix packages

# stow dotfiles
configs=(tmux zsh kitty starship nix git eget wezterm apps k9s containers k3d)
for config in "${configs[@]}"; do
    stow "$config" -t ~/
done

# if linux, stow the flatpak
if [[ "$(uname -s)" == "Linux" ]]; then
    stow flatpak -t ~/ --no-folding
    sudo stow system/ -t / --no-folding
    sudo cp -al system/etc/systemd/resolved.conf.d/openreplay.conf /etc/systemd/resolved.conf.d/
    systemctl --user daemon-reload
fi

#root_configs=(keyd stubby dnsmasq)
#for config in ${root_configs[*]};do
#    sudo `which stow` $config -t /
#done

# Installing nix packages
#nix-env -iA nixpkgs.myPackages
nix-env -f ~/dotfiles/nix/nixpkgs/default.nix -iA myPackages --arg includeFile ~/dotfiles/nix/nixpkgs/environments/dev.nix

# Install tmux plugin
[[ -d ~/.tmux/plugins/tpm ]] || {
    git clone https://github.com/tmux-plugins/tpm ~/.tmux/plugins/tpm
}

# add zsh as a login shell
# command -v zsh | sudo tee -a /etc/shells

# use zsh as default shell
sudo chsh -s "$(which zsh)" "$USER"

# Installing ohmyzsh
sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended --skip-chsh --keep-zshrc
source ~/.zshrc

# Install zsh-autosuggestions plugin
git clone https://github.com/zsh-users/zsh-autosuggestions ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-autosuggestions
git clone https://github.com/zsh-users/zsh-history-substring-search ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-history-substring-search
git clone https://github.com/Aloxaf/fzf-tab ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/fzf-tab

git clone https://github.com/rjshrjndrn/nvim-basic-ide.git ~/.config/nvim

# install neovim plugins
nvim
