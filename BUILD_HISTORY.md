# Little Gerry — Build / Commit Reference

Use this file to identify the exact GitHub commit for any build and roll back if needed.

## Milestones (annotated tags)

| Tag | SHA | Date | Notes |
|-----|-----|------|-------|
| **`v1.1.0`** | `f562e0e` | 2026-06-09 | Auto-update reliability (updater survives app exit via ShellExecute) + scrollable, collapsible sidebar. |
| **`v1.0.7`** | `e0f4cc7` | 2026-06-09 | Auto-updater hardening — suppressible install dialogs, skip winget on silent update, logging + guaranteed relaunch. |
| **`v1.0.5`** | `880c00e` | 2026-06-09 | Fix "Check for Updates" 502 — installed-app-aware update check (authenticated Releases API). |
| **`v1.0.4`** | `767bcb1` | 2026-06-09 | Fix Google Drive PDF/DOCX imports (match upload extractor). |
| **`v1.0.3`** | `fa13fd9` | 2026-06-09 | Fix Knowledge Base imports — default embedding provider to Voyage. |
| **`v1.0.2`** | `19be119` | 2026-06-09 | Resilient embeddings — retry transient Voyage errors. |
| **`v1.0.1`** | `46d8cd4` | 2026-06-09 | Silent auto-update + admin self-lockout guard. |
| **`v1.0.0`** | `d04982a` | 2026-06-09 | First signed public release — code-signing + publisher trust kit. |
| **`v0.9.0`** | `28fb46d` | 2026-06-08 | First milestone build — core features working well. Check out with `git checkout v0.9.0`. |

## Rollback command

```bash
# Hard reset to a specific commit (replace SHA with the hash from the table below)
git checkout <SHA>
# To restore a previous build in production:
cd backend && .venv\Scripts\python.exe -m alembic downgrade <target_revision>
git reset --hard <SHA>
git push origin master --force  # only if you want to revert remote
```

---

## Build → Commit Map

