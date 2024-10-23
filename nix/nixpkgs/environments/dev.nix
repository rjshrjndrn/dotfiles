{ pkgs, lib }:
{
  frontend = {
    alwaysInclude = true;  # Exclude frontend packages
    # packageOverrides = {
    #   # You can override specific packages if needed
    #   # For example, override the version of packageA
    #   deno = pkgs.deno.overrideAttrs (oldAttrs: {
    #     version = "2.0.0";
    #   });
    # };
  };
  cloud = {
    alwaysInclude = true;  # Exclude cloud packages
    packageOverrides = {
      # azure-cli = pkgs.azure-cli.overrideAttrs (oldAttrs: rec {
      #   version = "2.60.0";
      #   src = pkgs.fetchurl {
      #     url = "https://azurecliprod.blob.core.windows.net/releases/${version}/azure-cli-${version}.tar.gz";
      #     sha256 = lib.fakeSha256;  # Placeholder hash
      #   };
      # });
      # https://releases.nixos.org/nixos/24.05/nixos-24.05.984.0b8e7a1ae5a9/nixexprs.tar.xz
      #
      # # Method 2
      # Directly fetch azure-cli from the stable nixos-21.11 channel
      azure-cli = (import (fetchTarball {
      # Go to the url and get the desired release
      url = "https://releases.nixos.org/nixos/24.05/nixos-24.05.984.0b8e7a1ae5a9/nixexprs.tar.xz";
      # first run which sha256 = lib.fakeSha256; the error will give correct sha256. use that.
      sha256 = "sha256:138iipwzsrpsnlvfhix76lgc3k1hv6k8i5a8hj15m3j5zm2snpmy"; 
      }) {}).azure-cli;
    };
  };
}

