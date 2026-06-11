# Little Gerry — Changelog & Known Issues

---

## Changelog

### v1.4.8 — 2026-06-11
**Voice button promoted to the top bar**

- **"Talk with Little Gerry" is now a central feature** — the launcher moved from a floating bottom-right corner button to the center of the top bar, visible on every page (header expanded h-14 → h-16 to fit; button size unchanged). It has a very faint pulsing glow plus a slow shimmer sweep (`.voice-cta` in `index.css`, disabled under `prefers-reduced-motion`). While a session runs the button becomes a red "End voice session" toggle; the live status panel still appears bottom-right. New `frontend/src/stores/voiceAssistantStore.ts` (zustand) bridges the header button and the session manager; `VoiceAssistant.tsx` no longer renders its own launcher (`Header.tsx`, `AppShell.tsx` unchanged)

### v1.4.7 — 2026-06-11
**Spoken replies skip emojis**

- **Fix: TTS read emojis aloud** ("rocket", "warning sign", …) — `strip_markdown` in `backend/services/voice/google_speech.py` now also removes emoji/pictograph/symbol ranges (incl. ZWJ sequences, flags, variation selectors, arrows) before synthesis. On-screen text is unchanged; accented characters are preserved

### v1.4.6 — 2026-06-10
**Long generated files fixed + global "Talk with Little Gerry" button**

- **Talk with Little Gerry from anywhere** — a persistent floating button in the bottom-right corner of every page (hidden on Chat, which has its own toggle) starts a hands-free voice session: each session creates a fresh conversation visible in chat history, the reply is spoken aloud, and the mic re-opens for the next turn. Panel shows listening/got it/thinking/speaking phases with Interrupt, a "View conversation" shortcut, and Esc/X to end. Generated-files list auto-refreshes after each reply so files Gerry creates by voice appear immediately. New `frontend/src/components/VoiceAssistant.tsx`, mounted in `AppShell.tsx`; reuses `useVoiceConversation` + the chat WebSocket — no backend changes
- **Fix: generated files cut off mid-content** — the Anthropic client capped every response at 4,096 output tokens (~3,000 words), and since `generate_file`/`create_docx` receive the whole document inside one tool-call argument, anything longer was silently truncated by the API. Streaming calls now allow 32,768 output tokens (`MAX_TOKENS_STREAM`); non-streaming utility calls raised to 8,192 (`backend/services/llm/anthropic_client.py`). OpenAI/Ollama clients had no explicit cap and are unchanged

### v1.4.5 — 2026-06-10
**Voice Conversation mode**

- **Hands-free voice chat** — a “Voice chat” toggle on the Chat page starts a conversational loop: the mic listens with silence detection (~1.5 s pause ends your turn), the transcript sends automatically, Gerry's reply streams on-screen and is spoken aloud, and when the audio finishes the mic re-opens for your next turn. The mic is fully released while Gerry thinks/speaks (no echo pickup). New `useVoiceConversation` hook (`frontend/src/hooks/useVoiceConversation.ts`) does Web Audio RMS silence detection + segment rollover under the 60 s STT limit; wired into the chat WebSocket done/error frames (`frontend/src/pages/ChatPage.tsx`)
- **Live phase banner** — listening / got it / thinking / speaking states, an Interrupt button while speaking (stops playback, listens immediately), Esc or the toggle exits. Uses existing `/voice/transcribe` + `/voice/speak` endpoints — no backend changes

### v1.4.4 — 2026-06-10
**Research search fixed + dependency sync on launch**

- **Fix: Research tab returned zero results** — the legacy `duckduckgo-search` package is dead (silently returns no results) and installer-based updates never installed its replacement `ddgs` into the app's Python environment. `web_search` no longer falls back to the dead package: it uses `ddgs` only and logs a clear error if it's missing (`backend/services/research/searcher.py`); `duckduckgo-search` removed from dependencies (`backend/pyproject.toml`)
- **Launcher reconciles dependencies on every launch** — installer updates replaced code but never touched the Python venv or node_modules, so releases adding a dependency silently broke. The launcher now runs `uv sync` + `npm install` at startup regardless of update path (fast no-ops when current) (`launcher.py`)
- Note: the installed copy on this machine was hot-fixed by running `uv sync` directly, so Research works there already

### v1.4.3 — 2026-06-10
**Scheduled tasks: Run Now fixed**

- **Fix: Run Now produced nothing** — running a scheduled task (e.g. Monthly Investor Report) executed the whole agent run inside the HTTP request; the frontend's 120-second request timeout aborted it mid-run, so no file was generated and no outcome was recorded (`run_count` stayed 0). `POST /scheduled-tasks/{id}/run` now marks the task `running`, starts the run as a background task with its own DB session, and returns 202 immediately (`backend/routers/scheduled_tasks.py`, `start_background_run` in `backend/services/scheduler/runner.py`)
- **Live run status** — the Scheduled Tasks page shows ⟳ running… and polls every 3 s while a run is in flight, then displays the result; the Run Now button stays disabled during the run and the API rejects a second concurrent start (409). Runs interrupted by a backend restart are marked failed (“interrupted by an app restart”) instead of staying stuck on running (`frontend/src/pages/ScheduledTasksPage.tsx`)

### v1.4.2 — 2026-06-10
**Download destination picker + full knowledge base listing**

- **Choose where downloads go** — the Download action on Regulatory Files and Generated Files now opens a destination dialog: “Save to this computer” uses the browser's native Save-As picker (exact folder of your choice; falls back to the Downloads folder on browsers without the File System Access API), or “Upload to Google Drive” with a folder browser covering My Drive and shared drives — after upload it shows the exact Drive path and an Open in Drive link (`frontend/src/components/SaveFileDialog.tsx`; new `POST /api/google/drive/upload` + `drive_upload_bytes` in `backend/services/google_service.py`)
- **Knowledge Base shows all documents** — the Documents page was only ever requesting the first page (25) from the paginated `GET /documents` API (and sent `limit`/`offset` params the backend ignored); `listDocuments` now pages through until every document is loaded, so the list and the “Total documents” stat reflect everything imported. No storage limit exists — documents beyond 25 were always stored and searchable by chat (`frontend/src/api/documents.ts`)

### v1.4.1 — 2026-06-10
**Calendar-aware Dashboard, voice-aware setup wizard, model-recommendation fix**

- **Dashboard scans your calendar** — when Google Workspace is connected, today's Google Calendar events join tasks and meetings in Today's Agenda, and a new “Upcoming Events” card lists the next 7 days with times, locations, and a link to the Calendar page (`frontend/src/pages/DashboardPage.tsx`; uses existing `GET /api/google/calendar/events`, queried only when Google is connected)
- **Setup wizard: new Voice step** — after the Google Workspace step, the wizard now explains the Google Cloud API key that powers voice (mic + spoken replies), notes that the key likely already exists in the company's Google Cloud project (ask an admin, or Console → APIs & Services → Credentials with Speech-to-Text and Text-to-Speech enabled), and lets you paste and save it right there (`frontend/src/components/SetupWizard.tsx`)
- **Setup wizard: functionality refresh** — the “Using it” step now covers voice chat, the Generate Document wizard (FDA/ISO templates), Models per Task, and the calendar-aware Dashboard
- **Fix: recommended-model false negative** — Settings → Models per Task no longer claims “provider key not configured” when the recommended model exists in the catalog under a dated snapshot ID (e.g. recommendation `claude-haiku-4-5` vs catalog `claude-haiku-4-5-20251001`); the ★ marker and active-recommendation badge use the same prefix matching (`frontend/src/pages/SettingsPage.tsx`)

