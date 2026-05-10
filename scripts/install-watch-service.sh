#!/usr/bin/env bash
# Install or refresh the vault-graph watch systemd service on a remote host.
#
# Required:
#   VAULT_GRAPH_VPS_SSH_TARGET=user@host
#
# Optional:
#   VAULT_GRAPH_VPS_SSH_KEY=/path/to/private_key
#   VAULT_GRAPH_VPS_SERVICE=vault-graph-watch.service
#   VAULT_GRAPH_VPS_REPO_DIR=/opt/vault-graph
#   VAULT_GRAPH_REMOTE_ENV_FILE=/etc/vault-graph.env
#   VAULT_GRAPH_REMOTE_DATA_DIR=/var/lib/vault-graph
#   VAULT_GRAPH_REMOTE_VAULT_PATH=/srv/obsidian-vault

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

SSH_TARGET="${VAULT_GRAPH_VPS_SSH_TARGET:-}"
SSH_KEY="${VAULT_GRAPH_VPS_SSH_KEY:-}"
SERVICE_NAME="${VAULT_GRAPH_VPS_SERVICE:-vault-graph-watch.service}"
LOCAL_UNIT="$REPO_ROOT/systemd/vault-graph-watch.service"
REMOTE_REPO_DIR="${VAULT_GRAPH_VPS_REPO_DIR:-/opt/vault-graph}"
REMOTE_ENV_FILE="${VAULT_GRAPH_REMOTE_ENV_FILE:-/etc/vault-graph.env}"
REMOTE_DATA_DIR="${VAULT_GRAPH_REMOTE_DATA_DIR:-/var/lib/vault-graph}"
REMOTE_VAULT_PATH="${VAULT_GRAPH_REMOTE_VAULT_PATH:-/srv/obsidian-vault}"

if [ -z "$SSH_TARGET" ]; then
  echo "error: VAULT_GRAPH_VPS_SSH_TARGET is required (example: user@host)." >&2
  exit 1
fi

if [ ! -f "$LOCAL_UNIT" ]; then
  echo "error: systemd unit not found: $LOCAL_UNIT" >&2
  exit 1
fi

SSH_ARGS=()
SCP_ARGS=()
if [ -n "$SSH_KEY" ]; then
  if [ ! -f "$SSH_KEY" ]; then
    echo "error: SSH key not found: $SSH_KEY" >&2
    exit 1
  fi
  SSH_ARGS=(-i "$SSH_KEY")
  SCP_ARGS=(-i "$SSH_KEY")
fi

echo "Installing $SERVICE_NAME on $SSH_TARGET"

TMP_UNIT="$(mktemp)"
trap 'rm -f "$TMP_UNIT"' EXIT

sed \
  -e "s|__WORKING_DIRECTORY__|$REMOTE_REPO_DIR|g" \
  -e "s|__ENV_FILE__|$REMOTE_ENV_FILE|g" \
  -e "s|__DATA_DIR__|$REMOTE_DATA_DIR|g" \
  -e "s|__DEFAULT_VAULT_PATH__|$REMOTE_VAULT_PATH|g" \
  "$LOCAL_UNIT" > "$TMP_UNIT"

scp "${SCP_ARGS[@]}" "$TMP_UNIT" "$SSH_TARGET:/etc/systemd/system/$SERVICE_NAME"

ssh "${SSH_ARGS[@]}" "$SSH_TARGET" \
  "set -euo pipefail
   systemctl daemon-reload
   systemctl enable --now '$SERVICE_NAME'
   systemctl restart '$SERVICE_NAME'
   systemctl status '$SERVICE_NAME' --no-pager -l"
