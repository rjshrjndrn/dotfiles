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
  #zsh
  unzip
  # Git
  git
  gitsign
  git-extras
  # ggshield
  graphite-cli
  eget
  # git diff pager
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
  eksctl
  aria
  tree
  curlie
  atuin
  caddy
  neovim
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
  # Kubernetes
  kubernetes-helm
  helm-ls
  kubectl
  kustomize
  kubectx
  kubeconform
  krew
  cilium-cli
  hubble
  # pluto detect-all-in-cluster -o wide --target-versions k8s=v1.24.0 --only-show-removed | tee -a removedapis.txt
  pluto
  nova
  # kubernetes packet sniffer
  kubeshark
  cosign
  jsonnet
  vcluster # Create virtual clusters
  # Cloud
  scaleway-cli
  awscli2
  aws-iam-authenticator
  (
    google-cloud-sdk.withExtraComponents [
      google-cloud-sdk.components.gke-gcloud-auth-plugin
    ]
  )
  ssm-session-manager-plugin
  xclip
  # Encryption tool
  # Ref: https://github.com/FiloSottile/age
  age
  # Ref: https://github.com/mozilla/sops#encrypting-using-age
  sops
  # Security
  trivy
  tfsec
  # IAC
  # terraform
  opentofu
  terragrunt
  # terraform-docs markdown --output Readme.md ./components/iam
  terraform-docs
  packer
  ## SSL
  mkcert
  # step-cli
  #CICD
  fluxcd
  argocd
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
]
