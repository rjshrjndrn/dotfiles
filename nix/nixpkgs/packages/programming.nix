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
  go_1_24
  ## Node
  nodejs
  pnpm
  yarn
  ## Python
  black
  pyenv
  pipenv
  uv
 ]

