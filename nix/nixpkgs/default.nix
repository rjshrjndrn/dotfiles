# nix-env -f default.nix -iA myPackages --arg include '{ extra = true; }'

{ include ? { } }:

let
  # Import nixpkgs with the necessary configurations
  pkgs = import <nixpkgs> {
    config = {
      allowUnfree = true;
      qtWrapperArgs = [ "--set" "QT_XCB_GL_INTEGRATION" "none" ];
      xdg = {
        enable = true;
        mime.enable = true;
      };
      targets.genericLinux.enable = true;
    };
  };

  # Define an attribute set mapping group names to their package files
  packageGroups = {
    basic = {
      file = ./packages/basic.nix;
      alwaysInclude = true; # Basic packages are always included
    };
    frontend = {
      file = ./packages/frontend.nix;
      alwaysInclude = true;
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
    group.alwaysInclude || (include.${name} or false);

  # Function to import packages from a package group
  importPackages = name: group:
    if includeGroup name group then
      import group.file { inherit pkgs; }
    else
      [];

  # Map over packageGroups to get the list of packages
  packagesList = builtins.concatLists (
    # Uses builtins.mapAttrs to apply importPackages to each package group
    #
    # `builtins.mapAttrs importPackages packageGroups` applies importPackages to each attribute in packageGroups.
    # This means for each name = group pair, it calls importPackages name group
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

