{ pkgs }:
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
}

