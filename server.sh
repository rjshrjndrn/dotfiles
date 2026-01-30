#!/bin/bash
set -e

# Install mise
curl -fsSL https://mise.run | bash

# Add mise to bashrc if not already present
MISE_LINE='eval "$(${HOME}/.local/bin/mise activate bash)"'
grep -qxF "$MISE_LINE" ~/.bashrc || echo "$MISE_LINE" >>~/.bashrc

# Activate mise in current shell
eval "$(${HOME}/.local/bin/mise activate bash)"

# Install k9s and stern globally
mise use -g k9s stern