### v1.4.0 — 2026-06-10
**Voice — speak to Little Gerry and hear replies (Google Cloud Speech)**

- **Microphone button in chat** — record a message, and the transcript drops into the input box as editable text before sending (`frontend/src/components/chat/ChatInput.tsx`); transcription via `POST /voice/transcribe` (Google Cloud Speech-to-Text, `latest_short` model, automatic punctuation)
- **Spoken replies** — optional “Speak replies aloud” toggle reads finished assistant chat replies in a natural Neural2/Studio voice; markdown is stripped before synthesis so code and symbols aren't read aloud (`POST /voice/speak`, `backend/services/voice/google_speech.py`)
- **Voice picker** — new Settings → Voice section with Google Cloud API key entry (OS keyring, never on disk), speak-replies toggle, and a voice dropdown listing the project's available voices premium-first (`GET /voice/voices`)
- **Privacy posture** — audio is proxied straight to the user's own Google Cloud project and never stored on disk or in the database; voice features are hidden entirely until a Google key is saved (`backend/routers/voice.py`)

### v1.3.0 — 2026-06-10
**FDA & ISO document generation wizard in Regulatory Files**

- **Generate Document wizard** — the Regulatory Files page gains a "Generate Document" button that walks through a four-step wizard: pick a template and title → review the AI-recommended section structure and output format → choose auto-populate or blank template → generate, with a one-click recommended review task at the end (`GenerateDocModal` in `frontend/src/pages/RegulatoryPage.tsx`, API client `frontend/src/api/regulatoryTemplates.ts`)
- **Curated FDA / ISO template catalog** — ten templates: 510(k) Premarket Notification Outline, Design and Development Plan (21 CFR 820.30), CAPA Procedure (820.100), Complaint Handling Procedure (820.198 + Part 803), DHF Index, ISO 13485 Quality Manual, ISO 14971 Risk Management Plan and Report, generic SOP, and EU MDR Declaration of Conformity — each with governing standards, default section structure, and drafting guidance (`backend/services/regulatory/templates.py`)
- **AI formatting recommendation** — `POST /regulatory-templates/recommend` asks the regulatory-task model to refine the section structure and recommend Word vs Markdown output for the specific document, with safe fallback to template defaults (`backend/services/regulatory/generator.py`)
- **Generation with honest auto-populate** — `POST /regulatory-templates/generate` drafts the full document (task="regulatory" model). Auto-populate fills specifics from the company profile and knowledge-base vector search; anything unverifiable becomes a `[FILL IN: …]` placeholder — facts are never invented. Blank-template mode produces structure + guidance only
- **Editable output into the controlled store** — output renders to Word (`backend/services/regulatory/docgen.py`) or Markdown (editable in-app) and is saved as a regular `regulatory_nodes` file (`source_type="generated"`, shown as "Generated" in the Source column) — rename, move, download, and edit like any other regulatory file. Generation requires regulatory write permission

### v1.2.0 — 2026-06-10
**Per-task model selection, live model catalog, collapsible Settings**

- **Models per Task** — Settings gains a "Models per Task" section letting each general task category (Chat & Agent, Daily Assistant, Briefings, Email Drafting, Meetings, Regulatory, Research) use its own model, with a ★ recommended pick and reason per category. Every category defaults to the global pick; overrides are explicit user choices only — the app never auto-switches models. Backed by a task registry (`backend/services/llm/tasks.py`), per-task settings keys (`llm.task.<task>.provider/model`), task-aware resolution in `get_llm_client(db, task=...)` with safe fallback to the global model when an override's key is removed (`backend/services/llm/router.py`), all eight call sites updated to pass their task, and `GET/PUT /settings/task-models` (`backend/routers/settings.py`). UI in `frontend/src/pages/SettingsPage.tsx` (`TaskModelsSection`)
- **Live, key-filtered model catalog** — model lists are now discovered live from each provider's API and only providers with an active API key are listed (Ollama: only when the local server is reachable; Voyage embeddings: only with a Voyage key). The catalog is cached in `system_settings` (`llm.model_catalog`), rescanned automatically **weekly** (`_model_catalog_loop` in `backend/main.py`), immediately after a new API key is saved, and on demand via `POST /settings/refresh-models`. Models first seen in the last 14 days are flagged `· NEW` (`backend/services/llm/catalog.py`); `GET /settings/ai-options` is now catalog-driven
- **Collapsible Settings sections** — every Settings section is now an expandable menu item (like the sidebar) and starts condensed for a cleaner page (`Section` in `frontend/src/pages/SettingsPage.tsx`)

### v1.1.4 — 2026-06-10
**Research search fixed + selective Google Drive sync for Regulatory files**

- **Research now returns results** — the web search silently returned zero results every time because the searcher imported `from ddgs import DDGS` while only the deprecated `duckduckgo-search` package (which DuckDuckGo now blocks) was installed. Added the maintained `ddgs` package (`backend/pyproject.toml`, `uv.lock`) and made the import resilient to either package name (`backend/services/research/searcher.py`). Reports now gather real sources again
- **Selective Drive sync for Regulatory files** — the Regulatory Files page gains a **"Check for updates"** button that polls Drive-linked files for source changes, mirroring the Knowledge Base sync — but because Regulatory is a *controlled* store, **nothing is ever re-imported automatically**. Changes are detected and flagged (modified / renamed / deleted), and a review dialog lets the user pick exactly which files to re-import or dismiss, one by one:
  - New tracking columns on `regulatory_nodes` (`sync_status`, `sync_detail`, `source_name`, `last_checked_at`, `last_synced_at`) via migration `009_add_regulatory_sync_columns.py`, plus a baseline recorded on import (`backend/models/db/regulatory.py`, `backend/routers/regulatory_files.py`)
  - New detection/apply/dismiss service `backend/services/regulatory/sync.py` and endpoints `POST /regulatory-files/check-updates`, `POST /regulatory-files/{id}/apply-update`, `POST /regulatory-files/{id}/dismiss-update`
  - New review UI on `frontend/src/pages/RegulatoryPage.tsx` with per-file checkboxes and status badges, backed by `checkRegUpdates` / `applyRegUpdate` / `dismissRegUpdate` (`frontend/src/api/regulatoryFiles.ts`). A notification is raised the first time a file is flagged

### v1.1.3 — 2026-06-10
**Scheduled tasks, answers that survive navigating away, and a Drive import fix**

