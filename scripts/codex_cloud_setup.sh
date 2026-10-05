#!/usr/bin/env bash
set -euo pipefail

# Run during Codex Cloud setup, while internet access is available.
command -v curl >/dev/null
command -v mise >/dev/null

agent_tools_bin="$HOME/.local/bin"
mkdir -p "$agent_tools_bin"
export PATH="$agent_tools_bin:$PATH"

curl -fsSL "https://raw.githubusercontent.com/quangdang46/hashline/main/install.sh?$(date +%s)" \
  | bash -s -- --dest "$agent_tools_bin"
curl -fsSL "https://raw.githubusercontent.com/quangdang46/fast_file_search/main/install.sh?$(date +%s)" \
  | bash -s -- --dest "$agent_tools_bin" --no-mcp
mise use -g ast-grep

# Expose the installed binary without requiring mise activation at runtime.
ln -sf "$(mise which ast-grep)" "$agent_tools_bin/ast-grep"

# Setup exports do not persist. Prepend before any non-interactive shell guard.
agent_tools_path_line='export PATH="$HOME/.local/bin:$PATH" # Radiora agent tools'
touch "$HOME/.bashrc"
if ! grep -Fqx "$agent_tools_path_line" "$HOME/.bashrc"; then
  agent_tools_rc_tmp=$(mktemp)
  printf '%s\n' "$agent_tools_path_line" > "$agent_tools_rc_tmp"
  cat "$HOME/.bashrc" >> "$agent_tools_rc_tmp"
  cat "$agent_tools_rc_tmp" > "$HOME/.bashrc"
  rm -f "$agent_tools_rc_tmp"
fi

hashline --version
ffs --version
ast-grep --version
