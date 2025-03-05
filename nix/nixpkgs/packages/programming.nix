{ pkgs, include ? { } }:

let
  # Apply package overrides if any
  packageOverrides = if include ? packageOverrides then include.packageOverrides else { };
  pkgsWithOverrides = pkgs // packageOverrides;
in
# avoid packageWithOverride.nox, ...unzip etc
with pkgsWithOverrides;
 [
  # Rust
  cargo
  ## Go
  go_1_22
  ## Node
  nodejs
  nodePackages.npm
  nodePackages.prettier
  nodePackages.localtunnel
  yarn
  ## Python
  black
  pyenv
  pipenv
 ]

