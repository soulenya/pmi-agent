#!/bin/bash
# ============================================================
#  Little Gerry - Publish the macOS installer to GitHub Releases
#  Precisian Medical Instruments / VACTOR program
#
#  Builds LittleGerry.pkg (via build-macos.sh) and attaches it to the
#  GitHub release for the current VERSION. The Windows .exe and the
#  macOS .pkg live on the SAME release/tag (vX.Y.Z).
#
#  Run ON A MAC from the project root, after `gh auth login`:
#       bash scripts/publish-macos.sh
#
#  Typical full-parity release flow:
#    1. On Windows: scripts/publish-release.ps1 -Version X.Y.Z -Notes "..."
#       (bumps VERSION, builds+signs the .exe, creates the GitHub release).
#    2. git pull on the Mac, then run this script to add the .pkg.
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

VERSION="$(tr -d '[:space:]' < "$ROOT/VERSION")"
TAG="v$VERSION"
PKG="$ROOT/installer/Output/LittleGerry.pkg"

command -v gh >/dev/null 2>&1 || { echo "[XX] GitHub CLI (gh) not found. Install with: brew install gh" >&2; exit 1; }

echo "== Publishing macOS build for $TAG =="

# 1. Build the .pkg (honours DEVELOPER_ID_INSTALLER / NOTARY_PROFILE if set).
bash "$SCRIPT_DIR/build-macos.sh"
[ -f "$PKG" ] || { echo "[XX] Build did not produce $PKG" >&2; exit 1; }

# 2. Ensure the release exists, then upload the .pkg.
if gh release view "$TAG" >/dev/null 2>&1; then
  echo "  Uploading LittleGerry.pkg to existing release $TAG..."
  gh release upload "$TAG" "$PKG" --clobber
else
  echo "  Release $TAG not found — creating it (macOS-only release)."
  gh release create "$TAG" "$PKG" \
    --title "Little Gerry $VERSION" \
    --notes "macOS build for $VERSION."
fi

echo
echo "== Done: attached LittleGerry.pkg to $TAG =="
