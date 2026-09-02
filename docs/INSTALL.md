# Installing Little Gerry

Little Gerry ships as a native installer for **Windows 11** and **macOS (Apple Silicon)**.
Both installers are attached to every GitHub release: <https://github.com/soulenya/pmi-agent/releases/latest>

| Platform | Asset | Trust mechanism |
|---|---|---|
| Windows 11 | `LittleGerry_Setup.exe` | Self-signed publisher certificate — install once via `Trust-Little-Gerry.bat` |
| macOS 12+ (Apple Silicon) | `LittleGerry.pkg` | Signed & notarized with an Apple Developer ID — opens normally |

> **Note:** for security, the installers do **not** include Google OAuth
> credentials. After installing, follow
> [Google OAuth credentials](#google-oauth-credentials) below to connect
> Gmail, Drive, Calendar, and Google sign-in.

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

### 1. Install

The `.pkg` is **signed and notarized** with an Apple Developer ID, so it opens
normally — just double-click **`LittleGerry.pkg`** and follow the installer
wizard. Everything is installed **per-user** to `~/Applications/Little Gerry` —
no admin password is required.

> If you downloaded the file through an unusual path and macOS still shows a
> Gatekeeper warning, Control-click (right-click) `LittleGerry.pkg` in Finder →
> **Open** → **Open**.

### 2. Install prerequisites (fresh Mac only, one-time)

Little Gerry needs Docker Desktop, Node.js 20, and uv. On a Mac that has never
run Little Gerry before, run this once in Terminal:

```bash
bash "$HOME/Applications/Little Gerry/scripts/install.sh"
```

This installs Homebrew (if missing) and all prerequisites, starts the
database, and prepares the app. Skip this step if the prerequisites are
already present.

### 3. Launch

Open **Little Gerry.app** inside `~/Applications/Little Gerry`
(drag it to the Dock for quick access).

First-run permission prompts — click **Allow** for each:

| Prompt | Why |
|---|---|
| **Keychain** access | Stores API keys and OAuth tokens securely |
| **Microphone** | Voice conversations (only asked the first time you use voice) |

If you deny the microphone by accident, re-enable it under
**System Settings → Privacy & Security → Microphone → Little Gerry**.

Updates are delivered in-app on both platforms.

---

## Google OAuth credentials

Little Gerry connects to Google (sign-in, Gmail, Drive, Calendar, Contacts)
using an OAuth client file named **`google_credentials.json`**. This file is
**not** bundled in the installers — you add it once after installing.

### Where the file goes

| Platform | Location |
|---|---|
| Windows | `<install folder>\backend\google_credentials.json` |
| macOS | `~/Applications/Little Gerry/backend/google_credentials.json` |

The file survives app updates — you only do this once per machine.

### Option A — PMI team members (recommended)

Ask your administrator for the company `google_credentials.json` file (it is
sent privately — never posted publicly). Copy it to the location above, then
launch Little Gerry and click **Sign in with Google**.

### Option B — Create your own (any Google account)

1. Go to the [Google Cloud Console](https://console.cloud.google.com) and sign in.
2. Create a project: top bar → project picker → **New Project** → name it
   (e.g. "Little Gerry") → **Create**.
3. Enable the APIs the app uses: **APIs & Services → Library**, search for and
   **Enable** each of:
   - Gmail API
   - Google Drive API
   - Google Calendar API
   - People API (contacts)
   - Google Sheets API
   - Google Docs API
   - Google Tasks API
4. Configure the consent screen: **APIs & Services → OAuth consent screen**
   - User type: **External** → Create
   - Fill in the app name ("Little Gerry") and your email; save through the steps.
   - Under **Test users**, click **Add users** and add your own Google email.
     (While the app is in "Testing" mode only listed test users can sign in —
     that's fine for personal use.)
5. Create the OAuth client: **APIs & Services → Credentials →
   Create Credentials → OAuth client ID**
   - Application type: **Desktop app**
   - Name: anything → **Create**
6. Click the **download icon (⬇)** next to the new client to download the JSON.
7. **Rename** the downloaded file to exactly `google_credentials.json` and move
   it to the location in the table above.
8. Launch Little Gerry → **Sign in with Google** (or Settings → Google →
   **Connect**). Your browser opens for consent — approve all permissions.
   - You may see *"Google hasn't verified this app"* — click
     **Advanced → Go to Little Gerry (unsafe)**. This is expected for your own
     unverified OAuth client.

---

## Connecting to the hub (PMI team members)

Little Gerry can show you the project spaces the firm shares on the hub. There
is nothing to install or configure: once you have connected Google, the app
collects the hub sign-in details from the firm's Drive by itself.

Go to **Settings → Hub → Connect to the hub** and sign in with your work Google
account. You do this once per machine.

If the Connect button is greyed out, connect Google first (see above) and
reopen Settings.

---

## Troubleshooting

- **Windows — installer flagged by antivirus:** run `Trust-Little-Gerry.bat`
  as administrator first, then re-run the installer.
- **macOS — Gatekeeper warning on a signed build:** Control-click the `.pkg` →
  **Open**, or clear quarantine with
  `xattr -d com.apple.quarantine ~/Downloads/LittleGerry.pkg`.
- **macOS — app starts but no window appears:** make sure Docker Desktop is
  installed and running, then relaunch.
- **"google_credentials.json not found" / Google connect fails:** the
  credentials file is missing — see
  [Google OAuth credentials](#google-oauth-credentials) above.
- **Google consent screen says "access blocked":** your email isn't listed as
  a test user on the OAuth consent screen (Option B step 4), or the required
  APIs aren't enabled.
