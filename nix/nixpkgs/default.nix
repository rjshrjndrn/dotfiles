#  nix-env -f default.nix -iA myPackages --arg includeFile ./environments/dev.nix

{ includeFile ? null }:

let
  nixConfig = {
    allowUnfree = true;
    qtWrapperArgs = [ "--set" "QT_XCB_GL_INTEGRATION" "none" ];
    xdg = {
      enable = true;
      mime.enable = true;
    };
    targets.genericLinux.enable = true;
  };

  # Import unstable nixpkgs (preferred for latest packages)
  pkgsUnstable = import (fetchTarball {
    url = "https://github.com/NixOS/nixpkgs/archive/nixpkgs-unstable.tar.gz";
  }) {
    config = nixConfig;
  };

  # Import stable nixpkgs for better binary cache coverage
  pkgsStable = import (fetchTarball {
    url = "https://github.com/NixOS/nixpkgs/archive/nixos-24.11.tar.gz";
  }) {
    config = nixConfig;
  };

  # Hybrid pkgs: unstable by default, but override specific packages with stable versions
  # when they're not cached in unstable (to avoid building from source)
  pkgs = pkgsUnstable // {
    # Override these packages to use stable versions for better cache availability
    fish = pkgsStable.fish;
    direnv = pkgsStable.direnv;
    packer = pkgsStable.packer;
  };

  lib = pkgs.lib;
  # Import the include file if provided, otherwise default to an empty set
  include = if includeFile != null then import includeFile { inherit pkgs pkgsStable lib; } else { };

  # Define an attribute set mapping group names to their package files
  packageGroups = {
    basic = {
      file = ./packages/basic.nix;
      alwaysInclude = true; # Basic packages are always included
    };
    amd64 = {
      file = ./packages/amd64.nix;
      alwaysInclude = true; # Basic packages are always included
    };
    frontend = {
      file = ./packages/frontend.nix;
      alwaysInclude = false;
    };
    cloud = {
      file = ./packages/cloud.nix;
      alwaysInclude = false;
    };
    devops = {
      file = ./packages/devops.nix;
      alwaysInclude = false;
    };
    programming = {
      file = ./packages/programming.nix;
      alwaysInclude = true;
    };
    gui = {
      file = ./packages/gui.nix;
      alwaysInclude = false;
    };
    nonFree = {
      file = ./packages/non-free.nix;
      alwaysInclude = false;
    };
    # Add more package groups here
    # For example:
    # extra = {
    #   file = ./packages/extra.nix;
    #   alwaysInclude = false;
    # };
  };

  # Function to determine if a package group should be included
  includeGroup = name: group:
    if builtins.hasAttr name include && builtins.hasAttr "alwaysInclude" include.${name}
    then include.${name}.alwaysInclude
    else group.alwaysInclude;

  # Function to import packages from a package group
  importPackages = name: group:
    if includeGroup name group then
      import group.file { inherit pkgs pkgsStable; include = (include.${name} or {}); }
    else
      [];

  # Map over packageGroups to get the list of packages
  packagesList = builtins.concatLists (
    builtins.attrValues (builtins.mapAttrs importPackages packageGroups)
  );

in
{
  # Build the environment with the combined packages
  myPackages = pkgs.buildEnv {
    name = "my-packages";
    paths = packagesList;
    pathsToLink = [ "/share" "/bin" ];
    extraOutputsToInstall = [ "man" "doc" ];
  };
}

