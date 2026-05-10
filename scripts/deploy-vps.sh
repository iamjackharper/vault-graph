#!/usr/bin/env bash
# Deploy the pushed vault-graph main branch to a remote host.
#
# Required:
#   VAULT_GRAPH_VPS_SSH_TARGET=user@host
#
# Optional:
#   VAULT_GRAPH_VPS_SSH_KEY=/path/to/private_key
#   VAULT_GRAPH_VPS_REPO_DIR=/opt/vault-graph
#   VAULT_GRAPH_REPO_URL=$(git config --get remote.origin.url)
#   VAULT_GRAPH_REMOTE_ENV_FILE=/etc/vault-graph.env
#   VAULT_GRAPH_REMOTE_VAULT_PATH=/srv/obsidian-vault
#   VAULT_GRAPH_REMOTE_DATA_DIR=/var/lib/vault-graph
#   VAULT_GRAPH_VPS_SERVICE=vault-graph-watch.service

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

SSH_TARGET="${VAULT_GRAPH_VPS_SSH_TARGET:-}"
SSH_KEY="${VAULT_GRAPH_VPS_SSH_KEY:-}"
REMOTE_REPO="${VAULT_GRAPH_VPS_REPO_DIR:-/opt/vault-graph}"
REPO_URL="${VAULT_GRAPH_REPO_URL:-$(git -C "$REPO_ROOT" config --get remote.origin.url)}"
REMOTE_ENV_FILE="${VAULT_GRAPH_REMOTE_ENV_FILE:-/etc/vault-graph.env}"
DEFAULT_VAULT_PATH="${VAULT_GRAPH_REMOTE_VAULT_PATH:-/srv/obsidian-vault}"
DEFAULT_DATA_DIR="${VAULT_GRAPH_REMOTE_DATA_DIR:-/var/lib/vault-graph}"
SERVICE_NAME="${VAULT_GRAPH_VPS_SERVICE:-vault-graph-watch.service}"

if [ -z "$SSH_TARGET" ]; then
  echo "error: VAULT_GRAPH_VPS_SSH_TARGET is required (example: user@host)." >&2
  exit 1
fi

if [ -z "$REPO_URL" ]; then
  echo "error: VAULT_GRAPH_REPO_URL is required when the local origin URL is unavailable." >&2
  exit 1
fi

SSH_ARGS=()
if [ -n "$SSH_KEY" ]; then
  if [ ! -f "$SSH_KEY" ]; then
    echo "error: SSH key not found: $SSH_KEY" >&2
    exit 1
  fi
  SSH_ARGS=(-i "$SSH_KEY")
fi

echo "Deploying vault-graph to $SSH_TARGET"
echo "  repo: $REMOTE_REPO"

ssh "${SSH_ARGS[@]}" "$SSH_TARGET" \
  "set -euo pipefail
   if [ -f '$REMOTE_ENV_FILE' ]; then
     set -a
     . '$REMOTE_ENV_FILE'
     set +a
   fi

   if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
     echo 'error: node and npm are required. Install Node 20+ before deploying vault-graph.' >&2
     exit 1
   fi

   NODE_MAJOR=\$(node --version | sed -E 's/^v([0-9]+).*/\\1/')
   if [ \"\$NODE_MAJOR\" -lt 20 ]; then
     echo \"error: vault-graph requires Node 20+; found \$(node --version).\" >&2
     exit 1
   fi

   if [ -z \"\${OPENAI_API_KEY:-}\" ]; then
     echo 'error: OPENAI_API_KEY is required in the remote vault-graph environment file for indexing.' >&2
     exit 1
   fi

   export KG_VAULT_PATH=\"\${KG_VAULT_PATH:-\${OBSIDIAN_VAULT_PATH:-$DEFAULT_VAULT_PATH}}\"
   export KG_DATA_DIR=\"\${KG_DATA_DIR:-$DEFAULT_DATA_DIR}\"

   if [ ! -d '$REMOTE_REPO/.git' ]; then
     mkdir -p \"\$(dirname '$REMOTE_REPO')\"
     git clone '$REPO_URL' '$REMOTE_REPO'
   fi

   cd '$REMOTE_REPO'
   echo 'Remote before:' \$(git rev-parse --short HEAD 2>/dev/null || echo none)
   git fetch origin
   git pull --ff-only origin main
   npm ci
   npm run build
   npm link
   vault-graph --version
   vault-graph index
   if systemctl list-unit-files | grep -Fq '$SERVICE_NAME'; then
     systemctl restart '$SERVICE_NAME'
     systemctl --no-pager --full status '$SERVICE_NAME' | sed -n '1,20p'
   fi
   echo 'Remote after:' \$(git rev-parse --short HEAD)
   echo 'Indexed vault:' \"\$KG_VAULT_PATH\""
