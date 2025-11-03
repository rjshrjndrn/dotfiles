{ pkgs, pkgsStable, include ? { } }:

let
  # Apply package overrides if any
  packageOverrides = if include ? packageOverrides then include.packageOverrides else { };
  pkgsWithOverrides = pkgs // packageOverrides;
in
# avoid packageWithOverride.nox, ...unzip etc
with pkgsWithOverrides;
 [
  ticktick
  slack
 ]

