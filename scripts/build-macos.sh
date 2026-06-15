#!/bin/bash
# ============================================================
#  Little Gerry - Build the macOS installer (.pkg)
#  Precisian Medical Instruments / VACTOR program
#
#  Produces a per-user .pkg (installs to ~/Applications/Little Gerry)
#  containing the full source tree plus a "Little Gerry.app" launcher
#  stub. Mirrors the Windows Inno Setup installer.
#
#  Run ON A MAC from the project root:
#       bash scripts/build-macos.sh
#
#  Output: installer/Output/LittleGerry.pkg
#
#  Optional code signing + notarization (no-op if the env vars are
#  unset, so it builds fine without an Apple Developer account):
#       DEVELOPER_ID_INSTALLER="Developer ID Installer: Your Name (TEAMID)"
#       NOTARY_PROFILE="littlegerry"        # keychain profile from `notarytool store-credentials`
#  When set, the .pkg is signed with productsign, submitted to Apple's
#  notary service, and stapled.
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

APP_NAME="Little Gerry"
BUNDLE_ID="com.precisian.littlegerry"
INSTALL_LOCATION="Applications/Little Gerry"   # relative to the user's home at install time
VERSION="$(tr -d '[:space:]' < "$ROOT/VERSION" 2>/dev/null || echo 0.0.0)"

BUILD_DIR="$ROOT/installer/macos-build"
PAYLOAD="$BUILD_DIR/payload"
APP_DIR="$PAYLOAD/$APP_NAME.app"
OUTPUT_DIR="$ROOT/installer/Output"
COMPONENT_PKG="$BUILD_DIR/component.pkg"
FINAL_PKG="$OUTPUT_DIR/LittleGerry.pkg"

info() { printf '  %s\n' "$1"; }

echo "== Building $APP_NAME $VERSION (macOS .pkg) =="

# ── 1. Clean + stage the payload ────────────────────────────────────────────
rm -rf "$BUILD_DIR"
mkdir -p "$PAYLOAD" "$OUTPUT_DIR"

info "Staging source tree..."
rsync -a \
  --exclude '.git' \
  --exclude '**/.venv' \
  --exclude '**/node_modules' \
  --exclude 'frontend/dist' \
  --exclude 'frontend/src-tauri/target' \
  --exclude '**/__pycache__' \
  --exclude '**/*.pyc' \
  --exclude 'backend/logs/*' \
  --exclude 'backend/.env' \
  --exclude 'backend/google_token.json' \
  --exclude 'installer/macos-build' \
  --exclude 'installer/Output' \
  --include '*/' \
  --include '*' \
  "$ROOT/" "$PAYLOAD/"

# Strip the .git marker so the installed copy uses the release-based updater.
rm -rf "$PAYLOAD/.git" "$PAYLOAD/.gitignore"

# ── 2. Build the Little Gerry.app launcher stub ─────────────────────────────
info "Building $APP_NAME.app launcher..."
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources"

cat > "$APP_DIR/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>            <string>$APP_NAME</string>
  <key>CFBundleDisplayName</key>     <string>$APP_NAME</string>
  <key>CFBundleIdentifier</key>      <string>$BUNDLE_ID</string>
  <key>CFBundleVersion</key>         <string>$VERSION</string>
  <key>CFBundleShortVersionString</key> <string>$VERSION</string>
  <key>CFBundlePackageType</key>     <string>APPL</string>
  <key>CFBundleExecutable</key>      <string>launch</string>
  <key>CFBundleIconFile</key>        <string>AppIcon</string>
  <key>LSMinimumSystemVersion</key>  <string>12.0</string>
  <key>LSUIElement</key>             <false/>
  <key>NSHighResolutionCapable</key> <true/>
  <key>NSMicrophoneUsageDescription</key>
  <string>Little Gerry uses the microphone for voice conversations with the AI assistant.</string>
</dict>
</plist>
PLIST

cat > "$APP_DIR/Contents/MacOS/launch" <<'STUB'
#!/bin/bash
# Little Gerry.app launcher stub — runs the Start command from the install dir.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   # .../Contents/MacOS
APPROOT="$(cd "$HERE/../../.." && pwd)"                  # install dir (parent of the .app)
exec "$APPROOT/Start Little Gerry.command"
STUB
chmod +x "$APP_DIR/Contents/MacOS/launch"

# ── 3. Generate the app icon (.icns) from the PNG logo ──────────────────────
LOGO="$ROOT/Spaceman on Black BG.png"
if [ -f "$LOGO" ] && command -v iconutil >/dev/null 2>&1; then
  info "Generating app icon..."
  ICONSET="$BUILD_DIR/AppIcon.iconset"
  mkdir -p "$ICONSET"
  for s in 16 32 128 256 512; do
    sips -z "$s" "$s"          "$LOGO" --out "$ICONSET/icon_${s}x${s}.png"    >/dev/null 2>&1 || true
    sips -z "$((s*2))" "$((s*2))" "$LOGO" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null 2>&1 || true
  done
  iconutil -c icns "$ICONSET" -o "$APP_DIR/Contents/Resources/AppIcon.icns" 2>/dev/null || true
