#!/bin/sh
# PyBI installer for Chromebook (Linux), Ubuntu, Debian, Mint and other Debian-based Linux.
#
#   curl -fsSL https://rafay183.github.io/pybi/install.sh | bash
#
# Downloads the newest PyBI .deb for this computer (Intel/AMD or ARM) from GitHub Releases,
# checks its SHA-256, and installs it with apt. Run it again any time to update.
set -eu

REPO="rafay183/pybi"
say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }

command -v apt-get >/dev/null 2>&1 || die "this installer is for Debian-based Linux (Chromebook, Ubuntu, Debian, Mint).
On other Linux, download the AppImage: https://github.com/$REPO/releases/latest"

case "$(dpkg --print-architecture 2>/dev/null || uname -m)" in
  amd64|x86_64) ARCH=amd64 ;;
  arm64|aarch64) ARCH=arm64 ;;
  *) die "PyBI needs a 64-bit Intel/AMD or ARM computer." ;;
esac

FILE="PyBI-Linux-$ARCH.deb"
URL="https://github.com/$REPO/releases/latest/download/$FILE"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
chmod 755 "$TMP"

fetch() {
  if command -v curl >/dev/null 2>&1; then curl -fL --retry 3 --progress-bar -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then wget -q --show-progress -O "$2" "$1"
  else die "neither curl nor wget is installed. Run: sudo apt-get install -y curl"; fi
}

say "Downloading PyBI for $ARCH"
fetch "$URL" "$TMP/$FILE" || die "download failed. Check your internet connection and try again."
fetch "$URL.sha256" "$TMP/$FILE.sha256" || die "could not download the checksum."
say "Checking the download"
(cd "$TMP" && sha256sum -c --status "$FILE.sha256") || die "the download is damaged (checksum mismatch). Please try again."
chmod 644 "$TMP/$FILE"

SUDO=""
[ "$(id -u)" -eq 0 ] || SUDO="sudo"
say "Installing (you may be asked for your Linux password)"
$SUDO apt-get install -y "$TMP/$FILE"

say "PyBI is installed."
echo "    Open it from your app launcher (search for PyBI), or run: pybi-desktop"
