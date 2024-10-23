# nix-env -f default.nix -iA myPackages --arg includeDev false

{ pkgs ? import <nixpkgs> {}, includeDev ? false}:

let
  # Import nixpkgs with the allowUnfree configuration and other settings
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

  basicPackages = import ./packages/basic.nix { inherit pkgs; };
  devPackages = if includeDev then import ./packages/frontend.nix { inherit pkgs; } else [];
in
{
  myPackages = pkgs.buildEnv {
    name = "my-packages";
    paths = basicPackages ++ devPackages;
    pathsToLink = [ "/share" "/bin" ];
    extraOutputsToInstall = [ "man" "doc" ];
  };

}
