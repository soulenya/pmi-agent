# Implementation Prompt: Port Little Gerry from Windows to macOS (Apple Silicon)

## Context

You are porting **Little Gerry**, an AI executive assistant desktop application for PMI, from Windows to **macOS on Apple M-series (arm64) silicon**. The goal is a fully native arm64 build — do not rely on Rosetta 2 for any component you control.

The stack:

**Frontend**
- React 18 + TypeScript, built with Vite; Tailwind CSS (shadcn-style components), lucide-react
- Zustand (UI state) + TanStack React Query (server state); React Router
- WebSocket streaming chat; MediaRecorder for voice capture
- Runs inside a **pywebview** desktop shell

**Backend**
- Python 3.14, FastAPI + Uvicorn (REST + WebSockets)
- SQLAlchemy 2 (async) + Alembic migrations; Pydantic
- Dependency management via **uv** (never pip)

**Database**
- PostgreSQL 16 in Docker (container `pmi_postgres`) with pgvector
- Append-only, hash-chained `audit_events` table

**AI / Agents**
- LLM providers: Anthropic (default), OpenAI, Ollama — per-task routing via `system_settings`
- Embeddings: Voyage / OpenAI / Ollama
- v1 legacy `AgentExecutor` + v2 LangGraph supervisor with 8 specialists; ~36 tools (ddgs web search, Google Workspace, file generation, custodian tools, etc.)

**Voice**
- Google Cloud Speech-to-Text + Text-to-Speech (MP3, Neural2 voices)

**Integrations / Security**
- Google Workspace OAuth (Gmail, Drive, Calendar, Sheets), tokens Fernet-encrypted
- Secrets stored in the **OS keyring** (never files or env vars)

**Packaging / Distribution (current, Windows-only)**
- Inno Setup installer, Authenticode-signed with the PMI certificate
- GitHub Releases drive auto-update; a launcher runs `uv sync` + `alembic upgrade` + `npm install` on every start
- PowerShell publish pipeline

## Goal

Produce a maintainable **single cross-platform codebase** (not a macOS fork) that runs natively on Apple Silicon, with platform-specific behavior isolated behind a thin abstraction layer (e.g., a `platform/` module exposing paths, keyring backend, process launch, installer hooks). Windows must continue to work after this change. Zero loss of functionality on either platform.

## Non-Negotiable: Windows 11 Is the Protected Baseline

The current Windows 11 build is **working production software**. Nothing in this port may change its behavior. Treat Windows as frozen:

- **Do all work on a dedicated branch.** Tag the current commit as the Windows baseline before touching anything, so a known-good state is always one checkout away.
- **Minimal-touch rule for shared code:** modify code that Windows executes *only* when strictly necessary for the port (e.g., replacing a hardcoded path with a platform-aware call). When you must, the change must be **behavior-preserving on Windows** — same paths resolved, same keyring entries, same outputs, byte-for-byte where applicable.
- **Prefer additive changes:** new macOS implementations live in new files/modules behind the platform abstraction; the Windows code path should, wherever possible, be the *existing* code, not a rewrite of it.
- **Every Windows-affecting change must be individually logged** in your final report: file, what changed, why it was unavoidable, and how Windows-equivalence was verified.
- **No dependency upgrades on the Windows side** unless a package is genuinely broken for the port — pin existing versions; do not opportunistically bump anything.
- **Windows packaging, signing, launcher, and auto-update are untouched:** the Inno Setup script, Authenticode signing, PowerShell publish pipeline, and the Windows launcher keep working exactly as they do today. macOS gets parallel additions, not replacements.
- **Regression gates:** after the platform-abstraction step and again before final delivery, the full application must be verified on Windows 11 with no behavioral change — including paths/data locations (existing user data must be found exactly where it was), Credential Locker entries, OAuth tokens, the audit chain, and auto-update.
- If at any point a macOS requirement appears to force a Windows behavior change, **stop and ask** rather than proceeding.

## Phase 0 — Audit Before Changing Anything

Before writing code, sweep the entire repository and produce a written inventory of every Windows assumption. Search for at minimum:

