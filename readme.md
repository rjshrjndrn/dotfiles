run ./install.sh

or

curl -LO bit.ly/webinit && bash webinit-sh

### To auomatically stop/start bluetooth service while sleep

sudo stow etc -t /etc
sudo systemctl enable --now bluetooth.suspend.service

### To install fonts

ref: https://github.com/getnf/getnf

## To install flatpak systemd packages

# have to create the folders physically, not linking

# If there is no such directory, tree, stow will not create it, unless you use --no-folding

stow flatpak -t ~/ --no-folding