- **Scheduled tasks** — a new **Scheduled Tasks** page (`frontend/src/pages/ScheduledTasksPage.tsx`, nav in `Sidebar.tsx`) lets you tell Little Gerry to run a prompt on a repeating schedule (daily / weekly on a chosen day / monthly on a chosen date, at a chosen time). For example, *"create a report every Thursday morning about the previous week."* Backed by a new `scheduled_tasks` table (`backend/models/db/scheduled_task.py`, migration `008_add_scheduled_tasks.py`), a headless agent runner and 60-second scheduler loop (`backend/services/scheduler/runner.py`, wired into `main.py` lifespan), and a REST API (`backend/routers/scheduled_tasks.py`, prefix `/scheduled-tasks`). Each run reuses a dedicated conversation, records its status/output, reschedules itself, and pushes a notification when finished. Run-now, pause/resume, and delete are supported from the UI
- **Answers no longer lost when you navigate away** — the chat agent now runs in a **detached background task with its own database session** (`backend/services/agent/stream_runner.py`), forwarding frames to the WebSocket via a queue (`backend/main.py`). Previously, closing the chat tab mid-reply cancelled the run before its final `db.commit()`, discarding the answer. Now the run always completes and persists, so the finished answer is waiting in your history when you return
- **Sidebar chat can create files** — the Little Gerry sidebar chat uses the same agent and tools as the full chat; the system prompt now advertises `create_docx` and `upload_to_drive` (`backend/services/agent/executor.py`) so generated Word documents land on the **Generated Files** page from either chat surface
- **Fixed "Import from Drive" showing an empty folder** — browsing a Google Drive folder in the Knowledge Base returned nothing because `drive_list_folder()` in `backend/services/google_service.py` was missing its function signature (the body was orphaned dead code). Restored the signature so folder listing works for both My Drive and shared drives

### v1.1.2 — 2026-06-10
**Create Word documents and upload them to Google Drive**

- **Create `.docx` documents** — a new `create_docx` agent tool (`backend/services/agent/tools.py`) builds real Microsoft Word files with python-docx. It accepts lightweight Markdown (`#`/`##`/`###` headings, `-`/`*` bullets, `1.` numbered lists, `**bold**`) and saves into the Generated Files area, so the file appears on the **Generated Files** page ready to download. The files router (`backend/routers/files.py`) now serves `.docx`/`.doc`, and the page strips the internal id prefix so names display cleanly
- **Upload to Google Drive** — a new `upload_to_drive` agent tool plus `drive_upload_file()` (`backend/services/google_service.py`) uploads any generated file to Drive (optionally into a folder by id) and returns the shareable link. Added the `drive.file` write scope — **reconnect Google in Settings → Google Integration** to grant upload access. Together these let the assistant go end-to-end: gather data → write a `.docx` → upload it to Drive
- **No more premature "maximum tool call rounds" errors** — the per-turn tool-call cap (`backend/config.py` `agent_max_tool_rounds`) was raised from 5 to a configurable 30, and when the cap is reached the assistant now makes one final no-tools call to **write its complete answer** instead of failing and discarding all the work it gathered (`backend/services/agent/executor.py`, `backend/services/agent/v2/base_agent.py`)

### v1.1.1 — 2026-06-09
**Fix chat errors on the newest Claude models + macOS support groundwork**

- **Fixed `temperature is deprecated for this model`** — switching to one of the newest Claude models then sending a chat returned `400 invalid_request_error: 'temperature' is deprecated for this model`. The Anthropic client (`backend/services/llm/anthropic_client.py`) always sent `temperature`; it now **retries once without it** on that specific error and **caches the model** so subsequent calls omit the parameter automatically — self-healing with no hard-coded model list. Covers every feature that calls Claude (chat, briefings, emails, meetings, regulatory, research, daily scan)
- **macOS (Apple Silicon) groundwork** — the launcher (`launcher.py`) is now cross-platform, with macOS launcher scripts (`Start/Stop Little Gerry.command`, `scripts/install.sh`, `update.sh`, `apply_update.sh`), a `.pkg` installer builder (`scripts/build-macos.sh`) with a `Little Gerry.app` stub, and env-gated code-signing/notarization hooks. The Windows `.exe` and macOS `.pkg` attach to the same release; the auto-updater picks the right asset per platform. *(macOS end-to-end testing still pending hardware.)*

### v1.1.0 — 2026-06-09
**Auto-update fix (definitive) + tidier sidebar**

- **Updates now apply unattended** — the final piece of the auto-update saga. The installed app could still quit at *"Installing update…"* without ever updating. Root cause: the launcher (`pythonw.exe`) runs inside a Windows **Job Object with kill-on-close**, so the detached updater process was terminated the instant the launcher called `os._exit(0)` — before `apply_update.ps1` could even write its first log line. `CREATE_BREAKAWAY_FROM_JOB` (tried in v1.0.9) was *rejected* by the job, so it didn't help
- **Fix** (`launcher.py` `_launch_updater`): the updater is now started via `os.startfile()` / **ShellExecute**, which reparents it to Explorer — **outside** the launcher's job — so it survives the app closing, installs the signed update, and relaunches. Confirmed with a controlled kill-on-close-job reproduction (plain detached child = killed; ShellExecute child = survives) and verified end-to-end (installed app auto-updated 1.0.8 → 1.1.0)
- **Tidier sidebar** (`frontend/src/components/layout/Sidebar.tsx`): the left navigation now **scrolls** when items overflow, and is organized into **collapsible sections** (Work, Knowledge, Communications, Compliance, Administration) with Dashboard, Little Gerry, and Daily Assistant pinned at the top. Collapsed sections show a badge with any pending counts inside them, the section containing your current page stays open, and your collapse choices are remembered between sessions

> **Note:** v1.0.6 was withdrawn (release + tag deleted); only **v1.0.5** is retained as a rollback fallback. v1.0.10 was never published (the version was skipped in favor of 1.1.0).

### v1.0.9 — 2026-06-09
**Auto-update — job-breakaway attempt**

- **Spawn the updater with `CREATE_BREAKAWAY_FROM_JOB`** (`launcher.py`) so a kill-on-close Job Object wouldn't terminate the detached `apply_update.ps1` when the launcher exits. This was a necessary investigation step but **insufficient on its own** — the job forbids breakaway — and was superseded by the ShellExecute hand-off in v1.1.0

### v1.0.8 — 2026-06-09
**Tidier sidebar — scrollable, with collapsible sections**

- **Scrollable navigation** — the left category list now scrolls when there are more items than fit on screen (previously the overflow was simply unreachable)
- **Collapsible groups** — navigation is grouped into Work, Knowledge, Communications, Compliance, and Administration, with Dashboard, Little Gerry, and Daily Assistant pinned at the top; collapsed groups surface a combined pending-count badge, the active group auto-expands, and the expanded/collapsed state persists across sessions (`frontend/src/components/layout/Sidebar.tsx`)

### v1.0.7 — 2026-06-09
**Auto-updater hardening — fix the silent update hanging**

