# Ref: https://nixos.org/manual/nixpkgs/stable/#sec-getting-documentation
{
  allowUnfree = true;
  qtWrapperArgs = [ ''--set QT_XCB_GL_INTEGRATION none'' ];
  xdg.enable=true;
  xdg.mime.enable=true;
  targets.genericLinux.enable=true;
  packageOverrides = pkgs: with pkgs; {
    myPackages = pkgs.buildEnv {
      name = "my-packages";
      paths = [
        nox
        #zsh
        unzip
        # Git
        git
        gitsign
        # git diff pager
        delta
        # Shell
        direnv
        shellcheck
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
        # Personal info dashboard
        wtf
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
        krew
        cilium-cli
        hubble
        cosign
        jsonnet
        # Cloud
        awscli2
        aws-iam-authenticator
        google-cloud-sdk
        # azure-cli
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
        step-cli
        #CICD
        fluxcd
        # Password
        gopass

        # UI apps
        # Ref: https://github.com/NixOS/nixpkgs/issues/82959#issuecomment-657306112
        # zoom-us
        # megasync
      ];
      # Ref: https://nixos.org/manual/nixpkgs/stable/#sec-getting-documentation
      # pathsToLink tells Nixpkgs to only link the paths listed which gets rid of the extra stuff in the profile.
      # /bin and /share are good defaults for a user environment, getting rid of the clutter.
      # If you are running on Nix on MacOS, you may want to add another path as well, /Applications, that makes GUI apps available. 
      pathsToLink = [ "/share" "/share" "/bin" ];
      extraOutputsToInstall = [ "man" "doc" ];
    };
  };
}
