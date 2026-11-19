# GBrain on the hub

[GBrain](https://github.com/garrytan/gbrain) is an open-source memory server:
facts, decisions and notes that an agent can search and add to over MCP. This
runs one on the hub VM as the company's shared brain.

It is **off by default**, in two places. A hub runs the server only after
"Turn it on" below, and Little Gerry offers its company-brain tools only once
the brand switches them on ("Connect Little Gerry"). Until both are done,
nothing changes for anyone.

## What you get

- A `gbrain` container beside `postgres` and `api` in `/opt/littlegerry`.
- MCP at `http://gbrain:3131/mcp`, reachable **only on the VM's compose
  network**. It publishes no port, so IAP and the load balancer are untouched
  and nothing outside the VM can reach it.
- Its own database (`gbrain`) and role (`gbrain`) on the hub's existing
  Postgres. The role is not a superuser and cannot read the app database; the
  app's roles cannot connect to the brain's.
- A nightly dump of that database next to the existing backups, under
  `gbrain/` in the backup bucket.

Search is by keyword. GBrain starts with no AI provider configured, so nothing
it stores leaves the VM. Semantic search and its "think" answers need an
embedding or chat provider, which sends stored text to that provider: decide
that separately, against [SECURITY.md](../SECURITY.md).

It uses about 220 MB of memory when idle.

## Turn it on

Run from the repository root. The names are `gcp.*` in `brand/brand.json`;
PMI's are shown. Every command below uses these three variables, and they
last only as long as the terminal window: set them again in a new one.

```powershell
$project  = "pmi-littlegerry-hub"
$zone     = "us-central1-a"
$image    = "us-central1-docker.pkg.dev/$project/littlegerry/gbrain:0.60.734.0"
```

**1. Build and push the image.** Upstream publishes none; `gbrain/Dockerfile`
builds one from a pinned commit of its `stable` branch.

```powershell
docker buildx build --platform linux/amd64 -t $image --push gbrain
gcloud artifacts packages list --repository littlegerry --location us-central1 --project $project
```

The second command should now list `gbrain` beside `backend`. If it does not,
the push did not land and the VM will have nothing to pull.

**2. Create the database password.** It goes into a connection URL as it is, so
it must be URL-safe; this makes 64 hex characters.

```powershell
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$tmp = New-TemporaryFile
[IO.File]::WriteAllText($tmp, (-join ($bytes | ForEach-Object { $_.ToString('x2') })))
gcloud secrets create gbrain-db-password --project $project --replication-policy=automatic --data-file=$tmp
Remove-Item $tmp
```

Then let the VM read it. A hub set up by the bootstrap script already grants
its VM every secret in the project, and this adds nothing; an older hub, PMI's
included, grants them one by one, and without this the VM is refused.

```powershell
$vmSa = gcloud compute instances describe hub --project $project --zone $zone --format="value(serviceAccounts[0].email)"
gcloud secrets add-iam-policy-binding gbrain-db-password --project $project --member="serviceAccount:$vmSa" --role=roles/secretmanager.secretAccessor
```

**3. Tell the VM, and give it the current startup script.**

```powershell
gcloud compute instances add-metadata hub --project $project --zone $zone --metadata=gbrain-image=$image
.\scripts\hub\deploy-hub.ps1 -UpdateStartupScript
```

**4. Apply it.** This re-runs the VM's whole bring-up, exactly as a reboot
does, so the API is recreated if its image or settings have changed since it
last ran. Pick a quiet moment.

```powershell
gcloud compute ssh hub --project $project --zone $zone --tunnel-through-iap --command="sudo google_metadata_script_runner startup"
```

**5. Check.**

```powershell
gcloud compute ssh hub --project $project --zone $zone --tunnel-through-iap --command="sudo tail -3 /var/log/hub-startup.log; sudo docker inspect gbrain --format '{{.State.Health.Status}}'"
```

The log should say `gbrain: started` and the health should reach `healthy`
within a minute or two. If the log says `WARNING: gbrain did not start`, the
line above it says why; the hub itself is unaffected either way. Two causes
are worth knowing:

- `secret gbrain-db-password is missing` when the secret exists: the VM is not
  allowed to read it. Run the grant in step 2, then step 4 again.
- A pull error naming the `gbrain` image: it is not in the registry. Repeat
  step 1 and check that it is listed.

## Connect Little Gerry

The assistant reaches the brain through the hub's API, which needs a token.

**1. Mint a token** limited to reading and writing (leave `--scopes` off and it
can also administer the brain). It is shown once.

```bash
sudo docker exec gbrain gbrain auth create littlegerry-hub --scopes read,write
```

**2. Store it** where the VM reads its secrets.

```powershell
$tmp = New-TemporaryFile
[IO.File]::WriteAllText($tmp, (Read-Host "Paste the token"))
gcloud secrets create gbrain-mcp-token --project $project --replication-policy=automatic --data-file=$tmp
Remove-Item $tmp
gcloud secrets add-iam-policy-binding gbrain-mcp-token --project $project --member="serviceAccount:$vmSa" --role=roles/secretmanager.secretAccessor
```

`$vmSa` is the VM's service account, from step 2 of "Turn it on".

**3. Deploy a hub image that knows the brain.** Any release from the one that
added `backend/routers/brain.py` on: `.\scripts\hub\deploy-hub.ps1 -Tag <version>`.

**4. Re-run the VM's bring-up** (step 4 of "Turn it on") so the API starts with
the address and the token, then check from the VM. `pmi_api` is
`db.api_container` in `brand.json`.

```bash
sudo docker exec pmi_api python -c "import asyncio; from services import company_brain as b; print(b.configured(), asyncio.run(b.recall('anything')))"
```

`True` and a result mean the API can reach the brain. Nobody sees a difference
yet.

**5. Switch the tools on.** Add `"company_brain": true` to `features` in
`brand/brand.json` and publish a release. Desktop installs pick it up with
their next update; rebuild and deploy the hub image from the same commit so
the web app has the tools too.

`gbrain auth list` (in the container) shows the tokens that exist and
`gbrain auth revoke --id <id>` removes one.

## What people can do with it

Three tools, given to Gerry as the Executive Assistant and in the standard
chat:

- **Recording.** "Add to the company brain that we chose Acme for the pump
  housing because of lead time." Gerry records one fact under a subject. A plain
  "remember…" or "note that…" is still a private note; the brain is only
  written when someone asks for it to be shared.
- **Asking.** "What did we decide about the pump housing supplier?" Gerry
  searches the brain and answers from what colleagues recorded.
- **Correcting and withdrawing.** "That's April now, not March" replaces the
  earlier fact; "remove that from the company brain" withdraws it. GBrain keeps
  the history either way.

Everything recorded is visible to every colleague's assistant, with the name
of whoever asked for it and the date. The hub writes that name from its own
sign-in, so a desktop cannot record something as someone else. There is no
approval step and no per-person privacy: it is the wrong place for anything
personal or confidential.

A desktop must be connected to the hub (Settings → Connections) to use the
brain; one that is not gets told so.

## Conversations in the brain (optional)

Off by default (brand feature `brain_conversations`). When on, the hub stores a
copy of each conversation it holds in the brain, so a past chat can be found by
what was said in it: "what did we say about the pump housing?"

What it is, and is not:

- **A copy for search, not an offload.** The conversation stays where it is
  and loads and answers exactly as before. Storing it does not make a chat
  shorter or faster.
- **Automatic for hub conversations.** Every chat of a person whose computer is
  connected to the hub is on the hub already (it goes up at the end of each
  turn, and once when opened), and so are project chats. Each is written to
  the brain about ten minutes after it goes quiet, twenty conversations per
  five-minute pass, so the first run over a long history takes a while.
  Scheduled-task output is not kept.
- **On demand for the rest.** "Save this chat to the company brain" puts the
  chat on the hub and stores it at once.
- **Not company-wide.** A stored chat is returned only to someone who could
  open that chat on the hub: its owner, or the members of its project. The hub
  enforces that on every result; a recorded *fact* is still for everyone.
- **Removed with the conversation.** When a conversation is deleted on the hub
  its page is taken out of the brain on the next pass. GBrain keeps a removed
  page recoverable on its host for 72 hours and keeps its earlier versions; it
  is not established when, or whether, it then erases them.

Limits worth knowing: the search is by keyword; a search returns one passage
from each of up to three chats; a project chat does not say which member wrote
a message; and a chat moved into a project is found by the project's other
members only after its next message.

### Turning it on

The brain has to keep its pages in the database alone. One started by an image
older than `0.60.734.0-2` (PMI's first one was) also writes every page to a
folder in its container's volume, and refuses to start if that folder is ever
lost; the hub backs up the database, not that volume. To see which you have, on
the VM:

```bash
sudo docker exec gbrain gbrain sources list --json | grep local_path
```

Every line should end in `null`. If they all do, go to step 2. The hub checks
the same thing before it stores anything and refuses, with a line in the API
log, until it is so; nothing is lost by getting the order wrong.

**1. Create the brain again, database-only.** A brain that already has a folder
cannot be converted: `gbrain init --db-only --force` answers "DB-only setup
cannot detach an existing canonical source root". It has to be created again
from an image whose entrypoint starts it database-only, which discards
everything in it, tokens included. One script does it and checks each step:

```powershell
.\scripts\hub\recreate-gbrain.ps1 -Tag 0.60.734.0-2 -CheckOnly   # look; changes nothing
.\scripts\hub\recreate-gbrain.ps1 -Tag 0.60.734.0-2
```

It builds and pushes the image under that tag, points the VM at it, takes a
backup, removes the brain's container, volume and database, re-runs the VM's
bring-up, confirms the new brain is database-only, then mints a token, stores
it as a new version of `gbrain-mcp-token` and re-runs the bring-up so the API
has it. It refuses a brain that holds any fact or page unless told
`-DiscardContents` (moving a brain's contents across has not been worked out;
what is recorded would have to be recorded again), and a step already done is
skipped, so after a stop it can simply be run again. Between the removal and
the second bring-up, a few minutes, the assistant reports the brain as
unreachable; each bring-up also restarts the API. Pick a quiet moment.

**2. Deploy a hub image from the release that has
`backend/services/brain_conversations.py`, with the migration**:
`.\scripts\hub\deploy-hub.ps1 -Tag <version> -Migrate` (it adds one table), or
`.\scripts\finish-release.ps1 -Migrate` when it is the release being published.

**3. Switch it on.** Add `"brain_conversations": true` beside
`"company_brain": true` in `brand/brand.json` and publish a release; deploy
the hub from the same commit. The hub starts storing within five minutes.
PMI's `brand.json` has had it on since 5.35.0.

To check, on the VM:

```bash
sudo docker logs pmi_api 2>&1 | grep "Company brain:" | tail -3
sudo docker exec pmi_postgres psql -U pmi -d pmi_dev -tAc "select count(*) from brain_conversation_archives"
```

To stop, set the feature back to `false` and release. Pages already stored
stay in the brain but are no longer returned to anyone.

## Upgrading GBrain

GBrain releases often; the image pins one commit so the hub only moves when you
move it. Each upgrade changes the brain's schema on the next start.

1. Build the new image locally and check Little Gerry still understands it.
   The assistant depends on the exact shape of GBrain's answers, and this test
   is what notices when a new version changes them:

   ```powershell
   docker compose -f gbrain/docker-compose.dev.yml build --build-arg GBRAIN_REF=<commit>
   docker compose -f gbrain/docker-compose.dev.yml up -d
   docker compose -f gbrain/docker-compose.dev.yml exec gbrain gbrain auth create dev --scopes read,write
   $env:GBRAIN_TEST_MCP_URL = "http://127.0.0.1:3931/mcp"
   $env:GBRAIN_TEST_MCP_TOKEN = "<the token it printed>"
   cd backend; uv run pytest tests/test_company_brain.py tests/test_brain_conversations.py -k contract
   docker compose -f ../gbrain/docker-compose.dev.yml down -v
   ```

   Once it passes, make the new commit the default `GBRAIN_REF` in
   `gbrain/Dockerfile`.
2. Take a backup: `sudo /opt/littlegerry/scripts/backup.sh` on the VM.
3. Build and push the image as in step 1 of "Turn it on", under a new tag.
4. Repeat steps 3 to 5 of "Turn it on" with the new image name.

## Backup and restore

`backup.sh` dumps the `gbrain` database after the app's own backups and uploads
it as `gbrain/gbrain-<stamp>.sql.gz`. Facts live only in the database, so for a
brain that holds nothing else the dump is the whole brain, tokens included, and
the container's volume holds only settings GBrain rebuilds on start. Pages are
different: unless the brain is database-only ("Conversations in the brain",
"Turning it on") GBrain also keeps them as files in that volume, which is not
backed up, and will not start without them. The hub does not store a
conversation in a brain like that.

```bash
sudo /opt/littlegerry/scripts/restore.sh gbrain/gbrain-<stamp>.sql.gz gbrain
```

That stops the container, replaces the database and starts it again.

## Turning it off

```powershell
gcloud compute instances remove-metadata hub --project $project --zone $zone --keys=gbrain-image
gcloud compute ssh hub --project $project --zone $zone --tunnel-through-iap --command="sudo docker rm -f gbrain"
```

The database and its backups stay where they are.

## How it is wired

- `gbrain/Dockerfile`, `gbrain/entrypoint.sh`: the image. The entrypoint
  creates the schema on first start, applies upgrade steps on every start, then
  runs `gbrain serve --http`.
- `scripts/hub-startup.sh`: reads the `gbrain-image` metadata key. When it is
  set, the script fetches `gbrain-db-password`, creates the role, database,
  extensions and the one event trigger GBrain's schema needs a superuser for
  (`provision_gbrain_db`), and starts the container. This block runs last and a
  failure in it is logged, never fatal.
- The compose service sits behind the `gbrain` profile, so `docker compose up -d`
  and `deploy-hub.ps1` neither start nor stop it.
- The database URL carries `sslmode=disable`. GBrain insists on TLS for any
  Postgres that is not on localhost, and this connection never leaves the VM.
- `backend/services/company_brain.py`: the one place that talks to the brain.
  On the hub (`GBRAIN_MCP_URL` and `GBRAIN_MCP_TOKEN` set, from the
  `gbrain-mcp-token` secret) it calls GBrain over MCP. On a desktop it calls
  the hub's `/brain` routes (`backend/routers/brain.py`) as the signed-in
  person, and the hub makes the call.
- `backend/services/agent/brain_tools.py`: the tools. They are registered only
  when the brand's `company_brain` feature is on; `save_chat_to_company_brain`
  also needs `brain_conversations`.
- `backend/services/brain_conversations.py`: stored conversations. The hub's
  background pass (`_brain_conversations_loop` in `main.py`) writes each as a
  GBrain page `conversations/<id>` tagged with its scope (`user:<id>` or
  `project:<id>`), tracks what it wrote in `brain_conversation_archives`
  (migration 053), and removes the pages of deleted conversations. A search
  asks GBrain only for pages carrying a scope the caller holds, then checks
  every hit against `conversation_for`, the hub's own rule for opening a chat;
  the company-wide recall never returns a conversation page at all.
- `gbrain/docker-compose.dev.yml`: a throwaway brain on your own computer, for
  development and for the contract tests.
- `scripts/hub/recreate-gbrain.ps1`: creates the hub's brain again
  database-only and reconnects the API ("Conversations in the brain", step 1).
