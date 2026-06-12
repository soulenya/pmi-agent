# Little Gerry on macOS (Apple Silicon)

Status and operating guide for the macOS port. Windows 11 remains the protected
production baseline — everything macOS-specific here is **additive**; the Windows
packaging, signing, launcher, and auto-update pipelines are untouched.

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
| Tray | pystray | none (Cocoa tray needs the main thread pywebview owns); window close + in-app ServiceMenu cover stop/restart/update |
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

## Code signing & notarization (prerequisite not yet met)

PMI's Authenticode certificate does **not** apply to macOS. A proper end-user
deliverable requires an **Apple Developer Program membership** ($99/yr) and a
**Developer ID Installer** certificate. `scripts/build-macos.sh` already supports
it — signing/notarization are no-ops until these env vars are set:

```bash
export DEVELOPER_ID_INSTALLER="Developer ID Installer: Precisian Medical Instruments (TEAMID)"
export NOTARY_PROFILE="littlegerry"   # created once via:
# xcrun notarytool store-credentials littlegerry \
#   --apple-id <appleid> --team-id <TEAMID> --password <app-specific-password>
bash scripts/publish-macos.sh
```

When set, the `.pkg` is signed with `productsign`, submitted with `notarytool`,
and the ticket stapled. **Until then, builds are unsigned and not a customer
deliverable** — Gatekeeper will block them on machines with default settings.

## Release flow (both platforms, one tag)

1. On Windows: `scripts\publish-release.ps1 -Version X.Y.Z -Notes "…"` — bumps
   VERSION, builds + signs the `.exe`, creates the GitHub release `vX.Y.Z`.
2. On the Mac: `git pull`, then `bash scripts/publish-macos.sh` — builds the
   `.pkg` (signing/notarizing if configured) and attaches it to the same release.

The launcher's updater picks the right asset per platform
(`LittleGerry_Setup.exe` on Windows, `LittleGerry.pkg` on macOS) and applies it
by replacing the whole install dir contents via the platform's apply script —
never patching files inside a signed bundle.

## Items requiring verification on real Apple Silicon hardware

Not provable from a Windows dev box; check these on the first Mac bring-up:

- [ ] `cd backend && uv sync` resolves every dependency to a native arm64 wheel
      (pywebview must pull its PyObjC extras on macOS).
- [ ] launcher.py runs as a native arm64 process (Activity Monitor → no "(Rosetta)";
      `arch` prints `arm64`). Note: uv's python-build-standalone is not a framework
      build — if the pywebview window misbehaves (no focus/menu), retry with a
      framework Python (`brew install python` + `uv venv --python /opt/homebrew/bin/python3`).
- [ ] WKWebView: WebSocket streaming chat, MediaRecorder voice capture, and the
      `getUserMedia` permission flow inside the embedded view. If pywebview does not
      grant the WKWebView media-capture permission callback, patch the Cocoa
      delegate in launcher.py (platform-gated).
- [ ] Mic TCC attribution: launching via `Little Gerry.app` must attribute the mic
      to the bundle (whose plist has the usage string). Launching via the bare
      `.command` in Terminal attributes to Terminal instead — fine for dev,
      document for users.
- [ ] Full voice round-trip (record → STT → agent → TTS → playback).
- [ ] Google OAuth browser handoff (`open <url>`) and Keychain-backed token storage.
- [ ] Ollama native install with Metal acceleration; provider works for local models.
- [ ] `showSaveFilePicker` is unavailable in WKWebView — SaveFileDialog must take
      its Downloads-folder fallback path gracefully.
- [ ] Auto-update end-to-end: old `.pkg` install → new release → silent update →
      relaunch (`backend/logs/apply_update.log`).
