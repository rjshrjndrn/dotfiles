{ pkgs, include ? { } }:

let
  # Apply package overrides if any
  packageOverrides = if include ? packageOverrides then include.packageOverrides else { };
  pkgsWithOverrides = pkgs // packageOverrides;
in
with pkgsWithOverrides;
[
  # localstack
########
  hey
  gh
######
  postgresql_17
######
  podman
  vcluster # Create virtual clusters
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
  #CICD
  fluxcd
  argocd
  eksctl
  # Dev env
  devbox
]
