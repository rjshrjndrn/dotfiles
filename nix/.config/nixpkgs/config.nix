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
        git-extras
        ggshield
        eget
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
        distrobox
        dig
        jq
        yq-go
        silver-searcher
        eksctl
        aria
        tree
        curlie
        atuin
        caddy
        # neovim
        nodePackages_latest.bash-language-server
        nodePackages_latest.yaml-language-server
        # kitty
        tmux
        rofi
        # nixUnstable
        fzf
        ripgrep
        bat
        starship
        gnumake
        gcc
        k9s
        stern
        # Kubernetes
        kubernetes-helm
        helm-ls
        kubectl
        kubectx
        kubectl-node-shell
        kubeconform
        krew
        cilium-cli
        hubble
        # pluto detect-all-in-cluster -o wide --target-versions k8s=v1.24.0 --only-show-removed | tee -a removedapis.txt
        pluto
        nova
        # kubernetes packet sniffer
        kubeshark
        cosign
        jsonnet
        vcluster # Create virtual clusters
        # Cloud
        scaleway-cli
        awscli2
        aws-iam-authenticator
        (
          google-cloud-sdk.withExtraComponents [
            google-cloud-sdk.components.gke-gcloud-auth-plugin
          ]
        )
        ssm-session-manager-plugin
        azure-cli
        xclip
        # Encryption tool
        # Ref: https://github.com/FiloSottile/age
        age
        # Ref: https://github.com/mozilla/sops#encrypting-using-age
        sops
        # Security
        trivy
        tfsec
        # IAC
        terraform
        terragrunt
        # terraform-docs markdown --output Readme.md ./components/iam
        terraform-docs
        packer
        ## Go
        go_1_22
        ## Node
        nodejs
        nodePackages.npm
        nodePackages.prettier
        nodePackages.localtunnel
        ## Python
        black
        ## SSL
        mkcert
        step-cli
        #CICD
        fluxcd
        argocd
        # Password
        gopass
        # Blog
        hugo
        ngrok
        # UI apps
        # Ref: https://github.com/NixOS/nixpkgs/issues/82959#issuecomment-657306112
        # zoom-us
        # megasync
        # utils
        croc
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