fi

# Make the bundled launcher scripts executable inside the payload.
chmod +x "$PAYLOAD/Start Little Gerry.command" \
         "$PAYLOAD/Stop Little Gerry.command" \
         "$PAYLOAD/scripts/apply_update.sh" \
         "$PAYLOAD/scripts/install.sh" \
         "$PAYLOAD/scripts/update.sh" 2>/dev/null || true

# ── 4. Post-install script (set perms, clear quarantine) ────────────────────
SCRIPTS_DIR="$BUILD_DIR/scripts"
mkdir -p "$SCRIPTS_DIR"
cat > "$SCRIPTS_DIR/postinstall" <<'POST'
#!/bin/bash
# Runs as the installing user (CurrentUserHomeDirectory target).
APPROOT="$HOME/Applications/Little Gerry"
chmod +x "$APPROOT/Start Little Gerry.command" \
         "$APPROOT/Stop Little Gerry.command" \
         "$APPROOT/scripts/"*.sh \
         "$APPROOT/Little Gerry.app/Contents/MacOS/launch" 2>/dev/null || true
# Clear the quarantine flag so Gatekeeper doesn't block the freshly-installed app.
xattr -dr com.apple.quarantine "$APPROOT" 2>/dev/null || true
exit 0
POST
chmod +x "$SCRIPTS_DIR/postinstall"

# ── 5. Build the component package ──────────────────────────────────────────
info "Running pkgbuild..."
pkgbuild \
  --root "$PAYLOAD" \
  --identifier "$BUNDLE_ID" \
  --version "$VERSION" \
  --scripts "$SCRIPTS_DIR" \
  --install-location "$INSTALL_LOCATION" \
  "$COMPONENT_PKG"

# ── 6. Build the distribution package (per-user home domain) ────────────────
DIST_XML="$BUILD_DIR/distribution.xml"
cat > "$DIST_XML" <<DIST
<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="2">
  <title>$APP_NAME</title>
  <organization>$BUNDLE_ID</organization>
  <domains enable_anywhere="false" enable_currentUserHome="true" enable_localSystem="false"/>
  <options customize="never" require-scripts="false" hostArchitectures="arm64"/>
  <choices-outline>
    <line choice="default"><line choice="$BUNDLE_ID"/></line>
  </choices-outline>
  <choice id="default"/>
  <choice id="$BUNDLE_ID" visible="false">
    <pkg-ref id="$BUNDLE_ID"/>
  </choice>
  <pkg-ref id="$BUNDLE_ID" version="$VERSION" onConclusion="none">component.pkg</pkg-ref>
</installer-gui-script>
DIST

info "Running productbuild..."
if [ -n "${DEVELOPER_ID_INSTALLER:-}" ]; then
  info "Signing with: $DEVELOPER_ID_INSTALLER"
  productbuild \
    --distribution "$DIST_XML" \
    --package-path "$BUILD_DIR" \
    --sign "$DEVELOPER_ID_INSTALLER" \
    "$FINAL_PKG"
else
  info "No DEVELOPER_ID_INSTALLER set — building UNSIGNED (ad-hoc)."
  info "  Other Macs will need: right-click the .pkg > Open, or xattr -dr com.apple.quarantine."
  productbuild \
    --distribution "$DIST_XML" \
    --package-path "$BUILD_DIR" \
    "$FINAL_PKG"
fi

# ── 7. Notarize + staple (only when a notary profile is configured) ─────────
if [ -n "${DEVELOPER_ID_INSTALLER:-}" ] && [ -n "${NOTARY_PROFILE:-}" ]; then
  info "Submitting to Apple notary service (profile: $NOTARY_PROFILE)..."
  # In CI the profile is stored in a throwaway keychain (NOTARY_KEYCHAIN); locally
  # it lives in the default credential store and no --keychain flag is needed.
  if [ -n "${NOTARY_KEYCHAIN:-}" ]; then
    xcrun notarytool submit "$FINAL_PKG" --keychain-profile "$NOTARY_PROFILE" \
      --keychain "$NOTARY_KEYCHAIN" --wait
  else
    xcrun notarytool submit "$FINAL_PKG" --keychain-profile "$NOTARY_PROFILE" --wait
  fi
  info "Stapling notarization ticket..."
  xcrun stapler staple "$FINAL_PKG"
else
  info "Skipping notarization (set DEVELOPER_ID_INSTALLER + NOTARY_PROFILE to enable)."
fi

echo
echo "== Done: $FINAL_PKG (version $VERSION) =="
