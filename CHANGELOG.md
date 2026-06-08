# Little Gerry — Changelog & Known Issues

---

## Changelog

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
