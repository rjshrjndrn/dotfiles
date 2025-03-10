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
  terraform
  opentofu
  terragrunt
  terraform-docs
  packer
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
]
