# Adding the hub to a company's copy of Little Gerry

For Noctu, and any company that set up the desktop app first and now wants
the shared, browser-reachable half.

The hub is the same backend image and the same frontend bundle, running on
one small Google Cloud VM behind HTTPS and Identity-Aware Proxy. It is the
system of record for shared projects, tasks, budgets, Team chat and
conversations that travel between machines, and it is the web app: anyone at
the company opens it from a browser or phone at `https://hub.<your-domain>`
and signs in with their Workspace account.

Nothing in it is PMI-specific. Every name, bucket, project and domain is read
from `brand/brand.json`; `scripts/new-company/bootstrap.ps1` fills those in
and creates everything. Expect about an hour of attention plus up to an hour
of waiting for the certificate.

---

## 1. Before you start

You need, on one machine:

| Tool | Why | Check |
|---|---|---|
| `gcloud` + `gsutil` | create and operate the GCP resources | `gcloud auth list` shows the account that owns your Little Gerry project |
| `gh` | reads/writes your fork | `gh auth status` shows your fork's owner |
| `docker` with buildx | builds the hub image | `docker buildx version` |
| `git` | the fork checkout | — |
| PowerShell | Windows PowerShell 5+ or `pwsh` 7 on macOS/Linux | — |

And you need to decide / have:

- **The hub address.** `https://hub.<your-domain>`, where `<your-domain>` is
  one of your sign-in domains and you can add a DNS record for it.
- **API keys for the hub.** The hub runs its own copy of the assistant, so it
  needs its own Anthropic key (`sk-ant-…`) and Voyage key (`pa-…`). A Google
  API key (`AIza…`) is optional (speech on the hub).
- **Billing.** The GCP project you already have is linked to billing; the hub
  adds an `e2-standard-2` VM, a static IP and a global load balancer.

Work from the root of your fork's checkout, on `master`, up to date with your
origin.

---

## 2. Answer file

Re-running the bootstrap asks the brand questions again and rewrites
`brand/brand.json`. Answer them exactly as before, so nothing about the
desktop installer changes — in particular the Windows **AppId GUID**, which
is the installed app's identity; a new one would make the next update
install beside the old copy instead of over it.

The safest way is to let the existing `brand.json` answer for you. Run this
in the fork's root; it writes `hub-answers.json` next to it:

```powershell
$b = Get-Content brand\brand.json -Raw | ConvertFrom-Json
$yn = { param($v) if ($v) { "y" } else { "n" } }
[ordered]@{
  company            = $b.company_name
  company_short      = $b.company_short
  slug               = $b.slug
  company_descriptor = $b.company_descriptor
  company_website    = $b.company_website
  domains            = ($b.domains -join ",")
  admin_email        = $b.admin_email
  product_name       = "$($b.product.name)"
  hub_url            = "https://hub.$($b.domains[0])"      # <-- edit if different
  erp_default        = $b.erp.default
  feature_regulatory         = & $yn $b.features.regulatory
  feature_qms_agent          = & $yn $b.features.qms_agent
  feature_investor_relations = & $yn $b.features.investor_relations
  windows_app_id     = $b.windows.app_id
  macos_bundle_id    = $b.macos.bundle_id
  gcp_project        = $b.gcp.project
  gcp_region         = $b.gcp.region
  gcp_zone           = $b.gcp.zone
} | ConvertTo-Json | Set-Content hub-answers.json -Encoding UTF8
Get-Content hub-answers.json
```

Check the printed values, especially `hub_url`. Anything the file does not
answer (API keys, file paths) is still asked at the prompt. Do **not** commit
`hub-answers.json`.

---

## 3. Run the bootstrap

Dry run first — it prints every command and creates nothing:

```powershell
.\scripts\new-company\bootstrap.ps1 -Answers .\hub-answers.json -DryRun
```

Then for real:

```powershell
.\scripts\new-company\bootstrap.ps1 -Answers .\hub-answers.json
```

