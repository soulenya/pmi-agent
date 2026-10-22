# Little Gerry on macOS (Apple Silicon)

Operating guide for the macOS build (current as of 5.26.1). Windows remains the
primary platform — everything macOS-specific is **additive**; the Windows
packaging, signing, launcher and auto-update pipelines are untouched.

## Architecture (same as Windows)

The app installs as a source tree (default: `~/Applications/Little Gerry`) and all
data lives **relative to the install directory** — `backend/logs`, `backend/.env`,
`backend/google_token.json`, the Postgres Docker volume, generated files. There is
no platformdirs-style relocation on either OS; this is deliberate so existing
Windows installs keep their data exactly where it is.

| Concern | Windows | macOS |
|---|---|---|
| Install | Inno Setup `LittleGerry_Setup.exe` (Authenticode-signed) | `LittleGerry.pkg` (per-user, home domain) via `scripts/build-macos.sh` |
| Launch | `Start Little Gerry.bat` / launcher.py (pythonw) | `Little Gerry.app` stub → `Start Little Gerry.command` → launcher.py |
| Webview | pywebview `winforms` (Edge WebView2) | pywebview Cocoa (WKWebView via PyObjC, auto-selected) |
| Tray | pystray | none (Cocoa tray needs the main thread pywebview owns); closing the window quits; in-app ServiceMenu covers restart/update |
| Auto-update | Downloads `LittleGerry_Setup.exe`, hands off to `scripts/apply_update.ps1` | Downloads `LittleGerry.pkg`, hands off to `scripts/apply_update.sh` (silent `installer -pkg … -target CurrentUserHomeDirectory`, no sudo) |
| Secrets | Windows Credential Locker via `keyring` | macOS Keychain via `keyring` (same service/entry names) |
| Publish | `scripts/publish-release.ps1` (creates the GitHub release) | `scripts/publish-macos.sh` (attaches the `.pkg` to the **same** vX.Y.Z release) |

## Prerequisites

1. **Apple Silicon Mac** (M-series), macOS 12+.
2. **Docker Desktop for Apple Silicon** (chosen runtime; installed automatically by
   `scripts/install.sh` via Homebrew). Postgres uses `pgvector/pgvector:pg16`
   pinned in `docker-compose.yml` to a multi-arch digest (amd64 + arm64) — the
   identical image Windows runs, native on both. No `--platform` emulation.
3. **uv** — manages Python itself; `backend/.python-version` pins **3.14**
   (matching Windows). `uv sync` downloads a native arm64 interpreter and wheels.
   Never use pip.
4. **Node.js 20 LTS** (Homebrew arm64 build).

Fresh-machine setup: `bash scripts/install.sh` from the project root, then
double-click `Start Little Gerry.command` (or `Little Gerry.app` on installed copies).

## First-run permission prompts

- **Keychain**: the first secret read/write (JWT secret, Fernet key, API keys)
  may prompt for Keychain access. If denied, the app cannot decrypt OAuth tokens —
  re-grant under Keychain Access or relaunch and allow.
- **Microphone**: the `.app` bundle's Info.plist carries
  `NSMicrophoneUsageDescription` (added in `scripts/build-macos.sh`). The first
  voice session triggers the system mic prompt once. If denied, voice capture
  fails silently in the page — re-enable under
  System Settings → Privacy & Security → Microphone → Little Gerry.
- **Gatekeeper**: the pkg postinstall clears the quarantine attribute on the
  install dir. Unsigned builds may still warn on the `.pkg` itself
  (right-click → Open) until Developer ID signing is configured (below).

## Code signing & notarization

PMI's Authenticode certificate does **not** apply to macOS. Since June 2026 PMI
holds an Apple Developer Program membership and a **Developer ID Installer**
certificate, and `.github/workflows/macos-release.yml` signs, notarizes and
staples every release's `.pkg` on a GitHub `macos-latest` runner (Apple
silicon) from five repository secrets: `MACOS_CERT_P12_BASE64`,
`MACOS_CERT_PASSWORD`, `MACOS_NOTARY_APPLE_ID`, `MACOS_NOTARY_PASSWORD`
(app-specific), `MACOS_NOTARY_TEAM_ID`. When the secrets are absent — a new
company's fork before it joins the program — the workflow still builds and
attaches an **unsigned** `.pkg`; Gatekeeper then needs right-click → Open
once. The first notarization on a new account can take 40 minutes.

Locally, `scripts/build-macos.sh` signs/notarizes only when these are set:

```bash
export DEVELOPER_ID_INSTALLER="Developer ID Installer: <Company> (TEAMID)"
export NOTARY_PROFILE="littlegerry"   # created once via:
# xcrun notarytool store-credentials littlegerry \
#   --apple-id <appleid> --team-id <TEAMID> --password <app-specific-password>
bash scripts/publish-macos.sh
```

## Release flow (both platforms, one tag)

1. On Windows: the release recipe in DEVELOPER_GUIDE.md §14 builds and signs
   the `.exe`, deploys the hub, and runs `gh release create vX.Y.Z`.
2. The `macos-release.yml` workflow fires on *release published*, checks out
   the tag, runs `scripts/build-macos.sh`, and uploads `LittleGerry.pkg` to the
   same release. `workflow_dispatch` with a tag back-fills an older release.

The launcher's updater picks the right asset per platform
(`<setup_name>.exe` on Windows, `<pkg_name>.pkg` on macOS) and applies it
by replacing the whole install dir contents via the platform's apply script —
never patching files inside a signed bundle.

## Status on real Apple Silicon hardware (Noctu, October 2026)

The first production Mac install was a white-label customer's MacBook Air.
Verified working: `uv sync` to native arm64 wheels, the Cocoa window,
Docker-backed Postgres, Google OAuth hand-off, Keychain-backed secrets,
self-update via the `.pkg`. Fixed from their reports (5.26.0–5.26.1):

- Services start in their own process group and are killed as a group, so
  nothing is left running after quit; teardown also runs on SIGTERM/SIGHUP.
- Closing the window quits without a confirmation dialog — a modal inside
  app termination deadlocked Cocoa (spinning cursor, Force Quit).
- A saved window position is restored only when it lies inside the primary
  screen; one on a second display crashed pywebview's `windowDidMove`. If
  window creation still fails the launcher clears the saved state and
  relaunches itself once.
- The `.app` stub falls back to `~/Applications/<install dir>` when the bundle
  has been dragged elsewhere, and shows an alert instead of exiting silently.
- Links to generated files in chat download and open natively instead of
  navigating the window (WKWebView ignores the `download` attribute).
- Migrations read `backend/.env`, so a brand whose database role is not PMI's
  no longer fails on first launch.

Still to confirm on a Mac: a full voice round-trip (record → STT → agent →
TTS) and Ollama with Metal acceleration. There is no tray icon on macOS
(pywebview's Cocoa backend owns the main thread); close is quit.
