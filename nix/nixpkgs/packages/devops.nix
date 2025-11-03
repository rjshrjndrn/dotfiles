{ pkgs, pkgsStable, include ? { } }:

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
  podman
  podman-compose
  skopeo # inspect remote container images, without downloading
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
  # flatcar config gen
  butane
  # pluto detect-all-in-cluster -o wide --target-versions k8s=v1.24.0 --only-show-removed | tee -a removedapis.txt
  pluto
  nova
  # kubernetes packet sniffer
  kubeshark
  # Use stable version for better cache coverage
  pkgsStable.cosign
  #CICD
  fluxcd
  argocd
  eksctl
  # Dev env
  devbox
  act
  # load gen
  oha
  # network
  iperf
  # ignition for flatcar
  butane
]