Steps 0–5 (sign-ins, repository, brand, GCP project, update token, signing)
recognise what already exists and pass through quickly. The script stops at
a few **CONSOLE STEP** prompts; do each in the browser, then press Enter.

### 3a. OAuth consent screen (probably already done)

If the desktop app is in use, this exists. Confirm it is **Internal** and
**In production** — in Testing, refresh tokens expire after 7 days and the hub
would log everyone out weekly.

### 3b. OAuth clients — two new ones for the hub

At `https://console.cloud.google.com/apis/credentials?project=<your-project>`
you already have the Desktop client (`google_credentials.json`). Create two
more:

1. **Web application**, name `Hub web`.
   Authorised redirect URI: `https://hub.<your-domain>/api/auth/google/callback`
   Download the JSON. The script asks for its path next.
2. **Desktop app**, name `Hub desktop (IAP)`.
   Download the JSON and save it as **`hub_client.json`**. The script asks
   for its path in step 6b, and every desktop install will need a copy
   (section 5).

### 3c. Step 6 — the hub itself

No prompts except the API keys. The script:

- builds the backend image for `linux/amd64` and pushes it to Artifact
  Registry (a few minutes; on Apple Silicon this is why buildx is required)
- creates Secret Manager secrets; database, JWT and Fernet values are
  generated; you are prompted for the Anthropic, Voyage and Google keys
  (paste the bare key — a value with spaces or a label is rejected) and,
  optionally, VAPID keys for phone push (`python3 -m py_vapid --gen`)
- creates the backup bucket and grants the VM's service account access to
  secrets, the registry and the bucket
- creates the `hub` VM (no public IP) and Cloud NAT for its outbound traffic

### 3d. Step 6b — load balancer, DNS, IAP

The script creates the firewall rules, instance group, health check, backend
service, URL map, Google-managed certificate, HTTPS proxy, static IP and
forwarding rule, then prints the IP and stops:

> **CONSOLE STEP — DNS record**
> At the registrar for `<your-domain>`: add `A  hub.<your-domain>  ->  <ip>`

Add the record, press Enter. The certificate provisions in the background —
15 to 60 minutes after the name resolves. The hub does not answer on HTTPS
until it is `ACTIVE`.

IAP is then enabled on the backend service and your sign-in domain(s) and
admin address are granted access. When asked for the `hub_client.json` path,
give it: the script registers that client for programmatic IAP access (this
is how the desktop app reaches the hub without a browser) and writes
`gcp.iap_audience` into `brand.json`.

Finally it commits `brand.json` to your fork and pushes.

---

## 4. First deploy

Wait for the certificate:

```powershell
gcloud compute ssl-certificates describe hub-cert --global --format="value(managed.status)"
```

When it says `ACTIVE`:

```powershell
.\scripts\hub\deploy-hub.ps1 -Migrate
```

`-Migrate` creates the database schema on this first run. The script backs
up, pulls the image, runs the migrations, recreates the API container and
verifies: image digest, alembic head, and `health=200`. Then open
`https://hub.<your-domain>/health/live` in a browser — you will be asked to
sign in with your Workspace account (that is IAP) and then see the health
response.

Open `https://hub.<your-domain>/` and sign in. **The first person to sign in
becomes administrator.** The brand's `admin_email` is also promoted on sign-in
whenever it arrives.

---

## 5. Connecting the desktop installs

Each installed copy connects once, as its user. Two things make that possible:

1. **`hub_client.json` in the company's Drive.** Every desktop install needs
   the `Hub desktop (IAP)` client. Nobody copies it by hand: the app looks in
   the company's Drive for a file named exactly `hub_client.json` the first
   time it runs with Google connected, and keeps its own copy. Upload the file
   to the shared drive in the folder the setup wizard made for app clients
   (`app-clients/`), readable by everyone at the company. If you have several
   files by that name, set `drive.hub_client_file` in `brand.json` to the
   file's Drive id.

