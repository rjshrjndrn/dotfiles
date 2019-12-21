# curl -Lks http://bit.do/shell-init | /bin/bash
# ref: https://www.atlassian.com/git/tutorials/dotfiles
echo "setting up vim-plug for nvim"
curl -sfLo ~/.local/share/nvim/site/autoload/plug.vim --create-dirs \
    https://raw.githubusercontent.com/junegunn/vim-plug/master/plug.vim
echo "setting up dot files"
git clone --bare git@github.com:rjshrjndrn/dotfiles.git $HOME/.cfg
function config {
   /usr/bin/git --git-dir=$HOME/.cfg/ --work-tree=$HOME $@
}
mkdir -p .config-backup
config checkout
if [ $? = 0 ]; then
  echo "Checked out config.";
  else
    echo "Backing up pre-existing dot files.";
    config checkout 2>&1 | egrep "\s+\." | awk {'print $1'} | xargs -I{} mv {} .config-backup/{}
fi;
config checkout
config config status.showUntrackedFiles no
# If you're on ubuntu/debian, nvim ppa
# sudo add-apt-repository ppa:neovim-ppa/unstable
