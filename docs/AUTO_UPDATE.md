# Little Gerry — Auto-Update

Installed copies update themselves automatically. On every launch the app checks
the private repo's GitHub **Releases** for a newer **signed** installer; if one
exists it downloads and installs it silently, then relaunches. Push an update
once and every machine gets it on its next launch.

> Developer checkouts (folders that are a git repo) update via `git` instead and
> ignore this mechanism.

---

## One-time setup (you, the publisher)

The app reads private releases using a **read-only GitHub token** that is baked
into each installer at build time. Anyone who has the installer already has the
bundled source, so a read-only token to that same repo adds no new exposure —
but it keeps everything off the public internet.

### 1. Create a fine-grained, read-only token

1. GitHub → your avatar → **Settings → Developer settings → Personal access
   tokens → Fine-grained tokens → Generate new token**.
2. **Resource owner:** `soulenya` (or your org).
3. **Repository access:** *Only select repositories* → **`soulenya/pmi-agent`**.
4. **Permissions → Repository permissions → Contents:** **Read-only**.
   (Leave everything else at *No access*.)
5. **Expiration:** pick a long window (e.g. 1 year). Set a calendar reminder to
   rotate it.
6. Generate, then **copy the token** (starts with `github_pat_...`).

### 2. Put the token on your build machine

Save it to `update_token.txt` in the project root (this file is gitignored and
never committed):

```
copy update_token.txt.example update_token.txt
# then paste your token into update_token.txt (replace the placeholder line)
```

That's it — the token now gets bundled into every installer you build.

> To revoke access later (e.g. token leaked, or you stop trusting old builds),
> delete the token on GitHub and issue a new one. Old installers can no longer
> fetch updates until rebuilt with the new token.

---

## Shipping an update

From the project root:

```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\publish-release.ps1 -Version 1.0.1 -Notes "What changed"
```

This bumps the version, commits/pushes it, builds + **signs** the installer, and
creates the `v1.0.1` GitHub release with the signed installer attached. Every
installed app picks it up on its next launch.

> Each release **must** have a higher version than the last (the app compares
> `VERSION` against the release tag). The script enforces this.

---

## What a user sees during an update

- A brief "Checking for updates… / Downloading update… / Installing update…"
  status on the splash screen.
- One Windows elevation (UAC) prompt — clean, showing **Precisian Medical
  Instruments** as the publisher (because the installer is signed and the
  publisher cert is trusted via `Trust-Little-Gerry.bat`).
- The app relaunches on the new version.
