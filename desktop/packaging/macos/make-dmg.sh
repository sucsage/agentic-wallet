#!/bin/bash
# Wraps a built macOS executable in MilestonePay.app and a .dmg (drag to Applications).
#   packaging/macos/make-dmg.sh <arm64|x64> <version>     (run from desktop/, on macOS)
set -euo pipefail
ARCH=$1; VERSION=$2
BIN=dist/AgenticWallet-macos-$ARCH
WORK=$(mktemp -d)
APP="$WORK/MilestonePay.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/MilestonePay"
chmod 755 "$APP/Contents/MacOS/MilestonePay"
cp packaging/icons/icon.icns "$APP/Contents/Resources/MilestonePay.icns"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>MilestonePay</string>
  <key>CFBundleDisplayName</key><string>MilestonePay</string>
  <key>CFBundleIdentifier</key><string>app.milestonepay.desktop</string>
  <key>CFBundleExecutable</key><string>MilestonePay</string>
  <key>CFBundleIconFile</key><string>MilestonePay</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <!-- No Dock icon: the app is a local server with its screen in the browser (Settings → Quit stops it). -->
  <key>LSUIElement</key><true/>
</dict></plist>
PLIST
# No Apple Developer ID: the executable keeps its own ad-hoc signature and the bundle is not sealed,
# so the in-app updater can replace the executable. macOS asks once (System Settings → Privacy &
# Security → Open Anyway, or right-click → Open).
STAGE="$WORK/dmg"; mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
OUT="dist/MilestonePay-$VERSION-macos-$ARCH.dmg"
rm -f "$OUT"
hdiutil create -volname "MilestonePay $VERSION" -srcfolder "$STAGE" -ov -format UDZO "$OUT" >/dev/null
echo "$OUT"
