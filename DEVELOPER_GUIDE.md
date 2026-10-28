# Little Gerry — Developer Guide

**Version 5.26.1 · build 307 · October 2026**

The engineering map of Little Gerry: how the pieces fit, where the code is,
how a change becomes a release, and how a second company runs its own copy.
The user-facing description of every feature is in [USER_GUIDE.md](USER_GUIDE.md);
the feature table, configuration reference and deck-theme format are in
[README.md](README.md); every change since build 1 is in [CHANGELOG.md](CHANGELOG.md).

---

## Table of contents

1. [System overview](#1-system-overview)
2. [Repository structure](#2-repository-structure)
3. [Local development](#3-local-development)
4. [Brand and white-label](#4-brand-and-white-label)
5. [Backend](#5-backend)
6. [The agent](#6-the-agent)
7. [Documents, extraction and the knowledge base](#7-documents-extraction-and-the-knowledge-base)
8. [Frontend](#8-frontend)
9. [Desktop launcher](#9-desktop-launcher)
10. [The hub](#10-the-hub)
11. [Database and migrations](#11-database-and-migrations)
12. [Security model](#12-security-model)
13. [Testing and gates](#13-testing-and-gates)
14. [Releasing](#14-releasing)
15. [Operating a company's copy](#15-operating-a-companys-copy)
16. [Conventions](#16-conventions)
17. [Known issues and debt](#17-known-issues-and-debt)

---

## 1. System overview

Little Gerry is one codebase deployed three ways:

| Deployment | What runs | Who signs in |
|---|---|---|
| **Desktop (Windows, macOS)** | `launcher.py` (pywebview window) starts PostgreSQL (Docker), the FastAPI backend on `127.0.0.1:8000` and the Vite dev server on `localhost:5173`, then loads the React app. All data local; encrypted at rest. | One person per install, Google SSO, auto-provisioned |
| **Hub** | The same backend image and the same frontend bundle on one GCE VM behind an HTTPS load balancer with Identity-Aware Proxy. System of record for shared projects, tasks, budgets, Team chat and travelling conversations. `HUB_MODE=true` gates desktop-only features off. | Everyone at the company, via IAP (browser/phone) or a per-machine hub credential (desktop) |
| **Phone** | The hub's address in a mobile browser: bottom-tab layout, installable PWA, Web Push | Same as hub |

```
 Desktop install                                   The hub (GCP)
 ┌─────────────────────────────────────┐           ┌──────────────────────────────┐
 │ pywebview window (WebView2 / WKWebView)         │ HTTPS LB ─ IAP ─ hub VM       │
 │   React 19 app   ← Vite :5173       │  HTTPS    │   pmi_api  (same image)       │
 │   FastAPI        ← uvicorn :8000    │ ────────▶ │   pmi_postgres (pgvector)     │
 │   PostgreSQL 16 + pgvector (Docker) │  per-user │   nightly backup → GCS        │
 │   keyring: JWT, Fernet, API keys    │ credential└──────────────────────────────┘
 └──────────┬──────────────────────────┘
            │  Anthropic (chat, vision) · Voyage (embeddings) · Google STT/TTS
            │  Google Workspace OAuth (Gmail, Drive, Calendar, Contacts, Docs, Sheets, Slides, Tasks)
            │  Odoo XML-RPC (optional) · GitHub Releases (self-update)
```

Design rules that explain most of the code:

- **Local-first.** Documents, chat, tasks and keys live on the user's machine. Only what is deliberately shared goes to the hub, and the desktop reads it from there each time rather than copying it.
- **Human in the loop.** Anything that sends, writes or deletes outside the app goes through `approval_intents`; the agent proposes, a person approves.
- **One brand file.** Every company-specific value is in `brand/brand.json` with PMI's values as the compiled-in defaults, so PMI's build is byte-identical whether or not the file is present (§4).
- **Honest tools.** Tool results say what was and was not read; long documents are paged; nothing is summarised before it has been read to the end.

---

## 2. Repository structure

```
pmi-agent/
├── brand/brand.json                 # the company (§4)
├── backend/
│   ├── main.py                      # app factory, 46 routers, /ws/chat and /ws/notifications
│   ├── config.py                    # pydantic-settings; defaults from brand.py; keyring accessors
│   ├── brand.py                     # loads brand.json; PMI defaults; feature()/db/gcp/drive accessors
│   ├── database.py  dependencies.py # async engine; get_current_user / require_admin
│   ├── alembic.ini  migrations/     # 51 revisions; env.py reads DATABASE_URL_SYNC, then backend/.env
│   ├── models/db/                   # SQLAlchemy models, one module per domain
│   ├── repositories/                # DB access layer
│   ├── routers/                     # FastAPI routers (§5)
│   ├── services/
│   │   ├── agent/                   # executor (v1 loop), tools.py (~80 tools), v2/ (LangGraph supervisor)
│   │   ├── llm/                     # router + Anthropic / OpenAI / Ollama clients
│   │   ├── embeddings/              # provider router (Voyage / OpenAI / Ollama)
│   │   ├── documents/               # ingestion (PDF rows, DOCX, XLSX, PPTX), Drive/email import, sync
│   │   ├── document_extraction.py   # vision transcription of PDFs/images (chunked, stored)
│   │   ├── design_system.py  design_tokens.py  decks/   # .docx + Google Slides in the house style
│   │   ├── erp/                     # ErpProvider protocol: odoo, none
│   │   ├── hub/  projects/  push/   # hub client/sync, project space, Web Push
│   │   ├── meetings/  voice/        # capture, STT, live assist, naming; TTS
│   │   ├── assistant/  scheduler/   # daily scan + suggestions; routines runner (loops live in main.py)
│   │   ├── company_drive.py  company_context.py  file_templates.py
│   │   ├── budget_*.py  invoice_service.py  drive_policy.py  drive_edit.py
│   │   └── google_service.py  gmail_watch.py  conversation_backup.py  data_transfer.py …
│   ├── assets/starter/              # Company Truth skeleton + templates seeded by Company Setup
│   ├── scripts/                     # seed_admin.py, _brand_probe.py (PMI identity probe)
│   └── tests/                       # pytest, 25 modules
├── frontend/
│   ├── vite.config.ts               # brandPlugin → __BRAND__; mode=hub derives VITE_WS_BASE
│   └── src/
│       ├── version.ts               # BUILD_NUMBER + in-app changelog (bump every release)
│       ├── lib/brand.ts  lib/workbench.ts  lib/externalLinks.ts
│       ├── api/  pages/  components/  stores/  hooks/
│       └── App.tsx                  # routes, feature gating
├── launcher.py                      # desktop shell (Windows + macOS)
├── docker-compose.yml               # PostgreSQL; names interpolated from the root .env
├── installer/                       # setup.iss (/D defines), brand-defines.ps1, cert/ (1-, 2-, 3- scripts)
├── scripts/
│   ├── install.ps1|.sh  update.ps1|.sh  apply_update.ps1|.sh  build-macos.sh  publish-*.{ps1,sh}
│   ├── hub-startup.sh  init_db.sh   # VM bring-up from instance metadata
│   ├── hub/deploy-hub.ps1|.sh       # release to the hub
│   └── new-company/bootstrap.ps1  update-from-upstream.ps1
├── .github/workflows/               # windows-release, macos-release, sync-upstream
├── Start / Stop / Update Little Gerry.{bat,command}   Install Little Gerry.bat
└── README.md  USER_GUIDE.md  DEVELOPER_GUIDE.md  CHANGELOG.md  SECURITY.md  docs/
```

---

## 3. Local development

Prerequisites: Windows 10/11 or an Apple-silicon Mac; Docker Desktop; Node 20; Python 3.14 through `uv` (`backend/.python-version`); Git. Keys: Anthropic, Voyage (the free tier is enough).

```bash
git clone https://github.com/soulenya/pmi-agent.git && cd pmi-agent
docker compose up -d                       # pmi_postgres (names from the root .env; PMI defaults when absent)
cd backend && uv sync && uv run alembic upgrade head && uv run python scripts/seed_admin.py
cd ../frontend && npm install
```

Run everything the way users do — `python launcher.py` — or separately:

```bash
cd backend  && uv run uvicorn main:app --host 127.0.0.1 --port 8000 --reload
cd frontend && npm run dev          # http://localhost:5173
```

`backend/.env` is optional on a dev box (settings fall back to `config.py` defaults; keys come from the OS keyring via Settings). Installed copies always have one — the installer writes it, with `DATABASE_URL*` built from the brand's role and database names.

---

## 4. Brand and white-label

The product is *Little Gerry*; the company is a parameter.

**`brand/brand.json`** holds: slug, product/assistant name, company name/short/descriptor, flagship product, sign-in `domains`, `admin_email`, `github_repo`, `hub_url`, `windows {app_id, install_dir_name, setup_name, cert_cn}`, `macos {bundle_id, pkg_name}`, `data_dir_name`, `keyring_service`, `db {name, superuser, app_role, audit_role, api_container, postgres_container}`, `drive.*` folder defaults, `gcp.*` (project, region, zone, VM, registry, buckets, IAP audience), `features`, `erp {providers, default, odoo}`, `agents`.

| Reader | Mechanism |
|---|---|
| `backend/brand.py` | Loads once; `_DEFAULTS` are PMI's values; `config.Settings` field defaults come from it, so an environment variable still wins |
| `migrations/_roles.py` | `APP_ROLE` / `AUDIT_ROLE`: env → brand → `pmi_app` / `pmi_audit` |
| `frontend/vite.config.ts` | `brandPlugin` injects the file as `__BRAND__` at build time (`BRAND_FILE` overrides); `src/lib/brand.ts` exposes `BRAND`, `hasFeature()`, `exampleEmail()` |
| `launcher.py` | Repository for updates, asset names, container/db names, install dir, splash |
| `installer/brand-defines.ps1` | `/D` defines for `setup.iss` (AppPublisher, AppId, SetupName, …); PMI defaults compiled into the `.iss` |
| `scripts/*` | `install.*` write the root `.env` (compose names) and rewrite `DATABASE_URL*`; `build-macos.sh`, the cert scripts, `deploy-hub` and `bootstrap` read it |
| `services/agent/tools.py` | `brand_tool_text()` rewrites PMI wording in tool descriptions; `_FEATURE_TOOLS` drops tools for features that are off; ERP tool names become `read_erp` / … when `erp.default != odoo` |

**Features** gate routers (`main.py`), rail items and routes (`lib/workbench.ts`, `App.tsx`), the agent roster and tools. PMI has everything on; Noctu runs with `regulatory`, `qms_agent`, `drive_restrictions`, `investor_relations` off.

**Company Setup** (admin-only, `routers/company_setup.py`; Settings → Company → Company Drive, and the first administrator's wizard step) creates the Drive layout — Company Truth, Templates, Budgets, Invoices, Workrooms, Backups, app-clients — seeds it from `backend/assets/starter/`, and publishes `<slug>-company.json` so other installs learn the folder ids. `services/company_drive.py` resolves each location as SystemSetting → brand default → unset.

**Design tokens** (`services/design_tokens.py`, `/design`, Settings → Company → Design): fonts, logos and colours stored per install; `design_system.tokens()` returns the shipped PMI system when nothing is stored. PMI's fonts are deliberately not shipped in the hub image.

**The invariant: PMI's behaviour must not change.** `backend/scripts/_brand_probe.py dump` writes every text PMI users receive (tool descriptions, prompts, agent roster); the release recipe compares HEAD against the working tree and requires `FC: no differences`.

---

## 5. Backend

FastAPI, Python 3.14, SQLAlchemy 2.0 async + asyncpg, Alembic, pgvector, `slowapi` rate limiting, `keyring`. `main.py` builds the app, mounts 46 routers and two WebSockets.

| Area | Routers |
|---|---|
| Identity | `auth` (Google SSO — desktop poll flow and IAP header flow; auto-provision; first account on an empty database or the brand's `admin_email` → admin), `users`, `audit`, `feedback` |
| Conversation | `conversations` (CRUD, attachments, approvals resolve), `agents`, `voice`, `writing_voice` |
| Knowledge | `documents`, `search`, `files` (generated files), `extractions`, `research`, `browser` (research-browser bookmarks and capture) |
| Work | `tasks`, `project_space`, `project_links`, `canvas`, `workrooms`, `scheduled_tasks`, `assistant` (daily scan), `briefings` |
| Finance | `budgets`, `erp` (mounted at `/api/erp` and `/api/odoo`) |
| Communication | `emails`, `google_integration`, `meetings`, `team`, `push` |
| Compliance | `regulatory`, `regulatory_files`, `regulatory_templates` (feature `regulatory`) |
| Platform | `settings`, `health`, `update`, `hub`, `company_setup`, `design`, `data_transfer`, `conversation_backup` |

WebSockets: `/ws/chat/{conversation_id}?token=` streams `token`, `tool_status`, `artifact_link`, `done` and `error` frames; `/ws/notifications` pushes bell events.

**Settings** are a key-value table (`system_settings`) read through `get_setting` / `set_setting`; per-user keys live in `user_settings`. API keys never touch the database — `config.py` reads and writes them through `keyring` under the brand's `keyring_service`.

**LLM router** (`services/llm/router.py`): one provider+model per *task* (`chat`, `briefings`, `email`, `meetings`, `document_extraction`, `regulatory`, …), chosen in Settings → Models per task; `ensure_vision_capable()` refuses to send images to a text-only model. Clients share a `chat()` / `chat_stream()` interface returning `StreamChunk`s; the Anthropic client converts tool calls and passes `document` / `image` content blocks through untouched.

**Embeddings** (`services/embeddings/service.py`): Voyage (default, 1024 dims), OpenAI, Ollama; the dimension is provider-native and the chunk table's vector column is altered on first use; changing provider sets `llm.kb_needs_reindex` and Settings offers a streamed re-index.

**Google** (`services/google_service.py`): the desktop uses one OAuth token file; the hub stores a credential per user (`google_user_creds.py`) so background jobs run as the person they belong to. Scopes are listed at the top of the module; the consent screen must be *Internal* and *In production*.

**ERP** (`services/erp/`): `ErpProvider` protocol (read, propose write, bank balances, connect fields); `odoo` wraps `odoo_service.py`; `none` answers honestly. Connection rows: `erp_connections`.

**Background work:** asyncio loops started from the app's lifespan in `main.py` — notifications, Drive sync, the daily assistant scan (desktop and hub), routines (`services/scheduler/runner.py`, `scheduled_tasks`), Gerry-draft cleanup, budget folder scans, workroom digests, Gmail-watch renewal. Each loop logs failures and never raises; there is no external scheduler.

---

## 6. The agent

Two engines share one tool set.

- **v1 executor** (`services/agent/executor.py`) — the default. A streaming loop: system prompt (company context, attached files, room context, writing voice, hub notes) → model → tool calls dispatched through `TOOL_EXECUTORS` → results back → repeat until a final answer. Stop is honoured between tool calls.
- **v2 LangGraph** (`services/agent/v2/`) — enabled by `llm.use_langgraph=true`. A supervisor classifies the request and routes to a specialist (`executive_assistant`, `research`, `regulatory`, `qms`, `ir`, `engineering`, `operations`, `house_manager`), each a `base_agent` over LangChain `@tool` wrappers (`lc_tools.py`) around the same executors.

**Tools** (`services/agent/tools.py`, ~80 definitions plus project/custodian tool modules): schema + executor pairs. `_apply_brand()` rewrites descriptions for the brand and removes tools for disabled features; `_PRIMARY_ARG` names the argument shown in the live "working" indicator. Tool results that create something append an `artifact_link` so the UI shows a chip. Conventions: say exactly what was read; page long content with explicit offsets; never claim a file was attached when it was not; writes outside the app go through `propose_*` → `approval_intents`.

**Context builders:** `company_context.py` (Company Truth folder → composed block, cached), `chat_attachments.build_attachments_context()`, `workroom_context.py`, `browser_context.py` (the page the user is browsing), `writing_voice.py`.

---

## 7. Documents, extraction and the knowledge base

`services/documents/ingestion.py`: SHA-256 dedup → Fernet-encrypted store under `STORAGE_ROOT` → text extraction → chunk (~512 tokens, 64 overlap; newlines and column gaps preserved) → batch embed → `document_chunks`. PDF text is rebuilt **row by row from word coordinates** so statements and invoices keep date, description and amount on one line; pages detected as two-column prose keep block order. DOCX includes tables; XLSX reports every sheet, formula results and cell-fill colours; PPTX includes notes.

Scanned PDFs (< 200 chars of text) and images go to **vision** (`document_extraction.py`): split into ≤ 8-page parts, transcribed concurrently by the `document_extraction` model, re-split when a reply is cut off, stored in `document_extractions` keyed by content hash so the same bytes are never read twice. The `extract_document` tool pages the stored transcription in 30 000-character windows and accepts a schema for structured output (`extraction_schemas.py`).

Chat attachments (`chat_attachments.py`) use the same extractors, store encrypted bytes per conversation, and inject up to 50 k chars per file / 150 k total into the system prompt. Generated files (`routers/files.py`) live in `backend/generated_files/`; a link in a reply becomes a `FileActionCard` (download, open in Workspace, add to KB, pin), and `/api/files/` links are intercepted so the window never navigates to the backend.

---

## 8. Frontend

React 19, TypeScript, Vite 6, Tailwind, shadcn/ui, TanStack Query (server state), Zustand (client state), React Router 7. `@/` → `src/`.

- **Workbench shell** (`lib/workbench.ts`, `components/layout/`): left rail (Today, Gerry, Projects, Tasks, Team, Mail, Knowledge, Calendar, Compliance, Finance — filtered by `features`), recent places, You menu, Ctrl+K search, peek drawer, Gerry side panel bound to the open project. Phone layout under 768 px on the hub.
- **Pages** (`src/pages/`, lazy-loaded): Dashboard (Today), Chat, Projects / ProjectSpace / Portfolio, Tasks, Team, Inbox / Emails / Contacts, Documents / Search / GeneratedFiles, Calendar, Meetings, Regulatory, Research / ResearchBrowser, Budgets, Erp, Workrooms, ScheduledTasks, Assistant, Waiting, Settings, Users, Audit, Backups, Agents, Login.
- **Auth:** JWT in `localStorage`, refresh via the Axios interceptor (`api/client.ts`). On the hub IAP has already authenticated; the backend trusts the IAP header and issues the same JWT.
- **External links** (`lib/externalLinks.ts`): a capture-phase click handler — real web links open in the system browser through `window.pywebview.api.open_external`; `/api/files/` links download with the session and hand the file to the OS; everything else stays in the window.
- **Native bridge** (`window.pywebview.api`): `open_external`, `save_file`, the research-browser methods (`browser_open / navigate / fit / capture / …`).
- **Settings pattern:** `localSettings` accumulates edits; save → `PUT /settings` → invalidate `["settings"]`.
- **version.ts:** `BUILD_NUMBER`, `BUILD_DATE` and the in-app changelog shown in What's New; the "seen" marker is stored server-side so it survives reinstalls.

---

## 9. Desktop launcher

`launcher.py` is one file, platform-branched (`IS_WINDOWS` / `IS_MAC`):

1. Reads `brand/brand.json`; exports `POSTGRES_*` / `DB_*_ROLE` for compose.
2. **Auto-update** (installed copies): `GET …/releases/latest` with the token in `update_token.txt`; if newer, downloads `<setup_name>.exe` / `<pkg_name>.pkg` and hands off to `scripts/apply_update.ps1|.sh`, which installs silently and relaunches. Two failed attempts at the same version stop the retry loop (`update_attempt.json`). Developer checkouts `git fetch` and fast-forward instead.
3. Starts Docker if needed, `docker compose up -d`, waits for Postgres, runs `alembic upgrade head`, starts uvicorn and Vite **in their own process groups** (POSIX) so teardown kills the whole tree.
4. Creates the pywebview window (WinForms/WebView2 on Windows, Cocoa/WKWebView on macOS) at the last saved size and position — restored only if it lies inside the primary screen on macOS — shows the splash, and loads `localhost:5173` when `/health` answers.
5. Poll thread: the control file (`restart`, `stop`, `update` from Settings → System) and a guard that reloads the app if the window ever leaves it.
6. Close: Windows asks to confirm (the tray icon also offers Stop/Restart); macOS treats close as quit. `atexit` and SIGTERM/SIGINT/SIGHUP all run `_stop_all()` (services, ports, `docker stop`) with a 12-second watchdog.

Window state, launcher log and control file are in `backend/logs/`. The Research Browser is a second pywebview window, owned by the main one on Windows.

---

## 10. The hub

One GCE VM (`hub`, e2-standard-2, Ubuntu 24.04, no external IP, Cloud NAT) runs `pmi_postgres` and `pmi_api` from `docker-compose.yml` under `/opt/littlegerry`, behind an HTTPS load balancer (backend service `hub-backend`, named port `http:8000`, health check `/health/live`, 3600 s timeout for WebSockets) with IAP enabled for the company's Workspace domain and a *programmatic* OAuth client for the desktop.

- **Bring-up:** `scripts/hub-startup.sh` runs on boot from instance metadata (`project, region, registry, image, hub-domain, iap-audience, backup-bucket, db-*, api-container, postgres-container, vapid-subject`; PMI defaults). It pulls secrets from Secret Manager into `/opt/littlegerry/.env` (never `source`d — values are read with `sed`), renders compose and the init SQL, installs `backup.sh` (nightly cron → GCS: `pg_dump` + `/data` tarball) and `restore.sh`, and starts the stack. There is no auto-migrate: the deploy script runs alembic.
- **Deploy:** `scripts/hub/deploy-hub.ps1 [-Tag X] [-Migrate] [-UpdateStartupScript] [-VerifyOnly]` (bash twin `.sh`): backup → registry login → pull → optional `alembic upgrade head` as the DB superuser (Postgres brought up first) → `compose up -d --force-recreate api` → verify image digest, alembic head and `/health/live` (polled for 60 s). All coordinates come from `brand.gcp.*`.
- **Image:** `backend/Dockerfile`; `.dockerignore` excludes `backend/assets/` except `starter/`. Build with `--platform linux/amd64` (buildx) — an arm64 Mac would otherwise build an image the VM cannot run.
- **Roles:** `superuser` owns migrations; `app_role` is what the API connects as (owner of every table since migration 051; `audit_events` append-only); `audit_role` may read and insert audit rows.
- **Desktop ↔ hub:** `services/hub/` — the desktop obtains an IAP-scoped credential once per machine, then proxies project/task/budget/Team/conversation calls; nothing is cached locally; an amber bar reports unreachability. Conversations are mirrored both ways by id.

---

## 11. Database and migrations

PostgreSQL 16 + pgvector, 56 tables. Domains: identity (`users`, `user_sessions`, `user_settings`, `google_credentials`, `google_sync_state`), conversation (`conversations`, `messages`, `agent_runs`, `conversation_attachments`, `approval_intents`), knowledge (`documents`, `document_chunks`, `document_categories`, `document_extractions`, `research_*`, `browser_bookmarks`), work (`projects`, `project_members`, `project_links`, `project_item_custody`, `project_canvases`, `canvas_nodes` / `canvas_edges`, `tasks`, `task_dependencies`, `task_comments`, `workrooms`, `workroom_items`, `workroom_journal`, `scheduled_tasks`, `assistant_suggestions`, `briefings`), finance (`budgets`, `budget_folders`, `budget_references`, `erp_connections`), communication (`email_drafts`, `meeting_notes`, `team_channels`, `team_channel_members`, `team_messages`, `device_tokens`, `push_subscriptions`, `notifications`), compliance (`regulatory_documents`, `regulatory_nodes`, `capas`, `risk_items`), platform (`system_settings`, `model_routing_rules`, `drive_edit_grants`, `hub_links`, `feedback`, `audit_events`).

Migrations are hand-written in `backend/migrations/versions/` (`001` … `051`). Rules:

- `revision` / `down_revision` are three-digit strings; one file per release that changes the schema.
- Every `CREATE TABLE` is followed by `ALTER TABLE … OWNER TO {APP_ROLE}` (from `migrations._roles`). Migration 051 repaired every table that had missed this and set default privileges, so a forgotten transfer is no longer fatal — keep doing it anyway.
- `env.py` resolves the URL as `DATABASE_URL_SYNC` env → `backend/.env` → `alembic.ini` (PMI's dev default). Desktop installs run `alembic upgrade head` on every launch; the hub runs it from `deploy-hub -Migrate`.
- Test a new migration up and down on a scratch database (`create database lg_mig_test`, point `DATABASE_URL_SYNC` at it) before committing; the hub deploy has no rollback.

---

## 12. Security model

- The backend binds to `127.0.0.1` on the desktop; on the hub only IAP reaches port 8000 (the firewall allows the health-check ranges and IAP's SSH range).
- Sign-in is Google SSO only, restricted to the brand's `domains`; IAP enforces the same on the hub. Accounts auto-provision; the first account on an empty database or the brand's `admin_email` is admin; everyone else is a full-access member with per-user regulatory write.
- Secrets: JWT secret, Fernet key and API keys in the OS keyring (desktop) or Secret Manager → `.env` (hub). Never in the database, never in git. `backend/google_credentials.json`, `google_token.json`, `google_stt_sa.json`, `update_token.txt` and `installer/cert/*.pfx` are gitignored; the OAuth client and STT key are distributed through the app-clients Drive folder.
- Documents and chat attachments are Fernet-encrypted at rest; backups (`.lgbackup`) decrypt on export and re-encrypt on import so the key never leaves the machine.
- Every consequential agent action is an `approval_intents` row; `audit_events` is hash-chained and append-only for the app role.
- Drive restrictions (feature `drive_restrictions`): the QMS folder and `*draft*` files are withheld unless the user explicitly asks and confirms; Drive edits need a per-file grant (`drive_edit_grants`).
- Rate limiting (`slowapi`), CORS limited to the app origins; the research browser only hands over page text the user explicitly captures.

See [SECURITY.md](SECURITY.md) for the threat model and reporting.

---

## 13. Testing and gates

```
backend\.venv\Scripts\python.exe -m pytest backend\tests --noconftest -p no:cacheprovider -q
    # 130 passed; 81 errors = DB-backed tests without a live database (the baseline)
cd frontend && node node_modules\typescript\bin\tsc -p tsconfig.app.json --noEmit
cd frontend && node node_modules\vite\bin\vite.js build
backend\scripts\_brand_probe.py dump <out.json>     # PMI identity probe: compare HEAD vs working tree
```

There is no ESLint configuration; `tsc` is the frontend gate. New backend behaviour gets a test in `backend/tests/` that runs without a database where possible (`test_pdf_layout.py`, `test_erp.py`, `test_design_tokens.py` are the pattern).

---

## 14. Releasing

Every release is one commit on `master` (mirrored to `dev/v1.5`) and one GitHub release. In order:

1. **Docs gate.** `CHANGELOG.md` entry (`### vX.Y.Z · build N — date`); `USER_GUIDE.md` / `README.md` where behaviour changed; `frontend/src/version.ts` (`BUILD_NUMBER`, `BUILD_DATE`, a plain-English changelog entry); `VERSION` (no trailing newline); `installer/setup.iss` `AppVersion`.
2. **Gates** (§13); commit with a message file (`git commit -F`); push `master` and `master:dev/v1.5`.
3. **Installer.** `powershell -ExecutionPolicy Bypass -Command "$defs = & installer\brand-defines.ps1; & iscc.exe /Q @defs installer\setup.iss"` → `installer\Output\LittleGerry_Setup.exe`; sign with `installer\cert\2-Sign-LittleGerry.ps1` (PMI's PFX, interactive); verify `Get-AuthenticodeSignature` is `Valid`.
4. **Hub image.** With the Cloud SDK on PATH (so `docker-credential-gcloud` resolves): `docker build -f backend/Dockerfile -t <registry>/<project>/littlegerry/backend:X.Y.Z -t …:latest .`, push both tags, confirm the digest line.
5. **Hub deploy.** `scripts\hub\deploy-hub.ps1 -Tag X.Y.Z [-Migrate]`; confirm digest, alembic head, `health=200`.
6. **Publish.** `gh release create vX.Y.Z installer\Output\LittleGerry_Setup.exe Trust-Little-Gerry.bat --target master --title "Little Gerry X.Y.Z" --notes-file notes.md`. `macos-release.yml` builds, signs and notarises `LittleGerry.pkg` and attaches it; `windows-release.yml` sees the exe already present and does nothing (for a fork it builds and signs instead).
7. Installed copies pick the release up at next launch.

A company fork does steps 1–2 by merging upstream and 3–6 entirely in CI: `gh release create v$(cat VERSION)` is the whole release.

---

## 15. Operating a company's copy

A second company runs the same code from its own private repository, GCP project and hub. Nothing of theirs lands in PMI's repository; PMI's fixes flow to them through git.

- **First setup:** `scripts/new-company/bootstrap.ps1` (Windows PowerShell or `pwsh` on macOS; `-DryRun`, `-Answers file.json`, `-SkipHub`). Signs in to `gh` and `gcloud`, creates the private repository from the checkout, writes `brand/brand.json`, creates the GCP project (billing picked from a list), enables APIs, creates the STT service account/bucket/key and the Drive-backup bucket, sets `UPDATE_TOKEN`, creates the self-signed signing certificate (Windows store or `openssl`) and the Actions secrets, builds and pushes the `linux/amd64` image, creates Secret Manager secrets (db/JWT/Fernet generated; validated API-key prompts), the VM, NAT, load balancer, managed certificate, static IP and IAP (domain grant + programmatic client). Console steps remain for the OAuth consent screen, the three OAuth clients and the DNS record. Re-runnable; detects `iam.disableServiceAccountKeyCreation` and offers to lift it for the project.
- **Adding the hub later:** a company that ran the bootstrap with `-SkipHub` (or no `hub_url`) re-runs it with an answers file built from its existing `brand.json` so the desktop identity (AppId) is unchanged. The operator runbook is [docs/HUB_SETUP.md](docs/HUB_SETUP.md).
- **Taking PMI's releases — by itself:** `sync-upstream.yml` runs daily on the fork. It merges upstream's **latest release tag** (not master) into the fork's default branch, and when the merge is clean it publishes `v<VERSION>` and dispatches the two installer workflows directly (a release made with `GITHUB_TOKEN` does not fire `release:` triggers). Installed copies update at their next launch. Only a conflict stops it: the merge goes to a `sync/upstream-*` branch with a pull request (or, if the repository forbids Actions-made PRs, a warning naming the branch). `brand/brand.json` keeps the fork's version; workflow files, `VERSION`, `CHANGELOG.md`, `version.ts` and `setup.iss` take upstream's. Needs the `UPSTREAM_REPO` variable (set by the bootstrap); `UPSTREAM_AUTO_RELEASE=false` restores review-first PRs. A fork on the pre-5.27.1 workflow has to take one release by hand (`update-from-upstream.ps1`, or merge + `gh release create`) before the new workflow is the one running.
- **Taking PMI's releases — by hand:** `scripts/new-company/update-from-upstream.ps1` merges `upstream/master` (workflow files take upstream, `brand.json` stays), pushes, runs `gh release create v<VERSION>`, then for the hub: checks the API-key secrets for bad pastes, rebuilds and pushes the image, `deploy-hub -UpdateStartupScript` + `-Migrate`, re-runs the startup script and a backup, and counts permission errors in the API log. On macOS: `pwsh ./scripts/new-company/update-from-upstream.ps1`.
- **Roles on a fresh database:** the first sign-in becomes administrator; the brand's `admin_email` is promoted on sign-in; administrators promote others on the Users page.
- **Signing:** Windows installers are signed in CI from `WINDOWS_CERT_PFX_BASE64` / `WINDOWS_CERT_PASSWORD` (the runner trusts the self-signed certificate before checking); `Trust-Little-Gerry-<slug>.bat` installs the public certificate on users' PCs. macOS signing and notarisation need the five `MACOS_*` secrets from an Apple Developer account; without them the `.pkg` is unsigned and users right-click → Open.

Noctu (the first white-label) ran this path in October 2026; their four reports produced the fixes in 5.26.0 – 5.26.1 (see `CHANGELOG.md`).

---

## 16. Conventions

- Facts, not fluff — in code comments, the changelog, docs and anything the agent says. State what happened; a why-clause only when it is not obvious.
- PMI must not change: run the brand probe when touching prompts, tool text or defaults; keep PMI's values as the compiled-in defaults.
- Every table-creating migration transfers ownership to `APP_ROLE`.
- Tool results are honest about what was read; long content is paged, never truncated silently.
- Scripts are re-runnable: check what exists before creating it.
- `*.ps1` / `*.bat` are CRLF, `*.sh` / `*.command` are LF (`.gitattributes`); PowerShell files that must run under Windows PowerShell 5 are ASCII or carry a UTF-8 BOM.
- Commit messages: imperative subject with an area prefix, body from a message file. Push `master` and `master:dev/v1.5`.

---

## 17. Known issues and debt

| Area | Note |
|---|---|
| Frontend in the shipped app | Both platforms run the Vite dev server on `localhost:5173` inside the installed app (bound to loopback). A static build served by the backend is intended but not scheduled. |
| Tests | 81 DB-backed tests error without a live Postgres; the suite is run with `--noconftest`. A containerised test database would turn them green. |
| Native PDF to Claude | Chat attachments are sent as extracted text, not as `document` blocks; row-preserving extraction (5.25.0) covers statements and invoices, but a native path would help for complex layouts. |
| macOS tray | pywebview's Cocoa backend owns the main thread, so there is no tray icon on macOS; close = quit. |
| bootstrap | PowerShell only (runs under `pwsh` on macOS/Linux); no bash twin. |
| Ollama | Supported as a provider but untested against current models. |
