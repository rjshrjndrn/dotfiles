## Usage

Install packages with environment-specific configuration:
```bash
nix-env -f ~/dotfiles/nix/nixpkgs/default.nix -iA myPackages --arg includeFile ~/dotfiles/nix/nixpkgs/environments/dev.nix
nix-env -f ~/dotfiles/nix/nixpkgs/default.nix -iA myPackages --arg includeFile ~/dotfiles/nix/nixpkgs/environments/macm1.nix
nix-env -f ~/dotfiles/nix/nixpkgs/default.nix -iA myPackages --arg includeFile ~/dotfiles/nix/nixpkgs/environments/server.nix
```

## Mixing Stable and Unstable Packages

The configuration now supports pinning specific packages from stable nixpkgs for better binary cache coverage:

- **pkgs** - Uses your current `<nixpkgs>` (typically unstable)
- **pkgsStable** - Always uses nixos-24.11 (stable release)

To use a stable package, reference it in your package file:
```nix
# In packages/devops.nix
[
  kubectl        # from unstable
  pkgsStable.cosign  # from stable (better cache coverage)
]
```

This is useful when:
- Packages on unstable aren't cached yet (build from source)
- You want specific packages to be stable/reliable
- You need faster installation via pre-built binaries

## Cachix Configuration

This setup uses nix-community Cachix cache for pre-built binaries including non-free packages.

### Configuration (Determinate Nix)

Add to `/etc/nix/nix.custom.conf`:
```
# Add your user as trusted user
# trusted-users = root another

# Cachix binary cache for non-free packages
extra-substituters = https://nix-community.cachix.org
extra-trusted-public-keys = nix-community.cachix.org-1:mB9FSh9qf2dCimDSUo8Zy7bkq5CX+/rkCWyvRCYg3Fs=
```

Then restart the nix-daemon:
```bash
sudo systemctl restart nix-daemon
```

This speeds up installation by downloading pre-built binaries instead of building from source.

## References

https://github.com/yrashk/nix-home/blob/master/home.nix
https://nixos.wiki/wiki/Home_Manager
https://rycee.gitlab.io/home-manager/
https://nix-community.cachix.org