| Build | SHA       | Date       | Description |
|-------|-----------|------------|-------------|
| **v1.1.0 (b43)** | `f562e0e` | 2026-06-09 | **Auto-update fix (definitive) + sidebar** — the updater is now handed off via `os.startfile`/ShellExecute (`launcher.py` `_launch_updater`) so it is reparented to Explorer, **outside** the launcher's kill-on-close Job Object, and survives `os._exit(0)` to install + relaunch. `CREATE_BREAKAWAY_FROM_JOB` (v1.0.9) was rejected by the job and was not enough; proven with a controlled kill-on-close-job repro (detached = killed, ShellExecute = survives). Also ships the scrollable, collapsible sidebar (b41). Verified end-to-end: installed app auto-updated 1.0.8 → 1.1.0 |
| _v1.0.10_ | `e272d24` | 2026-06-09 | _Withdrawn — version bump committed but the publish hung at signing; no tag/release was ever created. Superseded by v1.1.0 (skipped to 1.1.0 by preference)._ |
| **v1.0.9 (b42)** | `ea29035` | 2026-06-09 | **Auto-update — first job-kill attempt** — spawn `apply_update.ps1` with `CREATE_BREAKAWAY_FROM_JOB` so a kill-on-close Job Object wouldn't terminate the detached updater on launcher exit. (Insufficient: the job forbids breakaway; fixed for real in v1.1.0.) |
| **v1.0.8 (b41)** | `dd3332c` | 2026-06-09 | **Tidier sidebar** — left nav now scrolls on overflow (`overflow-y-auto` + `min-h-0`) and is grouped into collapsible sections (Work, Knowledge, Communications, Compliance, Administration) with Dashboard/Little Gerry/Daily Assistant pinned; collapsed sections bubble up pending-count badges; active section auto-expands; collapse state persisted in `localStorage` (`frontend/src/components/layout/Sidebar.tsx`) |
| **v1.0.7** | `e0f4cc7` | 2026-06-09 | **Auto-updater hardening** — root-caused field failure ("app quits at Installing update"): Inno `[Code]` used a plain `MsgBox()` that `/SUPPRESSMSGBOXES` does NOT suppress, blocking the headless silent update forever. Switched both dialogs to `SuppressibleMsgBox`; added `skipifsilent` to the `install.ps1` `[Run]` entry; `apply_update.ps1` now logs to `backend/logs/apply_update.log`, kills the `pythonw` launcher, checks the installer exit code, and always relaunches (`installer/setup.iss`, `scripts/apply_update.ps1`) |
| _v1.0.6_ | `684a659` | 2026-06-09 | _Withdrawn — release + tag deleted; only v1.0.5 is retained as a fallback. The **Daily Assistant** feature it introduced (commit `30ce4f9`) lives on in v1.0.7+._ |
| **v1.0.6 feature** | `30ce4f9` | 2026-06-09 | **Daily Assistant** — once-a-day background scan of Gmail + Google Tasks surfaces suggestions for human review (`AssistantSuggestion` model + migration `007`, `services/assistant/daily_scan.py`, `routers/assistant.py`, `_assistant_scan_loop` in `main.py`, `AssistantPage.tsx`, sidebar nav) |
| **v1.0.5** | `880c00e` | 2026-06-09 | **Fix "Check for Updates" 502** — the `/update/check` endpoint hit GitHub's *commits* API unauthenticated against the private repo (→ 502), and the git-based apply couldn't run on installed (non-git) copies. `routers/update.py` is now installed-app-aware: check compares `VERSION` vs latest **GitHub Release** with the baked-in read-only token; **Install Update** downloads + applies the signed installer via `apply_update.ps1`; dev checkouts keep the authenticated commit/`git pull` path |
| **v1.0.4** | `767bcb1` | 2026-06-09 | **Fix Drive PDF/DOCX import** — Drive imports failed with "Could not extract text" on PDFs that uploaded fine; the Drive path used pypdf (empty text on many PDFs) + truncated to 10k chars. Now hands raw bytes to the ingestion pipeline so PDFs extract via **PyMuPDF** and DOCX via **python-docx** (identical to upload); in-place extraction upgraded pypdf→PyMuPDF for the agent reader + update-sync |
| **v1.0.3** | `fa13fd9` | 2026-06-09 | **Fix KB imports — default embedding provider to Voyage** — missing `llm.embedding_provider` made ingestion fall back to a non-running Ollama (`localhost:11434`) → "All connection attempts failed"; now falls back to `settings.default_embedding_provider` (Voyage) |
| **v1.0.2** | `1d35024` | 2026-06-09 | **Resilient embeddings** — `VoyageEmbeddingService` retries transient errors (connection failures, timeouts, 5xx, rate limits) with backoff so a brief blip doesn't fail a whole ingestion |
| **v1.0.1** | `c3ed5a3` | 2026-06-09 | **Silent auto-update + admin self-lockout guard** — installed app pulls newer signed installer from GitHub Releases on launch (`launcher.py`, `scripts/apply_update.ps1`); admins can't deactivate their own account or drop their own admin role (`routers/users.py`) |
| **v1.0.0** | `d04982a` | 2026-06-09 | **Signed installer + publisher trust kit** — code-signing cert + one-click `Trust-Little-Gerry.bat` (`installer/cert/`); add missing `voyageai` dependency; exclude personal `google_token.json`/`.env` from bundle; post-install success popup |
| **40** | `d068996` | 2026-06-08 | **Startup self-heal** — fix `container name "/pmi_postgres" is already in use` crash; `launcher.py` + `Start Little Gerry.bat` now `docker rm -f pmi_postgres` if this project doesn't own it before `docker compose up` (volume preserved) |
| 39    | `2952ece` | 2026-06-08 | security: stop tracking `backend/google_credentials.json` (held an OAuth client secret) + gitignore; rotate the secret in Google Cloud |
| **39** | `e24a182` | 2026-06-08 | **Email invites + SSO auto-provision + auto-update** — admin-only `POST /users/invite` (Gmail link to installer); accounts auto-created on first Google sign-in (owner→admin, others→full-access member); `admin_email` + `installer_download_url` settings; `launcher.py` pulls latest on launch (`git reset --hard origin/master`, `uv sync`, `npm install`) + always runs `alembic upgrade head` (skips on dirty tree) |
| **38** | `c8942c5` | 2026-06-08 | **First-use setup wizard** — one-time guided onboarding (welcome, why Docker/Python, connect Claude + Voyage with pre-set defaults, optional Google, usage tour, roles); `users.onboarding_complete` flag + migration `006` + `POST /settings/onboarding/complete`; replaces `FirstRunSetup` |
| **37** | `d7a164b` | 2026-06-08 | **In-app feedback** — top-bar Feedback button (Bug/Feature + text) → `feedback` table + owner notifications; `FEEDBACK_SUBMITTED` type; migration 005; fix `GET /notifications` 500 (`entity_id` UUID); migrations run as `pmi` + `OWNER TO pmi_app` |
| **36** | `9358efe` | 2026-06-08 | **Regulatory file explorer + per-user write permission** — folder/file tree with create/upload/import-from-Drive/edit/rename/move/delete; `can_write_regulatory` flag + `require_regulatory_write`; migration 004; fix Alembic table ownership (env.py uses app role) |
| **35 🏷 `v0.9.0`** | `28fb46d` | 2026-06-08 | **Milestone build** — Enable text selection/copy in desktop window (pywebview `text_select=True`) |
| 35    | `c9f3f11` | 2026-06-08 | feat: automatic Google Drive document update detection (background scan 06:00/12:00/18:00 + manual check; flag modified/renamed/deleted for human approval; apply/dismiss; migration 003) |
| 35    | `2d3445d` | 2026-06-08 | fix(emails): type `EmailDraftOut` timestamps as datetime (str caused 500 on every draft generate) |
| 35    | `f1ed410` | 2026-06-08 | fix(drive-import): parse uploaded .docx via python-docx (export() returns 403 fileNotExportable for non-Google files) |
| 35    | `44a3a4c` | 2026-06-08 | feat(kb): show in-modal progress bar + per-file status during Drive import |
| 35    | `8421ead` | 2026-06-08 | fix(documents): commit on delete and update so changes persist (get_db never auto-commits) |
| 35    | `739c232` | 2026-06-08 | fix(documents): add `limit` property to PaginationParams so GET /documents stops 500ing |
| 35    | `e6fe196` | 2026-06-08 | fix(drive-import): use text extension for extracted Drive content so ingestion doesn't PyMuPDF-parse plain text |
| 35    | `64c043b` | 2026-06-08 | fix(kb): surface real Drive import/upload error messages instead of swallowing them |
| 34    | `66a5f9e` | 2026-06-08 | docs: complete Build 34 in BUILD_HISTORY (key files row + footer date) |
| 34    | `e305836` | 2026-06-08 | docs: bump to Build 34 + record KB/search end-to-end fixes |
| **34** | `f878479` | 2026-06-08 | **KB & Search end-to-end fixes** — persist uploads/imports (missing `db.commit()`); refresh doc before serialize (MissingGreenlet 500) |
| 34    | `990436e` | 2026-06-08 | fix(search): correct `self._session`→`self.session`; typed `cosine_distance` in vector_search |
| 34    | `c0e3aaa` | 2026-06-07 | fix: add missing `self._db.add(doc)` in ingestion — root cause of all import failures; shared drive browsing (corpora+driveId); drive_search across all drives |
| 34    | `d1f3c43` | 2026-06-07 | fix: DocumentOut schema fields (file_extension→file_name, created_by_id→created_by); drop token_count; doc.filename→doc.file_name; Voyage retry; axios timeout 30s→120s |
| 34    | `60f4305` | 2026-06-07 | fix: knowledge base ingestion — 5 ORM bugs + vector dimension mismatch + Voyage rate-limit retry |
| 34    | `807703b` | 2026-06-07 | fix: embedding model mismatch — per-provider default model resolution (no nomic-embed-text to Voyage/OpenAI) |
| 34    | `7dec9ae` | 2026-06-07 | fix: Google Calendar query scoped to viewed month |
| 34    | `ff00d9f` | 2026-06-07 | docs: update BUILD_HISTORY — ChatSidebar fix, BUILD_HISTORY creation, Calendar fix |
| 33+   | `54e6dbb` | 2026-06-07 | fix: Google Calendar maxResults 50→500; days_behind 30→7 — recurring events no longer swamp the result set |
| 33+   | `8f2abbe` | 2026-06-07 | docs: add BUILD_HISTORY.md rollback reference |
| 33+   | `8d08b23` | 2026-06-07 | fix: ChatSidebar WebSocket — wrong URL, send format, broken handler; add streaming bubble |
| 33+   | `895ce25` | 2026-06-07 | fix: JSX comment syntax typos in ApprovalsPage + SettingsPage |
| 33+   | `7f8b593` | 2026-06-07 | docs: update README, USER_GUIDE, DEVELOPER_GUIDE to Build 33 |
| **33** | `894b7a4` | 2026-06-07 | **Phase 7 — Advanced Features** (InvestorPage, meetings bug fix) |
| **32** | `1942182` | 2026-06-08 | **Phase 6 — LangGraph multi-agent system** (7 specialist agents, supervisor, lc_tools, feature flag) |
| 31+   | `bec7cb8` | 2026-06-07 | chore: remove temp script |
| **31** | `3423c50` | 2026-06-07 | **Phase 5 — Approval execute-on-approve + audit trail** |
| **30** | `7d221aa` | 2026-06-07 | **Phase 4 — Settings UI: model dropdowns, re-index modal, live health panel** |
| **29** | `bde4e4e` | 2026-06-07 | **Phase 3 — Live API health pings, GET /settings/health** |
| 29+   | `299a1ea` | 2026-06-07 | docs: README update for Phases 1–3 |
| **28** | `e4088f2` | 2026-06-07 | **Phase 2 — Anthropic/Voyage defaults, remove silent Ollama fallback** |
| **27** | `009a243` | 2026-06-07 | **Phase 1 — Native embedding dimensions, reindex endpoint, dimension mismatch detection** |
| 26    | `3d009a6` | 2026-06-07 | docs: README update (Anthropic + Voyage AI) |
| 26    | `936e4eb` | 2026-06-07 | fix: Anthropic streaming — text_stream + get_final_message for reliable tool calls |
| 26    | `d1a6dfc` | 2026-06-07 | fix: embedding reads from DB; Gerry calls tools immediately; search error display |
| 26    | `a3a398a` | 2026-06-07 | fix: embedding provider resets to ollama after save |
| 26    | `9bf4303` | 2026-06-07 | feat: Voyage AI embeddings, full Anthropic-only support |
| 26    | `6017f4d` | 2026-06-07 | feat: OpenAI embeddings, Ollama no longer required for KB |
| 25    | `cd194b9` | 2026-06-07 | chore: bump to build 20 with changelog |
| 25    | `241756b` | 2026-06-07 | fix: 5 prompt bugs |
| 25    | `1a8b3cb` | 2026-06-07 | feat: rename assistant to Little Gerry; fix embedding service URL |
| 25    | `64e9f84` | 2026-06-07 | feat: settings — dark mode, timezone, provider health |
| 25    | `a5deea5` | 2026-06-07 | style: PMI brand colors (#E8000D, #0D0D0D) |
| 19    | `5b7ad2` *  | —          | b19: Chat sidebar, file generation, Google Workspace integration |
| 14    | `1e114fd` | —          | feat: Google Workspace SSO login |
| 13    | `d604031` | —          | fix: first-run Docker + pg_isready wait |
| 12    | `0b86d7c` | —          | feat: progressive build changelog, b12 badge |

_* earlier SHAs may be short-refs; use `git log --oneline` to verify_

---

## Alembic migration checkpoints

| Migration revision | Description |
|--------------------|-------------|
| `007`              | Daily Assistant suggestions (`assistant_suggestions` table) — **current HEAD** |
| `006`              | Add `users.onboarding_complete` flag (first-use wizard) |
| `005`              | Add `feedback` table (in-app bug/feature reports) |
| `004`              | Regulatory file store + per-user `can_write_regulatory` permission |
| `003`              | Document source-update tracking (sync_status, source_modified_at, last_checked_at, sync_detail, source_name) |
| `002`              | Flexible embedding dimensions (Phase 1) |
| `f07c8aa64867`     | Add task_attachments column |
| `9a3c1f2e8b57`     | Add meeting_notes + email_drafts tables |
| `615f52d537b5`     | Add missing columns (agent_runs, approval_intents, conversations…) |
| `001`              | Initial schema — all tables, enums, extensions, indexes |

To roll back one migration step:
```bash
cd backend && .venv\Scripts\python.exe -m alembic downgrade -1
```

To roll back to a specific revision:
```bash
cd backend && .venv\Scripts\python.exe -m alembic downgrade 615f52d537b5
```

---

## Key files changed per build phase

| Build | Key files |
|-------|-----------|
| 35 | `backend/services/documents/sync.py` (new), `backend/migrations/versions/003_add_document_sync_tracking.py` (new), `backend/services/documents/ingestion.py`, `backend/services/google_service.py`, `backend/routers/documents.py`, `backend/routers/google_integration.py`, `backend/models/db/document.py`, `backend/models/schemas/documents.py`, `backend/main.py`, `frontend/src/pages/DocumentsPage.tsx`, `frontend/src/api/documents.ts`, `frontend/src/types/documents.ts`, `launcher.py`, `frontend/src/version.ts` |
| 34 | `backend/routers/documents.py`, `backend/routers/google_integration.py`, `backend/services/documents/ingestion.py`, `backend/repositories/document_repo.py`, `backend/services/google_service.py`, `backend/services/embeddings/service.py`, `frontend/src/version.ts` |
| 33 | `frontend/src/pages/InvestorPage.tsx` (new), `backend/routers/meetings.py` |
| 32 | `backend/services/agent/v2/` (new package — 9 files), `backend/main.py`, `backend/routers/settings.py` |
| 31 | `backend/routers/conversations.py`, `frontend/src/pages/ApprovalsPage.tsx`, `frontend/src/types/chat.ts` |
| 30 | `frontend/src/pages/SettingsPage.tsx`, `backend/routers/settings.py` |
| 29 | `backend/routers/health.py`, `backend/routers/settings.py` |
| 28 | `backend/services/llm/router.py`, `backend/routers/settings.py`, `backend/config.py` |
| 27 | `backend/migrations/versions/002_embedding_dimension_flexible.py`, `backend/services/embeddings/service.py`, `backend/models/db/document.py` |

---

*Updated: 2026-06-09 — v1.1.0 / Build 43 (definitive auto-update fix via ShellExecute hand-off + scrollable, collapsible sidebar). Fallback tag retained: `v1.0.5` (commit `880c00e`).*
