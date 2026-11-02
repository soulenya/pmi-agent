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

- A brief "Checking for updates… / Downloading update… / Verifying update… /
  Installing update…" status on the splash screen.
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

---

## The signature gate

A downloaded installer runs with administrator rights, so the app does not take
GitHub's word for it — someone holding the GitHub login could publish a release,
but cannot sign one. Before anything runs, `update_verify.py` (project root,
standard library only, shared by `launcher.py` and `backend/routers/update.py`)
checks the file, and `scripts/apply_update.ps1` / `apply_update.sh` check it a
second time before installing:

| Platform | Check | Pinned in `brand/brand.json` |
|---|---|---|
| Windows | `Get-AuthenticodeSignature` verifies, and the signer certificate's SHA-1 thumbprint is listed | `windows.cert_thumbprints` (list) |
| macOS | `pkgutil --check-signature` reports an Apple-issued **Developer ID Installer** signature, and its Team ID is listed | `macos.team_ids` (list) |

On Windows a PC that has not run `Trust-Little-Gerry.bat` reports the chain as
untrusted; with a pinned thumbprint that is accepted (the signature over the
file has still been verified — a modified file reports `HashMismatch`). With
**no** pins the gate falls back to a weaker check — a trusted chain plus the
brand's `windows.cert_cn`, or any Apple Developer ID — which rules out an
unsigned file but not a different legitimate developer. Pin.

A refused file is deleted and logged (`backend/logs/launcher.log`,
`apply_update.log`); the splash says the update "couldn't be verified as
published by …" and the current version starts. The retry guard records
`signature: …` in `update_attempt.json`, so after two refusals the launcher
stops downloading that version and tells the user to contact the administrator.
Settings → System → Apply reports the same reason.

**Rotating a certificate.** Add the new thumbprint (or Team ID) to the list and
ship one release signed with the *old* key; every install then trusts both;
sign later releases with the new key; remove the old entry when all machines
are past that release. `installer/cert/1-Create-Signing-Certificate.ps1` and
the new-company bootstrap append the thumbprint automatically. The Apple Team
ID does not change when the Developer ID certificate is renewed.
