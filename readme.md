run ./install.sh

or

curl -LO bit.ly/webinit && bash webinit-sh


### To auomatically stop/start bluetooth service while sleep
sudo stow etc -t /etc
sudo systemctl enable --now bluetooth.suspend.service 
