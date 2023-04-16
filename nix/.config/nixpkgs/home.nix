# a `home.nix` that is fed into home-manager
{config, pkgs, lib, ...}:

let
  user = "tuxedo";
  nixgl = import <nixgl> {} ;
  nixGLWrap = pkg: pkgs.runCommand "${pkg.name}-nixgl-wrapper" {} ''
    mkdir $out
    ln -s ${pkg}/* $out
    tmp=${pkg}
    rm $out/bin
    mkdir $out/bin
    for bin in ${pkg}/bin/*; do
     wrapped_bin=$out/bin/$(basename $bin)
     echo "exec ${lib.getExe nixgl.auto.nixGLDefault} $bin \$@" > $wrapped_bin
     echo "
     ${pkg}
     $bin
     " >> $wrapped_bin
     chmod +x $wrapped_bin
     sed -i 's,^Exec=.*,Exec=$bin,' "/home/${user}/.nix-profile/share/applications/$(basename $bin).desktop" || true
    done
  '';

in {
  # ...
  home.username = user;
  home.homeDirectory = "/home/"+user;
  home.stateVersion = "22.11";
  programs.home-manager.enable = true;
  fonts.fontconfig.enable = true;
  targets.genericLinux.enable = true;

  home.packages = [
    pkgs.fira-code
    pkgs.fira-code-symbols
    # pkgs.nerdfonts
    # pkgs.noto-fonts-emoji
    pkgs.rofi
    pkgs.cargo

    # Run using graphics
    nixgl.auto.nixGLDefault
    (nixGLWrap pkgs.wezterm)
    (nixGLWrap pkgs.inkscape)
    (nixGLWrap pkgs.slack)
    # (nixGLWrap pkgs.zoom-us)
    # (nixGLWrap pkgs.notion-app-enhanced)
    # (nixGLWrap pkgs.tdesktop)
    # (nixGLWrap pkgs.signal-desktop)
    # (nixGLWrap pkgs.vlc)
    # (nixGLWrap pkgs.teams)

    
   # ...
  ];
}
