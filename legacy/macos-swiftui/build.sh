#!/bin/bash
# Builds Rackbook.app and an overwrite-install package Rackbook-<version>.pkg.
# Needs Xcode or the Command Line Tools (swift 5.9+), macOS 14+.
set -euo pipefail
cd "$(dirname "$0")"

VERSION="1.4.1"
BUILD="$(date +%Y%m%d%H%M)"          # always newer, so the installer replaces the old copy
APP="Rackbook.app"
DIST="dist"
PKG="Rackbook-${VERSION}.pkg"

echo "▸ swift build (release)…"
swift build -c release
BIN="$(swift build -c release --show-bin-path)/Rackbook"

echo "▸ assembling ${APP}…"
rm -rf "$APP" "$DIST" Rackbook-*.pkg
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/Rackbook"
iconutil -c icns Resources/AppIcon.iconset -o "$APP/Contents/Resources/AppIcon.icns"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Rackbook</string>
  <key>CFBundleDisplayName</key><string>Rackbook</string>
  <key>CFBundleIdentifier</key><string>local.rackbook.app</string>
  <key>CFBundleExecutable</key><string>Rackbook</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundleVersion</key><string>${BUILD}</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.developer-tools</string>
</dict>
</plist>
PLIST
codesign --force --deep --sign - "$APP"

echo "▸ packaging ${PKG}（覆盖安装到 /Applications）…"
mkdir -p "$DIST/root/Applications" "$DIST/scripts"
cp -R "$APP" "$DIST/root/Applications/"

# Quit a running copy before the files are replaced.
cat > "$DIST/scripts/preinstall" <<'SH'
#!/bin/sh
/usr/bin/pkill -x Rackbook 2>/dev/null || true
sleep 1
exit 0
SH
chmod +x "$DIST/scripts/preinstall"

# Non-relocatable, not version-checked, upgrade: always lands in /Applications/Rackbook.app,
# replacing whatever is there.
cat > "$DIST/component.plist" <<'CP'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<array>
  <dict>
    <key>BundleHasStrictIdentifier</key><true/>
    <key>BundleIsRelocatable</key><false/>
    <key>BundleIsVersionChecked</key><false/>
    <key>BundleOverwriteAction</key><string>upgrade</string>
    <key>RootRelativeBundlePath</key><string>Applications/Rackbook.app</string>
  </dict>
</array>
</plist>
CP

pkgbuild --root "$DIST/root" \
         --component-plist "$DIST/component.plist" \
         --scripts "$DIST/scripts" \
         --identifier local.rackbook.app \
         --version "$VERSION.$BUILD" \
         --install-location / \
         "$DIST/Rackbook-component.pkg" >/dev/null

productbuild --package "$DIST/Rackbook-component.pkg" "$PKG" >/dev/null
rm -rf "$DIST"

echo "✓ $(pwd)/$APP"
echo "✓ $(pwd)/$PKG"
echo "  双击 $PKG 安装（会覆盖 /Applications/Rackbook.app），或："
echo "  sudo installer -pkg \"$PKG\" -target /"