- **Updates no longer hang at "Installing update…" on a hidden dialog**: the Inno Setup `[Code]` section used a plain `MsgBox()` ("Little Gerry was installed successfully!") that `/SUPPRESSMSGBOXES` does **not** suppress, so during an unattended, headless auto-update it appeared off-screen and blocked the installer's `-Wait` forever — the app went down and never relaunched
- **Fix** (`installer/setup.iss`): both `[Code]` dialogs now use `SuppressibleMsgBox`, which auto-answers under `/VERYSILENT`. Added `skipifsilent` to the `install.ps1` `[Run]` entry so silent auto-updates skip the redundant winget prerequisite pass (which also returned a spurious exit code 1)
- **Diagnosable + self-recovering updater** (`scripts/apply_update.ps1`): now writes a transcript to `backend/logs/apply_update.log` (plus an Inno log), explicitly stops the `pythonw` launcher process before installing, checks the installer exit code, and **always relaunches** in a `finally` block so the app is never left down

### v1.0.6 — 2026-06-09 *(withdrawn)*
**Daily Assistant — a once-a-day Gmail + Tasks scan**

- **New Daily Assistant** (`backend/services/assistant/daily_scan.py`, `routers/assistant.py`, `frontend/src/pages/AssistantPage.tsx`): a once-a-day background scan of your Gmail and Google Tasks surfaces suggested follow-ups and to-dos for human review, stored as `AssistantSuggestion` records (migration `007`). A new **Daily Assistant** entry appears in the sidebar with a pending-count badge
- *This release was later withdrawn (release + tag removed) so that only v1.0.5 remains as a fallback; the Daily Assistant feature ships unchanged in v1.0.7 and later*

### v1.0.5 — 2026-06-09
**Fix "Check for Updates" — 502 on installed apps**

- **The Settings → Software Updates "Check for Updates" button no longer fails with *"Request failed with status code 502"***: the endpoint queried GitHub's *commits* API **unauthenticated**, but the repo is private, so GitHub rejected every request — and installed apps aren't git checkouts, so the old git-based "Install Update" path couldn't work either
- **Fix** (`routers/update.py`): the update check is now installed-app-aware, mirroring the launcher's auto-update. Installed copies compare the local `VERSION` against the latest **GitHub Release** using the read-only token baked into the installer, and **Install Update** downloads the signed installer and applies it (stop → silent install → relaunch). Developer checkouts keep the commit-comparison + `git pull` path, now also authenticated so it won't 502

### v1.0.4 — 2026-06-09
**Fix Google Drive PDF/DOCX imports**

