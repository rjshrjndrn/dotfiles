{ pkgs, pkgsStable, include ? { } }:

let
  # Apply package overrides if any
  packageOverrides = if include ? packageOverrides then include.packageOverrides else { };
  pkgsWithOverrides = pkgs // packageOverrides;
in
# avoid packageWithOverride.nox, ...unzip etc
with pkgsWithOverrides;
[
  terraform
  packer
  # (
  #   google-cloud-sdk.withExtraComponents [
  #     google-cloud-sdk.components.gke-gcloud-auth-plugin
  #   ]
  # )
]

