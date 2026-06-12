# Installing Little Gerry

Little Gerry ships as a native installer for **Windows 11** and **macOS (Apple Silicon)**.
Both installers are attached to every GitHub release: <https://github.com/soulenya/pmi-agent/releases/latest>

| Platform | Asset | Trust mechanism |
|---|---|---|
| Windows 11 | `LittleGerry_Setup.exe` | Self-signed publisher certificate — install once via `Trust-Little-Gerry.bat` |
| macOS 12+ (Apple Silicon) | `LittleGerry.pkg` | Currently unsigned — open via right-click → Open (Gatekeeper bypass) |

---

## Windows 11

### 1. Trust the publisher (one-time per machine)

The installer is signed with Precisian Medical Instruments' internal code-signing
certificate. Windows doesn't know this publisher yet, so install the certificate once:

1. Download **`Trust-Little-Gerry.bat`** from the release assets.
2. Right-click it → **Run as administrator**.
3. Approve the UAC prompt. You should see a success message.

This adds the publisher certificate to the machine's trusted store so
SmartScreen and antivirus treat Little Gerry as a known publisher — for this
install and every future update.

### 2. Install

1. Download **`LittleGerry_Setup.exe`** from the release assets.
2. Double-click it and follow the wizard.
3. If SmartScreen still shows *"Windows protected your PC"*: click
   **More info → Run anyway** (only happens if step 1 was skipped).

### 3. Launch

Use the Start Menu or desktop shortcut. The first launch performs a one-time
setup (database, dependencies) and then opens the app window. Updates are
delivered in-app — no need to revisit this page.

---

## macOS (Apple Silicon, macOS 12 or later)

### 1. Open the installer past Gatekeeper

The `.pkg` is currently **unsigned** (Apple Developer ID signing is pending),
so macOS blocks a normal double-click with *"cannot be opened because it is
from an unidentified developer."* Use any one of these:

- **Right-click method (easiest):** in Finder, Control-click (right-click)
  `LittleGerry.pkg` → **Open** → click **Open** in the dialog.
- **System Settings method:** double-click the .pkg (it gets blocked), then go to
  **System Settings → Privacy & Security**, scroll down, and click **Open Anyway**.
- **Terminal method:**
  ```bash
  xattr -d com.apple.quarantine ~/Downloads/LittleGerry.pkg
  open ~/Downloads/LittleGerry.pkg
  ```

### 2. Install

Follow the installer wizard. Everything is installed **per-user** to
`~/Applications/Little Gerry` — no admin password is required.

### 3. Install prerequisites (fresh Mac only, one-time)

Little Gerry needs Docker Desktop, Node.js 20, and uv. On a Mac that has never
run Little Gerry before, run this once in Terminal:

```bash
bash "$HOME/Applications/Little Gerry/scripts/install.sh"
```

This installs Homebrew (if missing) and all prerequisites, starts the
database, and prepares the app. Skip this step if the prerequisites are
already present.

### 4. Launch

Open **Little Gerry.app** inside `~/Applications/Little Gerry`
(drag it to the Dock for quick access).

First-run permission prompts — click **Allow** for each:

| Prompt | Why |
|---|---|
| **Keychain** access | Stores API keys and Google OAuth tokens securely |
| **Microphone** | Voice conversations (only asked the first time you use voice) |

If you deny the microphone by accident, re-enable it under
**System Settings → Privacy & Security → Microphone → Little Gerry**.

Updates are delivered in-app on both platforms.

---

## Troubleshooting

- **Windows — installer flagged by antivirus:** run `Trust-Little-Gerry.bat`
  as administrator first, then re-run the installer.
- **macOS — ".pkg is damaged and can't be opened":** the quarantine flag is
  set; use the Terminal method above.
- **macOS — app starts but no window appears:** make sure Docker Desktop is
  installed and running, then relaunch.
- **Either platform — Google features not working:** open
  **Settings → Google → Connect** inside the app and complete the sign-in.