- **Drive imports now use the same robust extractor as uploads**: importing a PDF (or Word doc) from Google Drive previously failed with *"Could not extract text"* even when the identical file uploaded from disk worked. The Drive path extracted text with **pypdf**, which returns empty text on many PDFs, and silently truncated content to 10,000 characters
- **Fix** (`services/google_service.py`, `routers/google_integration.py`): Drive PDF/DOCX files now hand their **raw bytes** to the ingestion pipeline, which extracts text with **PyMuPDF (fitz)** for PDFs and **python-docx** for Word — identical to the Upload path, with no truncation. The in-place text extraction (used by the AI agent's Drive reader and document update-sync) was also upgraded from pypdf to PyMuPDF

### v1.0.3 — 2026-06-09
**Fix Knowledge Base imports — default embedding provider to Voyage**

- **Document imports no longer fail trying to reach a local Ollama server**: when no embedding provider was persisted in the database, ingestion silently fell back to **Ollama** (`localhost:11434`), which isn't running — producing *"All connection attempts failed."* The Settings page showed "Voyage connected" because the API key lived in the keyring, but the provider selection had never been saved
- **Fix** (`services/embeddings/service.py`): the embedding provider/model now fall back to the configured default (`settings.default_embedding_provider` = Voyage) instead of Ollama, so a fresh install with a cloud key configured works out of the box

### v1.0.2 — 2026-06-09
**Resilient embeddings — retry transient Voyage connection errors**

- **Auto-retry on momentary network blips** (`services/embeddings/service.py`): `VoyageEmbeddingService` now retries transient errors (connection failures, timeouts, 5xx, rate limits) with backoff so a brief hiccup doesn't fail an entire document ingestion

### v1.0.1 — 2026-06-09
**Silent auto-update + admin self-lockout guard**

- **Silent auto-update for installed copies** (`launcher.py`, `scripts/apply_update.ps1`): on launch the installed app checks GitHub Releases and, if a newer signed installer exists, downloads and applies it in the background, then relaunches
- **Prevent admin self-lockout** (`routers/users.py`): an admin can no longer deactivate their own account or remove their own admin role (returns 400), preventing accidental loss of access

### v1.0.0 — 2026-06-09
**Signed installer + publisher trust kit**

- **Internal code-signing** (`installer/cert/`): the installer is signed with a self-signed code-signing certificate; a one-click `Trust-Little-Gerry.bat` installs the publisher certificate so Windows SmartScreen/AV trust the app
- **Added missing `voyageai` dependency** to `backend/pyproject.toml` + lockfile
- **Installer hygiene**: exclude personal `google_token.json` and `.env` from the bundle; post-install success popup + clearer Finished page

### Build 40 — 2026-06-08
**Reliable startup — self-heal a leftover database container**

- **Fix startup crash on name conflict**: launching the app could fail with `Conflict. The container name "/pmi_postgres" is already in use` when a stale Postgres container (e.g. from a separate dev checkout or a previous install) was left behind, since Docker container names are global
- **Self-healing**: both `launcher.py` and `Start Little Gerry.bat` now check whether this project already owns the `pmi_postgres` container (`docker compose ps -q postgres`); if not, they `docker rm -f pmi_postgres` to clear the stray one before `docker compose up` — the data volume is untouched, so no data is lost

### Build 39 — 2026-06-08
**Email invites + Google sign-in onboarding + automatic updates**

- **Invite by email** (new `POST /users/invite`, admin-only): sends the invitee a message (via Gmail) with a link to download the installer and instructions to sign in with Google — no passwords. The Users-page Invite dialog is now just **Email + optional Name + optional personal note** (role/password/regulatory fields removed)
- **Auto-provisioning on first Google sign-in** (`routers/auth.py`): when someone signs in with Google for the first time their account is created automatically — the owner (`settings.admin_email`) becomes **admin**, everyone else becomes a **full-access member** (`can_write_regulatory=True`). A random password is set internally since sign-in is SSO-only; audited as `user.auto_provisioned`
- **New settings** (`config.py`): `admin_email` (who is the admin) and `installer_download_url` (link included in invite emails)
- **Automatic updates on launch** (`launcher.py`): on startup the app checks GitHub and, if a newer version exists, pulls it (`git reset --hard origin/master`), refreshes dependencies (`uv sync`, `npm install`), and always applies pending database migrations (`alembic upgrade head`). Skipped on a dirty working tree so developer machines aren't disturbed

### Build 38 — 2026-06-08
**First-use setup wizard — guided one-time onboarding**

- **Guided wizard on first login** (new `frontend/src/components/SetupWizard.tsx`, replaces the AI-only `FirstRunSetup`): an 8-step walkthrough — Welcome, How it works, Claude, Voyage, Google, Using it, Roles, Done
- **Explains the stack**: why Docker (the local PostgreSQL database that stores your content) and Python (the backend engine) were installed, and that API keys are stored in the OS keyring
- **Connect Claude + Voyage**: paste the keys your team already has; the wizard pre-sets the defaults (`anthropic` / `claude-sonnet-4-6` and `voyage` / `voyage-3`), verifies the Claude key, and saves the Voyage key
- **Optional Google Workspace step** (Connect → OAuth in browser, with live status), plus a tour of import / edit / chat / feedback and an explainer of roles & per-user privileges (Admin, Member, Regulatory write)
- **Shows only once per user**: new `users.onboarding_complete` flag (migration `006`) set via `POST /settings/onboarding/complete`; surfaced on `UserOut` and checked at login

### Build 37 — 2026-06-08
**In-app feedback — report bugs / request features from the top bar**

- **Feedback button in the top bar** (new `frontend/src/components/layout/FeedbackButton.tsx`): opens a modal with a **Bug / Feature** toggle and a text box so any user can report an issue or request a feature
- **Routed to notifications**: each submission is persisted (new `feedback` table) and creates a notification for the configured owner (`feedback_recipient_email`, falling back to all admins) — so feedback from any current or future user shows up in the Notifications tab and bell dropdown, with a purple message icon
  - New backend: `Feedback` model, `POST /feedback` router, `FEEDBACK_SUBMITTED` notification type, migration `005`
  - Best-effort real-time WebSocket push to connected recipients; otherwise picked up by the existing 30s poll
- **Bug fix — Notifications 500**: `GET /notifications` returned a `ResponseValidationError` whenever a notification linked to an entity, because `NotificationOut.entity_id` was typed `str` but the DB returns a `UUID`; corrected to `UUID`
- **Bug fix — migration DB role**: migrations now run as the privileged `pmi` role (which has `CREATE`) and each new table hands ownership to the runtime `pmi_app` role via `ALTER TABLE ... OWNER TO pmi_app`, preventing `permission denied` 500s on new endpoints (reverts the Build 36 env.py approach, which made migrations run as the unprivileged app role)

---

### Build 36 — 2026-06-08
**Regulatory file explorer + per-user write permissions**

- **Regulatory page rebuilt as a file explorer** (new `backend/routers/regulatory_files.py`, `frontend/src/pages/RegulatoryPage.tsx`):
  - Browse a folder/file tree with breadcrumbs; **create folders**, **upload files**, **import from Google Drive**, **edit text files** in-app, **rename**, **move**, and **delete**
  - Backed by a self-referential `regulatory_nodes` table; file bytes live in a local store (`~/.pmi-agent/regulatory/`) keyed by a stable id, so **renames and moves only touch the database** (no re-upload)
  - Import from Drive reuses the multi-select Drive browser with progress; Google Docs/Sheets/Slides are exported to `.docx`/`.xlsx`/`.pptx` automatically (`drive_download_bytes`)
- **Per-user Regulatory write permission**: all users can read/write every section **except Regulatory**; Regulatory write access is granted per user
  - New `users.can_write_regulatory` flag (admins are always allowed) enforced server-side by a `require_regulatory_write` dependency on every mutating endpoint — everyone can still browse and read
  - **Users page**: a Regulatory column toggles **Read / Write** vs **Read only** per user (admins show an "Always" badge); the invite dialog gains a matching checkbox
  - New endpoints under `/regulatory-files`: list, download, get/save text, create folder, upload, import-drive, rename/move (`PATCH`), delete; migration `004`
- **Bug fix — Alembic table ownership**: running migrations could create tables owned by the `pmi` superuser instead of the app's `pmi_app` role, causing `permission denied` 500s on the new endpoints; `migrations/env.py` now falls back to the app's configured sync URL so migrated objects are owned by `pmi_app`

---

### Build 35 — 2026-06-08 — 🏷 Milestone `v0.9.0`
**Drive auto-update detection, Knowledge Base polish, copy fix**

Tagged as milestone **`v0.9.0`** (commit `28fb46d`) — core features working well.

- **Automatic Google Drive document update detection** (new `backend/services/documents/sync.py`):
  - Background scan runs daily at **06:00, 12:00, and 18:00** local time, plus a manual **"Check for updates"** button on the Knowledge Base page
  - Cheap metadata-only polling (no content download, not subject to Voyage rate limits) detects **modified**, **renamed**, and **deleted** source files
  - Changes are **flagged for human review — never auto-overwritten** (important for regulated medical content): **Apply update** re-fetches and re-embeds from Drive; **Dismiss** acknowledges and re-baselines
  - Owner is notified (`SYSTEM_ALERT`) when a linked file changes; notifications deduped to fire only on a fresh transition
  - New columns on `documents`: `sync_status`, `source_modified_at`, `last_checked_at`, `sync_detail`, `source_name` (migration `003`); Drive `source_id`/`source_type=google_drive` recorded on import
  - New endpoints: `POST /documents/check-updates`, `POST /documents/{id}/apply-update`, `POST /documents/{id}/dismiss-update`
  - KB UI: per-document sync badges ("Update available" / "Renamed in source" / "Source deleted") with inline Apply/Dismiss actions
- **Knowledge Base import UX**: in-modal **progress bar** and per-file status while importing from Drive
- **Bug fix — DOCX import**: uploaded Word files are not Google-native, so `files().export()` returned `403 fileNotExportable`; now downloaded via `get_media` and parsed with `python-docx` (paragraphs + table cells)
- **Bug fix — `GET /documents` 500**: `PaginationParams` was missing a `limit` property → `AttributeError`; added it
- **Bug fix — delete/edit not persisting**: `delete_document` and `update_document` flushed but never committed (`get_db()` never auto-commits) → changes rolled back; both now `await db.commit()`
- **Bug fix — Drive content mis-parsed**: extracted Drive text kept a `.pdf` name, so ingestion tried to PyMuPDF-parse plain text ("Failed to open stream"); now uses a text extension matching the extracted content
- **Bug fix — silent import errors**: Drive import/upload failures were swallowed by an empty catch; real backend error messages now surface in the UI
- **Bug fix — email draft 500**: `EmailDraftOut` declared `created_at`/`updated_at` as `str` but the DB returns `datetime`, 500ing on every generate (masked as a CORS "Network Error"); typed as `datetime`
- **Fix — copy/paste**: text would not highlight in chat messages or read-only display fields — the desktop window (pywebview) injects `body { user-select: none }` by default; passing `text_select=True` to `create_window` restores selection and Ctrl+C

---

### Build 34 — 2026-06-08
**Knowledge Base & Search — end-to-end fixes**
- Fix Knowledge Base uploads silently failing: upload and Drive-import routes never committed the transaction, so documents rolled back and the KB stayed empty
- Fix 500 on upload: refresh document after ingest so server-generated timestamps serialize without a `MissingGreenlet` error
- Fix semantic search returning no results: corrected repository session attribute (`self._session`→`self.session`) and switched to typed pgvector `cosine_distance`
- Fix Google shared-drive browsing: list shared-drive roots via `corpora`+`driveId`; Drive search now spans all drives
- Fix ingestion root cause: document was never added to the session (`self._db.add(doc)`), leaving null IDs and orphaned files
- Voyage embeddings: per-provider default model resolution, batch embedding, and rate-limit retry; axios timeout raised 30s→120s
- Google Calendar: scope events to the viewed month; raise `maxResults` so recurring events no longer swamp results
- Verified live end-to-end over HTTP: PC upload, Drive import, and semantic search all working

---

### Build 33 — 2026-06-07
**Phase 7: Advanced Features**
- **Bug fix** `meetings.py`: `_llm_summarize` called `get_llm_client(db)` but `db` was not in scope — passes `db` as explicit parameter now; `POST /meetings/{id}/summarize` no longer crashes at runtime
- **7.4 Investor Relations page** (`/investor`): company snapshot metrics, investor-relevant regulatory doc registry (510k/DHF/spec), AI draft generation per doc, recent research report feed, and one-click "Chat with IR Specialist" shortcut
- Investor Relations nav item added to sidebar (TrendingUp icon)
- All Phase 7 capabilities now operational end-to-end:
  - **7.1** Meeting notes — paste transcript, AI summarise, one-click extract action items → tasks
  - **7.2** Regulatory module — doc registry (SOP/510k/DHF/IFU), AI draft, revision tracking, risk items
  - **7.3** Dashboard — AI-generated CEO daily brief with overdue tasks, pending approvals, outlook
  - **7.4** Investor Relations hub — IR doc registry, AI content, research feed, IR chat
  - **7.5** QMS/CAPA — CAPA lifecycle (open/in-progress/closed), root cause, corrective/preventive actions
  - **7.6** Google Docs ingestion — import Drive file directly into Knowledge Base (from Documents page)
  - **7.7** In-app update — GitHub commit comparison + one-click PowerShell update (Settings → Software Update)

---

### Build 32 — 2026-06-08
**Phase 6: LangGraph Multi-Agent System**
- New `backend/services/agent/v2/` package with full LangGraph multi-agent architecture
- **Supervisor** (`supervisor.py`): classifies every user message and routes to the correct specialist agent using an LLM call
- **Seven specialist agents**, each with a tailored system prompt and curated tool subset:
  - `ExecutiveAssistantAgent` — default handler; email, tasks, calendar, Drive, comms
  - `ResearchAgent` — web research, literature, competitive analysis, cited reports
  - `RegulatoryAgent` — FDA 510(k), DHF, IFU, ISO 13485/14971, IEC 60601-1 strategy
  - `QMSAgent` — CAPA, SOPs, NCRs, document control, audit support
  - `IRAgent` — pitch decks, investor updates, market sizing, data room prep
  - `EngineeringAgent` — hardware/firmware specs, BOM, V&V, test protocols
  - `OperationsAgent` — procurement, supply chain, production scheduling, vendor management
- **`BaseAgent`** (`base_agent.py`): shared async streaming loop with tool-call dispatch; LangChain `bind_tools()` pattern
- **`lc_tools.py`**: LangChain `@tool`-decorated wrappers that delegate to the existing `dispatch_tool()` — zero code duplication
- **Feature flag** `llm.use_langgraph` (default `"false"`) in `system_settings` — set to `"true"` to activate v2 routing
- **v1 AgentExecutor remains fully operational** — toggled off at WebSocket entry point in `main.py`; zero user-facing disruption
- Added `llm.use_langgraph` to `EXPOSED_KEYS` and `DEFAULTS` in `settings.py`

---

### Build 31 — 2026-06-07
**Phase 5: Approval Workflow Completeness**
- `POST /approvals/{id}/resolve` now executes the approved action immediately after human sign-off
- `send_email` intent: calls `gmail_send()` from payload (`to`/`recipient_email`, `subject`, `body`/`draft_body`)
- `create_calendar_event` intent: calls `calendar_create_event()` from payload fields
- Email drafts with `draft_id` in payload are updated to `status="sent"` after successful send
- All approval decisions (approved + rejected + execution result) are written to the hash-chained audit log with event types `approval.approved`, `approval.rejected`, `approval.action_executed`, `approval.action_failed`
- Execution result (`status: executed|error|no_action`) returned in the resolve API response
- Approvals UI: displays execution result inline after clicking Approve (green success / red error / grey no-action banner)
- Approve/Reject buttons disabled and show loading state during submission
- Execution failure never rolls back the human approval decision — approval record is always persisted first

---

### Build 30 — 2026-06-07
**Phase 4: Settings UI Completion**
- Added `llm.provider` to `EXPOSED_KEYS` in `settings.py` so LLM provider is correctly persisted
- New `GET /settings/ai-options` endpoint: returns static model lists per provider (Anthropic, OpenAI, Voyage, Ollama live)
- Embedding model now uses proper per-provider `<select>` dropdown (voyage-3/voyage-3-lite, text-embedding-3-large/small, Ollama model list)
- Fixed incorrect dimension hints: Voyage AI info box no longer says "768 dims" (now shows 1024); OpenAI shows 1536/3072
- ⚠ Warning banner appears automatically when `reindex_required=true` (embedding provider/model mismatch)
- [Re-index Now] button opens SSE progress modal showing per-document embedding progress
- Compact LLM ● / Embeddings ● live status row added inside AI Engine settings (polls `GET /settings/health`)
- System Health section now shows Embeddings check row (provider, model, dims) and re-index flag from `GET /health`
- Default `mergedSettings` updated to `anthropic`/`voyage`/1024 dims (was `ollama`/768)

---

### Build 29 — 2026-06-07
**Phase 3: Live API Health Pings**
- `GET /health` now performs real live API calls to verify each provider:
  - Anthropic: `client.messages.count_tokens()` — free, no tokens billed
  - OpenAI: `client.models.retrieve(model)` — free metadata call
  - Voyage AI: `client.embed(["ping"], model=model)` — minimal token usage
  - Ollama: `GET /api/tags` — unchanged
- `GET /health` now includes an `embedding` check block with `provider`, `model`, and measured `dimension`
- `GET /health` now includes `kb_needs_reindex` boolean flag
- New `GET /settings/health` endpoint: lightweight LLM + embedding ping only (no disk/DB), target < 3s response
- Both endpoints run LLM and embedding pings concurrently via `asyncio.gather`

---

### Build 28 — 2026-06-07
**Phase 2: Anthropic/Voyage as Defaults, No Silent Ollama Fallback**
- Default LLM provider changed from Ollama to Anthropic (`claude-sonnet-4-6`)
- Default embedding provider changed from Ollama to Voyage AI (`voyage-3`, 1024 dims)
- LLM router no longer falls back silently to Ollama when a cloud API key is missing — raises `RuntimeError` with a clear Settings link instead
- Removed `get_llm_client_no_db()` — it was never safe to build a client without DB context
- `config.py` defaults updated: `default_llm_model=claude-sonnet-4-6`, `default_embedding_model=voyage-3`, `default_embedding_dimension=1024`
- `DEFAULTS` dict in `settings.py` now defaults to `anthropic` / `voyage` / `voyage-3` / `1024`
- `.env.example` rewritten with `DEFAULT_LLM_PROVIDER`, `DEFAULT_EMBEDDING_PROVIDER`, `DEFAULT_EMBEDDING_DIMENSION`

---

### Build 27 — 2026-06-07
**Phase 1: Native Embedding Dimensions**
- Voyage AI now returns native 1024-dim vectors — previously forced to 768, losing retrieval quality
- OpenAI text-embedding-3-small/large now return native 1536/3072-dim vectors
- Added `PROVIDER_DIMENSIONS` lookup table for all supported providers and models
- `POST /documents/reindex` SSE streaming endpoint: automatically ALTERs the pgvector column dimension, deletes all existing chunks, re-embeds all ready documents through the active provider, streams live progress
- Settings `PUT` now detects embedding dimension mismatch when switching providers and sets `llm.kb_needs_reindex = "true"` automatically
- `SettingsOut` now includes `embedding_dimension: int` and `reindex_required: bool`
- Alembic migration `002`: adds `document_chunks.embedding_dimension` integer column + seeds `llm.embedding_dimension` and `llm.kb_needs_reindex` into `system_settings`
- `DocumentChunkRepository`: new `delete_all_chunks()` and `get_all_document_ids_ready()` methods

---

### Build 26 — 2026-06-07
**Planning: v2 Roadmap, Documentation Suite**
- Created `ROADMAP.md` — 7-phase phased implementation plan with gap analysis, task checklists, acceptance criteria, file change registry, and README update directives per phase
- Created `CHANGELOG.md` — full build history from Build 1 through Build 26 with known/resolved issues table
- Created `USER_GUIDE.md` — end-user guide covering all features, first-time AI setup (two-key workflow), example prompts, and Google Workspace instructions
- Created `DEVELOPER_GUIDE.md` — developer reference covering architecture, tech stack, repo structure, AI/embedding provider internals, agent executor, WebSocket protocol, DB schema, testing, migrations, and security
- Identified critical gap: all embedding providers currently forced to 768 dims; Voyage AI native is 1024, OpenAI native is 1536/3072 — Phase 1 of roadmap addresses this
- Updated `LittleGerry_ProjectPrompt_v2.md` accepted as the authoritative spec superseding the original Ollama-first prompt

---

### Build 25 — 2026-06-07
**Gerry Tool Calls: Anthropic Streaming Rewrite**
- Root cause found: Anthropic streaming client used Raw SSE event string matching which silently dropped `tool_use` blocks — Claude was calling tools but the parser discarded them
- Rewrote `chat_stream` to use `stream.text_stream` (SDK-documented API) + `get_final_message()` for reliable tool extraction
- Gerry now correctly calls Drive, Gmail, Calendar, and KB tools in real time instead of saying "Let me check that right now"
- Confirmed Google credentials are connected and valid — tool execution failure was entirely in the streaming parser

---

### Build 24 — 2026-06-07
**Embedding Service & Gerry Tool-Calling**
- Agent executor now reads `llm.embedding_provider` from DB — was hardcoded to Ollama regardless of Settings
- KB import and semantic search now work correctly with Voyage AI and OpenAI embedding providers
- System prompt strengthened: Gerry calls Drive/Gmail/Calendar tools immediately without a verbal confirmation step
- Search error panel now shows the actual backend error message instead of a hardcoded "Check Ollama" hint

---

### Build 23 — 2026-06-07
**Embedding Provider Resets to Ollama After Save**
- Settings page now invalidates the React Query cache after a successful save — provider was reverting to stale server value
- Embedding provider selection now persists correctly across page reloads
- Added `embedding_provider` and `voyage_key_set` to loading-state defaults

---

### Build 22 — 2026-06-07
**Voyage AI Embeddings — Full Anthropic-Only Support**
- Added Voyage AI as a third embedding provider (Anthropic's official embedding partner, `voyage-3`, 768 dims)
- No database migration required — all providers output 768-dimensional vectors matching the existing schema
- Settings now offers: Ollama (local), Voyage AI (cloud, recommended for Anthropic users), OpenAI (cloud)
- Voyage AI API key stored securely in OS keychain; free tier at dash.voyageai.com (200M tokens/month)
- Removed requirement for Ollama or OpenAI when using Anthropic as the LLM provider

---

### Build 21 — 2026-06-06
**Cloud Embeddings (OpenAI) — Ollama No Longer Required**
- New "Embedding Provider" setting: choose Ollama (local) or OpenAI (cloud)
- OpenAI `text-embedding-3-small` at 768 dims — matches existing KB schema, no migration needed
- Anthropic users without Ollama can now use Knowledge Base and Semantic Search via OpenAI embeddings
- Settings page now clearly shows the embedding section with guidance for non-Ollama users

---

### Build 20 — 2026-06-06
**Bug Fixes — Research, KB, Search, Calendar, Emails**
- Research agent now returns results — `ddgs` package was missing from the venv; installed `ddgs 9.14.4`
- Knowledge Base import: fixed `MissingGreenlet` error on sources relationship serialization
- Document ingestion errors now surface the actual failure reason instead of "check server logs"
- Google Calendar: added Sync button with loading spinner; error banner on sync failure
- Email Drafts: fixed `regenerate_draft` crashing silently (missing `db=` parameter); inline error display added

---

### Build 19 — 2026-06-07
**Google Workspace Integration**
- Import Google Drive files directly into the Knowledge Base from the Documents page
- Google Calendar events appear on the Calendar grid alongside local tasks and meetings
- Import tasks from Google Tasks — select from a list and import in bulk to the Tasks board
- Task attachments: attach Drive files or AI-generated files to any task from the task drawer
- Drive browser now shows company Shared Drives alongside My Drive

---

### Build 18 — 2026-06-06
**Persistent Chat Sidebar + File Generation**
- Persistent assistant panel — stays open while navigating between tabs
- Sidebar sends the current page name as context so the AI knows what you're viewing
- AI can now generate files (TXT, Markdown, CSV, JSON) via the `generate_file` tool
- Download buttons appear automatically in chat when a file is generated
- New Generated Files page to browse and download all AI-created files
- Status bar shows OpenAI, Anthropic, and Ollama connection states

---

### Build 17 — 2026-06-05
**First-Run Setup Wizard**
- After first Google login, a setup wizard appears to configure the AI model
- Choose Anthropic, OpenAI, or Ollama; enter API key or server URL
- Model list loads live from the selected provider
- Connection is tested before proceeding — won't proceed with a broken config

---

### Build 16 — 2026-06-05
**Migration Preparation**
- LLM error frames now show in the chat bubble instead of being silently dropped
- Added `backup-ollama-models.ps1` to back up model files before server migration
- Added `migrate-to-server.ps1` — guided migration day runbook with verification

---

### Build 15 — 2026-06-05
**Remote Ollama Server Support**
- Ollama server URL is now fully configurable — point to any machine on the network
- Health check and model list both use the configured URL (no longer hardcoded to localhost)
- Includes server setup and cleanup PowerShell scripts (`scripts/` folder)

---

### Build 14 — 2026-06-04
**Google Workspace SSO Login**
- Login now uses Google Sign-In — no more email/password form
- Only `@pmi-llc.com` and `@precisianmedical.com` accounts are accepted
- Unknown accounts are rejected with a clear error message

---

### Build 13 — 2026-06-04
**First-Run Setup Fix**
- First-run setup now waits for Docker Desktop to be fully ready (up to 90s) before starting the database
- Setup now polls PostgreSQL with `pg_isready` before running migrations — no more timing failures
- Launcher improved: falls back to launching Docker Desktop.exe if the Windows service fails
- Clear user-facing error messages if Docker doesn't start in time

---

### Build 12 — 2026-06-04
**Database & Stability**
- Launcher now uses `docker compose up` — recreates DB container if deleted
- Backend stderr redirected to `backend/logs/backend_stderr.log` for diagnostics
- Removed spurious import from backend lifespan

---

### Build 11 — 2026-06-04
**First-Message Fix**
- Typing a message before a conversation exists no longer discards it
- Message is now sent automatically once the new conversation + WebSocket are ready

---

### Build 10 — 2026-06-04
**Auth Reliability**
- Fixed token refresh URL (was hitting Vite dev server instead of backend)
- Access token now persisted across restarts to avoid broken-auth loop

---

### Build 9 — 2026-06-04
**Google OAuth — Full Consent**
- Added `prompt=consent` so Google always shows all scopes on reconnect
- Prevents Google's cache from silently dropping newly added scopes

---

### Build 8 — 2026-06-04
**Character Encoding & Google Hallucination Fix**
- Fixed garbled characters in chat and documents UI
- AI now told explicitly when Google is not connected — stops fabricating file lists

---

### Build 7 — 2026-06-04
**Backend Health Indicator on Login**
- Login page polls `/health` every 3s and shows Connected / Connecting / Not reachable
- Form disabled until backend is confirmed healthy
- Backend retries DB connection up to 10× on startup (handles slow Docker starts)

---

### Build 6 — 2026-06-03
**Login UX**
- Remember email checkbox persists login email in localStorage
- Login errors now classified: network vs auth vs server

---

### Build 5 — 2026-06-03
**Update Checker UX**
- Settings → Update section shows real states: checking, up-to-date, update available
- Install button and error detail visible instead of silent failures

---

### Build 4 — 2026-06-03
**In-App Service Menu**
- `···` menu in sidebar header: Restart Services, Update, Update & Restart, Stop All
- Calls backend control endpoints — no need to use system tray

---

### Build 3 — 2026-06-02
**System Tray Controls**
- Tray menu: Restart Services, Update, Update & Restart, Stop All Services
- Backend control-file polling for cross-process commands

---

### Build 2 — 2026-06-01
**Cloud Model Switcher**
- Header dropdown to switch LLM provider (OpenAI / Anthropic / Ollama)
- API key input inline for cloud providers; saves via `PUT /settings`

---

### Build 1 — 2026-05-31
**Initial Release**
- AI chat with tool use (Drive, Gmail, Calendar, Contacts, Tasks, web search)
- Knowledge base with document upload and vector search
- Projects, Tasks, Calendar, Approvals, Audit Trail
- Google Workspace OAuth integration
- System tray launcher with splash screen

---

## Known Issues

### Open / Unresolved

| # | Area | Description | Status |
|---|------|-------------|--------|
| 1 | Embeddings | Ollama embedding mode requires Ollama running locally with `nomic-embed-text` pulled — not installed automatically by the current installer | Open |
| 2 | KB / Search | After switching embedding provider in Settings, existing document chunks embedded with the old provider will return poor or no results until documents are re-embedded | Open |
| 3 | Google OAuth | Google OAuth scopes cached by Google may silently drop newly added permissions on reconnect — requires `prompt=consent` workaround (applied in Build 9) | Mitigated |
| 4 | TypeScript | `tsconfig.app.json` shows a deprecation warning for `baseUrl` in TypeScript 6.0 — suppressed with `ignoreDeprecations: "6.0"` | Mitigated |
| 5 | Docker | On some machines, Docker Desktop takes >90s to start, causing the first-run setup to time out and fail | Open |
| 6 | Windows only | `backend/.venv` setup and `launcher.py` are Windows-only; Linux/macOS require manual setup | Open |
| 7 | Voyage AI | Free tier (200M tokens/month) is sufficient for personal use but may be insufficient for large-scale document ingestion | By design |

### Resolved This Session (Builds 34–35)

| # | Area | Description | Resolved |
|---|------|-------------|---------|
| R21 | Notifications | `GET /notifications` 500'd (`ResponseValidationError`) whenever a notification linked to an entity — `entity_id` typed `str` not `UUID` | Build 37 |
| R20 | Database / Migrations | New tables created by Alembic were owned by the `pmi` superuser, not the app's `pmi_app` role → `permission denied` 500s on new endpoints; migrations now run as `pmi` and `ALTER ... OWNER TO pmi_app` per table (refined in Build 37) | Build 36 |
| R11 | KB / Upload | Upload and Drive-import routes never committed — documents rolled back, KB stayed empty | Build 34 |
| R12 | KB / Upload | `MissingGreenlet` 500 on upload — doc not refreshed before timestamp serialization | Build 34 |
| R13 | Search | No results — repository used undefined `self._session`; vector distance not typed | Build 34 |
| R14 | KB / Documents | `GET /documents` 500 — `PaginationParams` missing `limit` property | Build 35 |
| R15 | KB / Documents | Delete and edit silently rolled back — routes flushed but never committed | Build 35 |
| R16 | KB / Drive | DOCX import failed — `export()` returns 403 for non-Google files; now parsed with python-docx | Build 35 |
| R17 | KB / Drive | "Failed to open stream" — extracted Drive text kept a `.pdf` name and was PDF-parsed | Build 35 |
| R18 | Email Drafts | Every generate 500'd (masked as CORS "Network Error") — `EmailDraftOut` timestamps typed as `str` not `datetime` | Build 35 |
| R19 | Desktop UI | Could not select/copy text in chat or display fields — pywebview disables `user-select` by default | Build 35 |

### Resolved (Builds 20–25)

| # | Area | Description | Resolved |
|---|------|-------------|---------|
| R1 | Research | Research agent returned no output — `ddgs` package missing from venv (old `duckduckgo_search` package installed instead) | Build 20 |
| R2 | Research | `run_research` called `db.refresh(report)` which doesn't reload relationships — `MissingGreenlet` on Pydantic serialization | Build 20 |
| R3 | KB Import | Document ingestion failed silently with generic "check server logs" message | Build 20 |
| R4 | Calendar | No Sync button for Google Calendar — had to navigate away and back to refresh | Build 20 |
| R5 | Email Drafts | `regenerate_draft` endpoint called `_llm_draft_email()` without `db=` parameter — silent `TypeError`, no output, no error shown | Build 20 |
| R6 | Embeddings | Embedding service hardcoded to Ollama in agent executor regardless of Settings — KB search always tried Ollama | Build 24 |
| R7 | Embeddings | Embedding provider selection in Settings reverted to "Ollama" after every Save — React Query cache not invalidated | Build 23 |
| R8 | Gerry / Tools | Gerry responded "Let me check that right now" then stopped — Anthropic streaming parser used Raw SSE event string matching which silently discarded `tool_use` blocks | Build 25 |
| R9 | Gerry / Drive | When Google was connected, Gerry described what it was about to do rather than calling the tool immediately | Build 24 |
| R10 | Search UI | Search error always showed hardcoded "Check that Ollama is running" message regardless of actual error | Build 24 |
