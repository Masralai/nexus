#!/usr/bin/env bash
set -euo pipefail

REPO="${NEXUS_INSTALL_REPO:-masralai/nexus}"
BIN_DIR="${HOME}/.local/bin"
ARCH="$(uname -m)"

case "$ARCH" in
  x86_64|amd64) ASSET="nexus-linux-amd64" ;;
  aarch64|arm64) ASSET="nexus-linux-arm64" ;;
  *) echo "unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

mkdir -p "$BIN_DIR"
URL="https://github.com/${REPO}/releases/latest/download/${ASSET}"
echo "downloading ${URL}"
curl -fsSL "$URL" -o "${BIN_DIR}/nexus"
chmod +x "${BIN_DIR}/nexus"

case ":$PATH:" in *":${BIN_DIR}:"*) ;; *)
  echo "add to PATH: export PATH=\"\${HOME}/.local/bin:\${PATH}\""
  ;;
esac

"${BIN_DIR}/nexus" --version
echo "installed ${BIN_DIR}/nexus"
