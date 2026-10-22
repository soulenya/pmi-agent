# Little Gerry — Auto-Update

Installed copies update themselves automatically. On every launch the app checks
the repository's GitHub **Releases** (`brand.github_repo`) for a newer
**signed** installer; if one exists it downloads `<setup_name>.exe` (Windows) or
`<pkg_name>.pkg` (macOS), installs it silently, then relaunches. Publish once and
every machine gets it on its next launch.

> Developer checkouts (folders that are a git repo) update via `git` instead and
> ignore this mechanism.

---

## One-time setup (the publisher)

The app reads releases using a **read-only GitHub token** baked into each
installer at build time as `update_token.txt`. PMI's repository is public, so
for PMI the token mainly lifts the unauthenticated API rate limit; a company
fork's repository is private and needs it to read releases at all.

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

That's it — the token now gets bundled into every installer you build locally.
In CI (`windows-release.yml`, `macos-release.yml`) the same value comes from the
repository secret **`UPDATE_TOKEN`**; the new-company bootstrap sets it.

> To revoke access later (token leaked, or you stop trusting old builds),
> delete the token on GitHub and issue a new one. Old installers can no longer
> fetch updates until rebuilt with the new token.

---

## Shipping an update

PMI's full sequence (docs gate, gates, installer + signing, hub image, hub
deploy, `gh release create`) is DEVELOPER_GUIDE.md §14. For a company fork the
whole release is:

```
gh release create v$(cat VERSION) --repo <owner>/<repo> --generate-notes
```

CI builds and signs the Windows installer and the macOS `.pkg` and attaches
them. `scripts/new-company/update-from-upstream.ps1` does this after merging
PMI's latest.

> Each release **must** have a higher version than the last (the app compares
> `VERSION` against the release tag).

---

## What a user sees during an update

- A brief "Checking for updates… / Downloading update… / Installing update…"
  status on the splash screen.
- Windows: one elevation (UAC) prompt showing the publisher from the brand
  (**Precisian Medical Instruments** for PMI), because the installer is signed
  and the publisher certificate is trusted via `Trust-Little-Gerry.bat`.
  macOS: the `.pkg` installs for the current user without a password; an
  unsigned fork `.pkg` may ask to be allowed once.
- The app relaunches on the new version.

**Check for Updates** in Settings → System does the same comparison on demand
and is available to every signed-in user; applying from there is admin-only.
If GitHub refuses the request the message names the repository, the status and
whether a token was present.
