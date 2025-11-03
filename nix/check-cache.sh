#!/usr/bin/env bash
# Check if a Nix package is available in binary caches
# Usage: ./check-cache.sh package-name
#        ./check-cache.sh hello
#        ./check-cache.sh cosign

set -e

PACKAGE=${1:-hello}
CACHE_URL=${2:-https://cache.nixos.org}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Checking if '$PACKAGE' is cached"
echo "Cache: $CACHE_URL"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Method 1: Quick check with dry-run
echo "📦 Running dry-run check..."
OUTPUT=$(nix-build '<nixpkgs>' -A "$PACKAGE" --dry-run 2>&1 || true)

if echo "$OUTPUT" | grep -q "will be fetched"; then
    echo "✅ Package IS available in cache"
    echo ""
    echo "$OUTPUT" | grep "will be fetched" | head -3
elif echo "$OUTPUT" | grep -q "will be built"; then
    echo "❌ Package NOT in cache (will build from source)"
    echo ""
    echo "$OUTPUT" | grep "will be built" | head -1
else
    echo "⚠️  Unable to determine cache status"
    echo "$OUTPUT" | head -5
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "To check other caches:"
echo "  $0 $PACKAGE https://nix-community.cachix.org"
echo "  $0 $PACKAGE https://cache.flakehub.com"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
