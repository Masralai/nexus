#!/bin/sh
set -eu

repo="${NEXUS_INSTALL_REPO:-masralai/nexus}"
bindir="${NEXUS_BIN:-$HOME/.local/bin}"

os=$(uname -s | tr '[:upper:]' '[:lower:]')
case "$os" in
	linux | darwin) ;;
	mingw* | msys* | cygwin*)
		echo "nexus: on Windows, use PowerShell installer: irm https://raw.githubusercontent.com/$repo/main/scripts/install.ps1 | iex" >&2
		exit 1
		;;
	*)
		echo "nexus: unsupported OS: $os" >&2
		exit 1
		;;
esac

arch=$(uname -m)
case "$arch" in
	x86_64 | amd64) arch=amd64 ;;
	aarch64 | arm64) arch=arm64 ;;
	*)
		echo "nexus: unsupported architecture: $arch" >&2
		exit 1
		;;
esac

ext=""
if [ "$os" = windows ]; then ext=".exe"; fi
asset="nexus-$os-$arch$ext"
base="https://github.com/$repo/releases/latest/download"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

echo "downloading $asset"
curl -fsSL "$base/$asset" -o "$tmp/$asset"
curl -fsSL "$base/checksums.txt" -o "$tmp/checksums.txt"

want=$(awk -v a="$asset" '$2 == a {print $1}' "$tmp/checksums.txt")
if [ -z "$want" ]; then
	echo "nexus: no checksum for $asset" >&2
	exit 1
fi
if command -v sha256sum >/dev/null 2>&1; then
	got=$(sha256sum "$tmp/$asset" | awk '{print $1}')
else
	got=$(shasum -a 256 "$tmp/$asset" | awk '{print $1}')
fi
if [ "$want" != "$got" ]; then
	echo "nexus: checksum mismatch for $asset" >&2
	exit 1
fi
echo "verified $asset"

mkdir -p "$bindir"
cp "$tmp/$asset" "$bindir/nexus$ext"
chmod 0755 "$bindir/nexus$ext"
echo "installed $bindir/nexus$ext"
case ":$PATH:" in
*":$bindir:"*) ;;
*) echo "add $bindir to PATH to run nexus" ;;
esac