- Hardcoded path separators, drive letters (`C:\`), `%APPDATA%`, `%LOCALAPPDATA%`, `%USERPROFILE%`, `os.environ['APPDATA']`
- `winreg`, `pywin32` / `win32api` / `win32com`, `ctypes.windll`, `.bat` / `.cmd` / `.exe` invocations, `subprocess` calls with `shell=True` that assume cmd/PowerShell, `CREATE_NO_WINDOW` / `startupinfo` flags
- PowerShell scripts (publish pipeline, launcher, any tooling)
- pywebview GUI backend selection (EdgeChromium/WebView2 assumptions)
- Keyring backend assumptions (Windows Credential Locker specifics)
- Inno Setup scripts, Authenticode signing steps, auto-update logic that downloads `.exe` installers
- Any dependency in `pyproject.toml` / `package.json` that is Windows-only or lacks arm64 macOS wheels (check each native-extension package)
- Audio/microphone handling outside the browser layer, file-association or registry-based settings, Windows service or startup-folder logic

List each finding with file/line and the planned remediation. Do not skip this phase.

## Conversion Areas

### 1. Paths and App Data
- Replace all hardcoded/Windows-specific paths with `pathlib` + **`platformdirs`**: config → `~/Library/Application Support/LittleGerry`, logs → `~/Library/Logs/LittleGerry`, cache → `~/Library/Caches/LittleGerry` (platformdirs handles all of this per-OS).
- **On Windows, the resolved paths must remain exactly what they are today** — existing installs must find their config, database connection settings, logs, and generated files in the same locations with no migration. If platformdirs' defaults differ from the app's current Windows locations, override to preserve the current locations rather than moving Windows data.
- macOS initializes cleanly into its standard locations; no data migration logic on Windows at all.

### 2. pywebview Shell
- On macOS, pywebview uses the **Cocoa/WKWebView** backend via PyObjC. Verify required extras are installed (`pywebview` pulls `pyobjc` on macOS) and that the WebSocket streaming chat, file dialogs, and any JS↔Python bridge calls behave identically under WKWebView.
- WKWebView is stricter than WebView2 about media: confirm MediaRecorder microphone capture works, including `getUserMedia` permission flow inside the embedded view.
- Check for any WebView2-specific flags, user-agent sniffing, or `--enable-features` switches and gate them by platform.

### 3. Keyring / Secrets
- The `keyring` library maps to **macOS Keychain** automatically — verify every secret read/write path works, and that no code assumes Windows Credential Locker naming or behavior.
- Fernet-encrypted OAuth tokens are portable; confirm the encryption key itself lives in the Keychain on macOS.
- Document that the first run will prompt Keychain access dialogs; the app must handle "deny" gracefully.

### 4. Microphone & macOS Permissions (TCC)
- The app bundle's `Info.plist` must include `NSMicrophoneUsageDescription` (and any other required usage strings). Without it, macOS will hard-kill the process on mic access.
- Voice capture must trigger the system permission prompt once, then work normally. Handle the denied state with a clear in-app message pointing to System Settings → Privacy & Security → Microphone.

### 5. PostgreSQL / Docker
- Docker Desktop (or OrbStack/Colima — pick one and document it) on Apple Silicon: use **arm64 images**. The `pgvector/pgvector:pg16` image publishes arm64; pin the digest. No `--platform linux/amd64` emulation.
- Verify the launcher's container start/health-check logic uses cross-platform commands (no PowerShell-isms).

### 6. Python 3.14 + Dependencies (uv)
- `uv sync` on arm64 macOS: verify every dependency resolves to a native arm64 wheel or builds cleanly. Flag and resolve any package without arm64 support (substitute or vendor a fix); list these explicitly in your report.
- Anything using `pywin32`/`win32com` must be replaced with a cross-platform equivalent or moved behind the platform abstraction with a macOS implementation.

### 7. Ollama (local tier)
- Ollama runs natively on Apple Silicon with Metal acceleration. Verify the provider integration works against a local install and against a LAN host; no code change is expected beyond endpoint configuration, but confirm.

### 8. Launcher & Auto-Update
- Rewrite the launcher logic (currently `uv sync` + `alembic upgrade` + `npm install` on every start) as either a cross-platform Python entry point or parallel platform scripts (`.ps1` stays for Windows; add a `zsh`/`bash` or Python equivalent for macOS).
- Auto-update: GitHub Releases must now publish **per-platform artifacts**. The updater must detect OS/arch and download the right one. macOS updates that replace the `.app` bundle must preserve code-signature validity (replace the whole bundle atomically; never patch files inside a signed bundle).

### 9. Packaging, Signing, Notarization
- Replace Inno Setup on macOS with a proper **`.app` bundle** (PyInstaller, Briefcase, or py2app — evaluate and justify the choice given Python 3.14 support) distributed as a **DMG** (or signed `.pkg` if installer logic is genuinely needed).
- Sign with an Apple **Developer ID Application** certificate (PMI's Authenticode cert does not apply to macOS — flag this as a prerequisite the team must obtain via an Apple Developer Program membership), enable the **Hardened Runtime**, add required entitlements (`com.apple.security.device.audio-input` for the mic; network client; any others surfaced in testing).
- **Notarize** with `notarytool` and staple the ticket. An unsigned/un-notarized build is not a deliverable — Gatekeeper will block it for end users.
- Extend the publish pipeline: keep the PowerShell path for Windows; add a macOS path (shell script or GitHub Actions job on a `macos-14`+ arm64 runner) that builds, signs, notarizes, staples, and uploads to the GitHub Release.

### 10. Frontend
- The React/Vite/Tailwind frontend is platform-agnostic; expect zero changes beyond: keyboard shortcut conventions (⌘ vs Ctrl — map via `navigator.platform`/userAgentData and present the right glyphs), scrollbar/overscroll styling differences under WKWebView, and any download/file-save flows that assumed Windows dialogs.

## Hard Constraints

1. **One codebase, both platforms.** Platform-specific code lives behind a clearly named abstraction; no scattered `if sys.platform == 'win32'` checks in business logic.
2. **Zero functionality loss** on Windows or macOS: all 8 specialist agents, ~36 tools, Google Workspace OAuth, voice round-trip (record → STT → agent → TTS → playback), knowledge base/pgvector search, audit trail, and auto-update must work on both.
3. **Native arm64 end to end** — Python, all wheels, Node toolchain, Docker images, packaged app. No Rosetta for first-party components.
4. **Security posture unchanged:** secrets only in the OS keyring (Keychain on macOS), tokens Fernet-encrypted, audit chain untouched.
5. **Tooling discipline:** `uv` (never pip), Alembic for any schema changes (none expected), TypeScript on the frontend.

## Suggested Order

1. Phase 0 audit and remediation plan (deliver the inventory before code changes).
2. Platform abstraction layer + paths/platformdirs migration; verify Windows still passes.
3. Backend boots on macOS: uv sync, Docker/Postgres arm64, Alembic, FastAPI, keyring/Keychain.
4. pywebview Cocoa shell runs the built frontend; JS↔Python bridge and WebSocket chat verified.
5. Voice round-trip on macOS, including Info.plist usage strings and TCC permission flow.
6. Launcher + auto-update made cross-platform.
7. `.app` bundling, Developer ID signing, Hardened Runtime entitlements, notarization, DMG.
8. Publish pipeline extended; produce signed artifacts for both platforms from one release tag.
9. Full regression pass on Windows.

## Acceptance Criteria

- [ ] Phase 0 inventory delivered: every Windows-specific assumption listed with remediation.
- [ ] App launches on an Apple Silicon Mac as a native arm64 process (verify with `arch`/Activity Monitor — no Rosetta).
- [ ] Postgres 16 + pgvector runs in an arm64 container; migrations apply; semantic search works.
- [ ] Streaming text chat and full voice round-trip work, with correct macOS microphone permission flow.
- [ ] Google Workspace OAuth completes; tokens encrypted and keys held in macOS Keychain.
- [ ] All agents and tools function identically to the Windows build.
- [ ] Launcher performs `uv sync` + `alembic upgrade` + `npm install` (or build-time equivalent) on macOS.
- [ ] Signed, notarized, stapled `.app`/DMG installs and launches cleanly on a fresh macOS machine with Gatekeeper enabled.
- [ ] Auto-update detects platform/arch and updates the macOS bundle without breaking its signature.
- [ ] Windows build still passes a full regression test from the same codebase, **with zero behavioral change**: existing user data, config, logs, Credential Locker secrets, and OAuth tokens are found and used exactly as before — an existing Windows 11 install updated to this version notices nothing.
- [ ] The final report includes the complete log of every Windows-affecting code change with justification and verification notes.
- [ ] Windows packaging, signing, launcher, and auto-update pipelines are byte-identical in behavior (Inno Setup, Authenticode, PowerShell pipeline untouched except for additive macOS jobs).
- [ ] A `docs/macos.md` (or equivalent) documents prerequisites: Docker runtime choice, Apple Developer ID setup, notarization credentials, and first-run permission prompts.

Begin with Phase 0. Present the audit findings and your remediation plan, ask about anything ambiguous (especially the launcher internals and any custodian/file-generation tools that may touch Windows APIs), and only then start converting.