2. **A release with `hub_url` set.** The desktop learns the hub address from
   `brand.json` at build time, so the installs need a release built after
   step 3 committed it:

   ```powershell
   .\scripts\new-company\update-from-upstream.ps1
   ```

   or, without taking new upstream changes, bump the patch digit in
   `VERSION` and `gh release create v<VERSION> --repo <owner>/<repo> --generate-notes`.
   Installs pick the release up through Settings → Check for Updates.

Then on each desktop: **Settings → Connections → Connect to the hub**. A
Google sign-in window opens; after it, the hub's projects, tasks, budgets and
Team chat are what the app shows. "Move my work to the hub…" on the same
panel carries a person's existing local projects and tasks across.

If the button is greyed with *"This computer hasn't collected the hub sign-in
details yet"*, the install has not found `hub_client.json` in Drive — check
the file name and that the signed-in user can read it. It retries every 15
minutes, or immediately after reopening Settings.

---

## 6. From here on

- **Releases.** Nothing to do. `sync-upstream.yml` runs daily in your
  repository: when PMI publishes a release it merges it, publishes the
  same version here and builds the installers; installed copies update at
  their next launch. You will only hear from it if a merge has conflicts —
  then a pull request (or a `sync/upstream-*` branch) waits for someone.
  To take a release right now rather than tomorrow morning: Actions →
  **Sync from upstream** → Run workflow. To review every release before it
  ships, set the repository variable `UPSTREAM_AUTO_RELEASE` to `false`.
- **Hub after a release.** The workflow ships the desktop; the hub still
  needs its image rebuilt and deployed. From your checkout:
  `pwsh ./scripts/new-company/update-from-upstream.ps1` does merge, release
  (skipped if already published) and hub in one go, or
  `scripts/hub/deploy-hub.ps1 -Tag <version> -Migrate` for the hub alone
  after building and pushing the image.
- **Hub only.** `scripts\hub\deploy-hub.ps1 -Tag <version> [-Migrate]`;
  `-VerifyOnly` just prints image, alembic head and health.
- **Backups.** Nightly cron on the VM: `pg_dump` plus a tarball of `/data` to
  `gs://<slug>-hub-backup`. `restore.sh` is beside it under `/opt/littlegerry`.
- **Logs.** `gcloud compute ssh hub --zone=<zone> --tunnel-through-iap --command="docker logs --tail 200 lg_api"`
  (the container name is `db.api_container` in your `brand.json`).
- **Who can get in.** IAP, not the app, decides who can reach the hub at all:
  `gcloud iap web add-iam-policy-binding --resource-type=backend-services --service=hub-backend --member=user:<email> --role=roles/iap.httpsResourceAccessor`
  for a person outside your sign-in domains; the domain grant covers everyone
  inside them.

---

## If something goes wrong

| Symptom | Likely cause | Do |
|---|---|---|
| Browser shows a certificate error at the hub address | Managed certificate not yet `ACTIVE`, or DNS not resolving to `hub-ip` | `nslookup hub.<domain>`; `gcloud compute ssl-certificates describe hub-cert --global` |
| `health=000` or `502` after deploy | API container still starting, or a secret is missing/blank | SSH in; `docker logs lg_api`; `gcloud secrets versions access latest --secret=anthropic-api-key` should print a bare key |
| Bootstrap fails creating a service-account key | Org policy `iam.disableServiceAccountKeyCreation` | The script offers to lift it for the project; accept, re-run |
| Desktop: "No hub address is configured for this build" | The installed release was built before `hub_url` was committed | Publish a new release (section 5.2) and update |
| Desktop: connect fails with an IAP error | `Hub desktop (IAP)` client not in the programmatic-access allowlist | Re-run bootstrap and give the `hub_client.json` path at step 6b, or `gcloud iap settings set <yaml> --resource-type=backend-services --service=hub-backend` with `accessSettings.oauthSettings.programmaticClients: [<client_id>]` |
| Weekly sign-outs on the hub | Consent screen in Testing | Set it to In production |

The bootstrap is re-runnable: anything it already created is kept. When in
doubt, run it again with the same answers file.
