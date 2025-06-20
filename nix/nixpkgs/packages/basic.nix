{ pkgs, include ? { } }:

let
  # Apply package overrides if any
  packageOverrides = if include ? packageOverrides then include.packageOverrides else { };
  pkgsWithOverrides = pkgs // packageOverrides;
in
# avoid packageWithOverride.nox, ...unzip etc
with pkgsWithOverrides;
 [
  htop
  nox
  fd
  #zsh
  unzip
  # Git
  git
  gitsign
  git-extras
  ggshield
  eget
  # git diff pager
  git-lfs
  git-filter-repo
  delta
  # Shell
  direnv
  shellcheck
  curl
  pre-commit
  hub
  kube3d
  unixtools.netstat
  dig
  jq
  yq-go
  silver-searcher
  aria
  tree
  curlie
  atuin
  caddy
  # neovim
  nodePackages_latest.bash-language-server
  nodePackages_latest.yaml-language-server
  # kitty
  tmux
  # nixUnstable
  fzf
  ripgrep
  bat
  starship
  gnumake
  gcc
  k9s
  stern
  jsonnet
  xclip
  # Encryption tool
  # Ref: https://github.com/FiloSottile/age
  age
  # Ref: https://github.com/mozilla/sops#encrypting-using-age
  sops
  # Security
  trivy
  tfsec
  ## SSL
  # mkcert
  step-cli
  step-ca
  # Password
  gopass
  # Blog
  hugo
  ngrok
  # UI apps
  # Ref: https://github.com/NixOS/nixpkgs/issues/82959#issuecomment-657306112
  # zoom-us
  # megasync
  # utils
  croc
  heroku
  atuin
  yazi
  lazygit
  # remote access
  upterm
  btop
]
