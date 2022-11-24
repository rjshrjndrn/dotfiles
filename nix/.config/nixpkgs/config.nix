# Ref: https://nixos.org/manual/nixpkgs/stable/#sec-getting-documentation
{
  packageOverrides = pkgs: with pkgs; {
    myPackages = pkgs.buildEnv {
      name = "my-packages";
      paths = [
        nox
        zsh
        unzip
        # Git
        git
        # git diff pager
        delta
        curl
        pre-commit
        hub
        kube3d
        unixtools.netstat
        jq
        yq-go
        silver-searcher
        eksctl
        antibody
        aria
        tree
        curlie
        # neovim
        # kitty
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
        cilium-cli
        # Cloud
        awscli2
        aws-iam-authenticator
        xclip
        # Encryption tool
        # Ref: https://github.com/FiloSottile/age
        age
        # Ref: https://github.com/mozilla/sops#encrypting-using-age
        sops
        # Security
        trivy
        terraform
        terragrunt
        ## Go
        go_1_18
        ## Node
        nodejs
        nodePackages.npm
        nodePackages.prettier
        ## Python
        black
        ## SSL
        mkcert
      ];
      pathsToLink = [ "/share/man" "/share/doc" "/bin" ];
      extraOutputsToInstall = [ "man" "doc" ];
    };
  };
}
