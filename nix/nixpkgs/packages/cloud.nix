{ pkgs, include ? { } }:

let
  # Apply package overrides if any
  packageOverrides = if include ? packageOverrides then include.packageOverrides else { };
  pkgsWithOverrides = pkgs // packageOverrides;
in
# avoid packageWithOverride.nox, ...unzip etc
with pkgsWithOverrides;
[
  azure-cli
  # IAC
  opentofu
 # terragrunt
  terraform-docs
  # Cloud
  scaleway-cli
  awscli2
  aws-iam-authenticator
  ssm-session-manager-plugin
]
