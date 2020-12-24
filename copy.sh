#!/bin/bash
orig_path=/home/rajesh
target_path=${HOME}

file_list=( .gnupg .gitconfig .tmux .tmux.conf ".ssh" ".config/nvim" ".config/gopass" ".vim" "vimwiki" .zshrc .fzf .oh-my-zsh .zplug .cred .config/kitty .config/starship.toml apps .histfile .z .kube )

for line in "${file_list[@]}"
do
  echo copying $line
  cp -alf ${orig_path}/${line} ${target_path}/$(echo ${line} | cut -d '/' -f1)
done
