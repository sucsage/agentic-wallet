#!/bin/bash
# Builds a .deb from a built Linux executable.
#   packaging/linux/make-deb.sh <x64|arm64> <version>     (run from desktop/, needs dpkg-deb)
set -euo pipefail
ARCH=$1; VERSION=$2
DEBARCH=$([ "$ARCH" = x64 ] && echo amd64 || echo arm64)
ROOT=$(mktemp -d)/milestonepay
mkdir -p "$ROOT/DEBIAN" "$ROOT/opt/milestonepay" "$ROOT/usr/bin" "$ROOT/usr/share/applications" "$ROOT/usr/share/icons/hicolor/512x512/apps"
install -m 755 "dist/AgenticWallet-linux-$ARCH" "$ROOT/opt/milestonepay/milestonepay"
ln -s /opt/milestonepay/milestonepay "$ROOT/usr/bin/milestonepay"
install -m 644 packaging/icons/icon.png "$ROOT/usr/share/icons/hicolor/512x512/apps/milestonepay.png"
cat > "$ROOT/usr/share/applications/milestonepay.desktop" <<DESK
[Desktop Entry]
Type=Application
Name=Kravii
Comment=Milestone payments with your own deal chain (test mode)
Exec=/opt/milestonepay/milestonepay
Icon=milestonepay
Terminal=false
Categories=Office;Finance;
DESK
cat > "$ROOT/DEBIAN/control" <<CTRL
Package: milestonepay
Version: $VERSION
Section: misc
Priority: optional
Architecture: $DEBARCH
Maintainer: Kravii team <noreply@github.com>
Homepage: https://agentic-wallet-inky.vercel.app/download
Description: Kravii desktop app (FinTechathon 2026 demo, test money only)
 Holds your deals as your own signed chain on this computer; the money stays in the
 escrow smart contract. Its screen opens in your browser.
CTRL
OUT="dist/milestonepay_${VERSION}_${DEBARCH}.deb"
dpkg-deb --build --root-owner-group "$ROOT" "$OUT" >/dev/null
echo "$OUT"
