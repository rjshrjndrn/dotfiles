# Ref: https://nixos.org/manual/nixpkgs/stable/#sec-getting-documentation
{
  packageOverrides = pkgs: with pkgs; {
    myPackages = pkgs.buildEnv {
      name = "my-packages";
      paths = [
        nox
        zsh
        git
        curl
        hub
        kube3d
        unixtools.netstat
        jq
        eksctl
        antibody
        aria
        tree
        curlie
        neovim
        kitty
        tmux
        # nixUnstable
        fzf
        ripgrep
        bat
        starship
        gnumake
        gcc
        k9s
        stern
        kubernetes-helm
        kubectl
      ];
      pathsToLink = [ "/share/man" "/share/doc" "/bin" ];
      extraOutputsToInstall = [ "man" "doc" ];
    };
  };
}
