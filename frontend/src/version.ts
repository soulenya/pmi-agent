/**
 * Little Gerry — build changelog.
 * Increment BUILD_NUMBER and add an entry to CHANGELOG with every improvement.
 */

export const BUILD_NUMBER = 66;
export const BUILD_DATE = "2026-06-11";

export interface ChangelogEntry {
  build: number;
  date: string;
  title: string;
  changes: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    build: 66,
    date: "2026-06-11",
    title: "HAL-9000 Little Gerry",
    changes: [
      "Clicking the Sun now zooms into a large HAL-9000-style red eye — click the eye to start or stop a voice session; it breathes while listening and pulses while Gerry speaks",
      "A small Type button inside the red opens the classic text chat as the secondary option",
      "On the solar-system overview, the Sun's name stays hidden until you hover over it, and its glow is three times stronger",
    ],
  },
  {
    build: 65,
    date: "2026-06-11",
    title: "The planets actually orbit now",
    changes: [
      "Fixed orbits being completely frozen — the animation was silently disabled whenever Windows has 'Animation effects' turned off; planets and moons now always drift on their orbits",
      "Zoom in/out transitions still soften to fades when your system prefers reduced motion",
    ],
  },
  {
    build: 64,
    date: "2026-06-11",
    title: "Visible orbits and a reachable service menu",
    changes: [
      "Planets now sweep around Little Gerry at one revolution per minute — like the second hand of a clock — so the motion is actually perceptible",
      "The service controls menu (Restart, Update, Stop) moved from the bottom-left rail — where its dropdown was cut off by the window edge — to the top bar next to Search",
    ],
  },
  {
    build: 63,
    date: "2026-06-11",
    title: "Gerry can see your Drive's top-level folders",
    changes: [
      "New list_shared_drives tool — Little Gerry and the specialists can now list your shared (team) drives, the top-level trees like Communications, Knowledge and Compliance that sit beside My Drive",
      "list_drive_folder can now browse inside a shared drive's root (new drive_id option)",
      "Fixed a bug where browsing a Drive folder silently passed the result limit as the drive ID",
    ],
  },
  {
    build: 62,
    date: "2026-06-11",
    title: "Galaxy polish — cleaner planets, hover previews, red Gerry",
    changes: [
      "Planets are now black in light mode and white in dark mode, with their category color on the icon",
      "Planet names no longer float on the canvas — hover over a planet to see its name and a preview of its moons",
      "Little Gerry is now always red",
      "Orbits moved outward so Dashboard and the Daily Assistant no longer crowd the Sun",
      "All planets sweep around Little Gerry at one slow, uniform pace — like the minute hand of a clock",
    ],
  },
  {
    build: 61,
    date: "2026-06-11",
    title: "Solar-system navigation — the sidebar becomes a galaxy",
    changes: [
      "The left menu is now a solar system: Little Gerry is the Sun (click to chat or talk), Dashboard and the Daily Assistant orbit close-in, and the five categories — Work, Knowledge, Communications, Compliance, Administration — are planets whose moons are the feature pages",
      "Click a planet to zoom in, click a moon to open the page; notification and approval counts appear on the relevant moons and roll up onto their planets",
      "A narrow rail on the left shows where you are (Sun → planet → page) as back buttons, and Esc zooms out one level; the Service menu and build badge moved to the bottom of this rail",
      "Your position is part of the URL and is restored after a restart; all existing links, the command palette and voice navigation keep working unchanged (Dashboard now lives at /dashboard)",
      "New Agents page under Administration: a live, read-only directory of the multi-agent system — the supervisor, the House Manager, the seven specialists and the core chat agent, each with its tools and where you meet it",
      "Orbits pause and zooms become gentle fades if your system prefers reduced motion",
    ],
  },
  {
    build: 60,
    date: "2026-06-11",
    title: "Little Gerry House Manager — voice sessions get an app-wide custodian",
    changes: [
      "Voice sessions now talk to the House Manager, a custodian agent that oversees the whole app: it can list, read, rename, pin, archive and delete conversations, manage generated files, tasks, schedules and knowledge base documents, and report on settings, users, the audit trail and approvals (those four are strictly read-only)",
      "The House Manager can delegate work to any specialist agent (research, regulatory, QMS, IR, engineering, operations, executive assistant) and report back — up to five delegations per turn",
      "Destructive actions (deleting anything, disabling schedules) and Google Drive uploads always require your spoken confirmation first",
      "The voice panel now shows what Gerry is doing while thinking (\"Asking a specialist…\", \"Searching the web…\")",
    ],
  },
  {
    build: 59,
    date: "2026-06-11",
    title: "Voice button promoted to the top bar",
    changes: [
      "The \"Talk with Little Gerry\" button moved from the bottom corner to the center of the top bar — always visible on every page, with a faint pulsing glow and shimmer",
      "While a session is running the button turns into \"End voice session\"; the live status panel still appears bottom-right",
    ],
  },
  {
    build: 58,
    date: "2026-06-10",
    title: "Gerry no longer reads emojis aloud",
    changes: [
      "Emojis and symbols (\u2705 \u26a0\ufe0f \ud83d\ude80 \u2192 \u2026) are now stripped from spoken replies, so Gerry won't say things like 'rocket' or 'warning sign' mid-sentence \u2014 they still appear in the on-screen text",
    ],
  },
  {
    build: 57,
    date: "2026-06-10",
    title: "Talk with Little Gerry from anywhere",
    changes: [
      "New floating \"Talk with Little Gerry\" button in the bottom-right corner of every page — ask Gerry to create a file, look something up, or anything else without leaving what you're doing",
      "Each session starts a fresh conversation that appears in your chat history, with a \"View conversation\" shortcut on the voice panel",
      "Same hands-free loop as Voice chat: speak, pause, Gerry answers aloud and listens again — with Interrupt and Esc to end",
    ],
  },
  {
    build: 56,
    date: "2026-06-10",
    title: "Long generated files no longer cut off",
    changes: [
      "Fixed long documents and reports being truncated mid-sentence: the AI's response limit was capped at roughly 3,000 words per file — it's now 8\u00d7 larger, so lengthy reports, plans, and Word documents generate in full",
    ],
  },
  {
    build: 55,
    date: "2026-06-10",
    title: "Voice conversations — talk with Little Gerry hands-free",
    changes: [
      "New Voice chat button in Chat: speak naturally, pause, and Gerry answers out loud — then listens for your reply automatically, no clicking between turns",
      "A live status banner shows what's happening (listening / got it / thinking / speaking), with an Interrupt button to cut Gerry off mid-sentence and Esc to exit",
      "Requires the Google Cloud voice key (same one that powers the mic button)",
    ],
  },
  {
    build: 54,
    date: "2026-06-10",
    title: "Research search fixed, updates keep dependencies in sync",
    changes: [
      "Fixed Research returning zero results: the old DuckDuckGo search package stopped working and the replacement was missing from installed apps — search now uses the working package only and reports clearly if it's unavailable",
      "App updates now refresh behind-the-scenes dependencies on every launch, so future releases that add new components can't silently break features",
    ],
  },
  {
    build: 53,
    date: "2026-06-10",
    title: "Run now actually runs — scheduled tasks fixed",
    changes: [
      "Fixed Run Now on Scheduled Tasks silently doing nothing: long runs were cut off after 2 minutes by the browser's request timeout, so no report was produced and no failure was recorded",
      "Run Now starts the task in the background and returns immediately — the task card shows a live ⟳ running… status and updates with the result when it finishes",
      "A task can't be started twice at once, and runs interrupted by an app restart are now marked failed instead of appearing stuck",
    ],
  },
  {
    build: 52,
    date: "2026-06-10",
    title: "Choose where downloads go + full knowledge base listing",
    changes: [
      "Downloading a regulatory or generated file now asks where it should go: pick an exact folder on your computer (native Save-As dialog) or upload straight to Google Drive",
      "The Google Drive option lets you browse My Drive and shared drives, pick the destination folder, and shows exactly where the file landed with an Open in Drive link",
      "Fixed the Knowledge Base only showing the first 25 documents — all imported documents now appear and the Total documents stat is accurate (your other documents were always stored and searchable; only the list was cut off)",
    ],
  },
  {
    build: 51,
    date: "2026-06-10",
    title: "Calendar on the Dashboard, smarter setup wizard",
    changes: [
      "Dashboard now scans your Google Calendar: today's events appear in Today's Agenda and a new Upcoming Events card shows the next 7 days (only when Google is connected)",
      "Setup wizard gains a Voice step explaining the Google Cloud API key — including that PMI's company cloud project may already have one — with in-wizard key entry",
      "Setup wizard's “Using it” tour refreshed to cover voice chat, the Generate Document wizard, per-task models, and the Dashboard",
      "Fixed Models per Task wrongly showing “provider key not configured” when a recommended model exists under a dated name (e.g. claude-haiku-4-5-20251001)",
    ],
  },
  {
    build: 50,
    date: "2026-06-10",
    title: "Talk to Little Gerry — voice input and spoken replies",
    changes: [
      "New microphone button in chat: click, speak, click again — your words appear in the message box as editable text before you send",
      "Optional “Speak replies aloud”: Little Gerry reads chat answers out loud in a natural Google Neural2/Studio voice, selectable in Settings → Voice",
      "Powered by Google Cloud Speech — audio is processed by your own Google Cloud project (where your Workspace data already lives) and never stored",
      "Voice features appear only when a Google Cloud API key is saved in Settings → Voice (stored in the OS keychain, like all other keys)",
    ],
  },
  {
    build: 49,
    date: "2026-06-10",
    title: "Generate FDA & ISO documents from templates",
    changes: [
      "New “Generate Document” wizard on the Regulatory Files page: create 510(k) outlines, Design Control plans, CAPA and Complaint Handling SOPs, DHF indexes, ISO 13485 Quality Manuals, ISO 14971 Risk Management Plans & Reports, generic SOPs, and EU Declarations of Conformity",
      "The wizard asks what you want to create, researches and recommends the best-practice section structure and output format (Word .docx or in-app-editable Markdown), and lets you adjust both before generating",
      "Optional auto-populate fills in PMI and VACTOR specifics from the company profile and knowledge base — anything unknown is left as an explicit [FILL IN: …] placeholder, never invented",
      "Generated files land directly in the Regulatory file store as editable documents and are labelled “Generated” in the Source column",
      "After generating, Little Gerry recommends a one-click high-priority review task (due in one week) so AI-drafted content always gets a human review",
    ],
  },
  {
    build: 48,
    date: "2026-06-10",
    title: "Pick a model per task + live model catalog + tidier Settings",
    changes: [
      "New “Models per Task” in Settings: choose a different AI model for each kind of work — Chat & Agent, Daily Assistant, Briefings, Email Drafting, Meetings, Regulatory, and Research — each with a ★ recommended pick and a one-line reason",
      "Every category defaults to your global model; overrides are always your explicit choice and Little Gerry never switches models on its own",
      "Model lists are now discovered live from each provider and only show providers with an active API key (no OpenAI models offered if no OpenAI key is set); newly released models are flagged · NEW",
      "The model catalog rescans automatically every week, immediately after you add a new API key, and on demand via the “Refresh model list” button",
      "Settings page sections are now collapsible menus (like the sidebar) and start condensed, so the page is much easier to scan",
    ],
  },
  {
    build: 47,
    date: "2026-06-10",
    title: "Research search fixed + selective Drive sync for Regulatory files",
    changes: [
      "Fixed Research returning zero results every time — web search now uses the maintained search engine and reliably returns sources for your AI-synthesised reports",
      "New on the Regulatory Files page: a “Check for updates” button that detects when a Drive-linked file has been changed, renamed, or deleted at the source",
      "Because Regulatory is a controlled store, changes are never applied automatically — you review the flagged files and choose exactly which ones to re-import (or dismiss), one by one",
      "Changed files are now badged in the file list (“Update available”, “Renamed in source”, “Source deleted”) so it's clear at a glance what needs attention",
    ],
  },
  {
    build: 46,
    date: "2026-06-10",
    title: "Scheduled tasks, reliable answers when you switch away, and a Drive import fix",
    changes: [
      "New Scheduled Tasks page: set Little Gerry to run a prompt on a repeating schedule — for example, “create a report every Thursday morning about the previous week” — and it runs automatically in the background and notifies you when it's done",
      "Your chat answer is no longer lost if you navigate away mid-reply: Little Gerry now keeps working server-side and saves the answer, so it's waiting for you when you come back",
      "The Little Gerry sidebar chat can now create Word documents and upload to Google Drive, just like the full chat — generated files land on the Generated Files page",
      "Fixed “Import from Drive” showing an empty folder in the Knowledge Base when browsing Google Drive folders",
    ],
  },
  {
    build: 45,
    date: "2026-06-10",
    title: "Create Word documents and upload them to Google Drive",
    changes: [
      "Little Gerry can now create Microsoft Word (.docx) documents on request — reports, memos, weekly updates, meeting notes — and they appear on the Generated Files page ready to download",
      "New: ask Little Gerry to upload a generated file to your Google Drive and it returns a shareable link (reconnect Google in Settings to grant upload access)",
      "Complex multi-step requests (search → gather many items → build a document → upload) no longer stop early with “maximum tool call rounds” — the limit was raised and the assistant now always writes its final answer instead of erroring",
    ],
  },
  {
    build: 44,
    date: "2026-06-09",
    title: "Fixed chat errors on the newest Claude models",
    changes: [
      "Fixed “LLM error… `temperature` is deprecated for this model” when chatting after switching to one of the newest Claude models",
      "Little Gerry now automatically adapts to models that no longer accept the temperature setting, so chat works across every available model",
    ],
  },
  {
    build: 43,
    date: "2026-06-09",
    title: "Auto-update actually applies now — the updater survives the app closing",
    changes: [
      "Fixed updates still failing at “Installing update…”: the updater is now started through the Windows shell so it keeps running after the app closes to swap files, then relaunches automatically",
      "This replaces the previous approach, which the operating system could silently terminate before the update ever began",
    ],
  },
  {
    build: 42,
    date: "2026-06-09",
    title: "Auto-update reliability — the updater no longer gets killed mid-install",
    changes: [
      "Fixed the app quitting at “Installing update…” without ever applying the update",
      "The updater now runs as a fully independent process so it survives the app closing to swap files, then relaunches automatically",
    ],
  },
  {
    build: 41,
    date: "2026-06-09",
    title: "Tidier sidebar — scrollable, with collapsible sections",
    changes: [
      "The left navigation now scrolls when there are more items than fit on screen",
      "Navigation is grouped into collapsible sections (Work, Knowledge, Communications, Compliance, Administration) with Dashboard, Little Gerry, and Daily Assistant pinned at the top",
      "Collapsed sections show a badge with any pending counts inside them, so nothing important gets hidden",
      "The section containing your current page stays open, and your collapsed/expanded choices are remembered between sessions",
    ],
  },
  {
    build: 40,
    date: "2026-06-08",
    title: "Reliable startup — self-heal a leftover database container",
    changes: [
      "Fix the app failing to start with a “container name pmi_postgres is already in use” error when a stale database container was left behind",
      "On launch the app now removes any conflicting leftover database container it doesn’t own before starting its own",
    ],
  },
  {
    build: 39,
    date: "2026-06-08",
    title: "Email invites + Google sign-in onboarding + automatic updates",
    changes: [
      "Invite teammates by email: send a link to download the app and sign in with Google — no passwords to manage",
      "Accounts are created automatically on first Google sign-in; everyone joins as a full-access member, you stay the admin",
      "The Invite dialog is now just an email, optional name, and an optional personal note",
      "The app updates itself on launch — it pulls the latest version and applies any database changes automatically",
    ],
  },
  {
    build: 38,
    date: "2026-06-08",
    title: "First-use setup wizard — guided one-time onboarding",
    changes: [
      "New guided wizard on first login: welcome, how it works (why Docker and Python were installed), and a tour of importing, editing, chatting, and submitting feedback",
      "Walks you through connecting Claude (Anthropic) and Voyage (document search) with the keys your team already has — Claude + Voyage are pre-set as the defaults",
      "Optional Google Workspace connection step, plus an explainer of roles and per-user privileges",
      "Shows only once per user (tracked server-side); change anything later in Settings",
    ],
  },
  {
    build: 37,
    date: "2026-06-08",
    title: "In-app feedback — report bugs / request features from the top bar",
    changes: [
      "New Feedback button in the top bar: open a box, pick Bug or Feature, and write in an issue or request",
      "Submissions are saved and routed to the owner's Notifications (tab + bell), so feedback from any user shows up there",
      "Fix Notifications failing to load (500) when a notification linked to an entity — entity_id type corrected",
      "Fix Alembic migrations: run as the privileged DB role and hand new-table ownership to the app role so endpoints don't hit permission errors",
    ],
  },
  {
    build: 36,
    date: "2026-06-08",
    title: "Regulatory file explorer + per-user write permissions",
    changes: [
      "Regulatory page rebuilt as a file explorer: browse folders, create folders, upload files, import from Google Drive, edit text files, rename, move, and delete",
      "Everyone can read/write all sections except Regulatory; Regulatory write access is granted per user (admins always allowed)",
      "New per-user 'Regulatory write' permission with a toggle on the Users page and a checkbox in the invite dialog",
      "Files are stored locally; renames and moves only update the database (fast, no re-upload)",
      "Import from Drive exports Google Docs/Sheets/Slides to Office formats automatically",
      "Fix Alembic migrations creating tables owned by the wrong DB role (caused permission-denied 500s) — migrations now use the app role by default",
    ],
  },
  {
    build: 35,
    date: "2026-06-08",
    title: "Milestone v0.9.0 — Drive auto-update detection, KB polish, copy fix",
    changes: [
      "Automatic Google Drive document update detection: background scan at 06:00/12:00/18:00 plus a manual 'Check for updates' button",
      "Detects modified, renamed, and deleted source files and flags them for human approval (no auto-overwrite) — Apply update re-imports, Dismiss re-baselines",
      "Records Drive source linkage on import; notifies the owner when a linked file changes",
      "Knowledge Base: in-modal progress bar and per-file status during Drive import",
      "Fix Drive import of uploaded Word files: parse .docx with python-docx (export() returns 403 for non-Google files)",
      "Fix GET /documents 500: add limit property to pagination params",
      "Fix delete and edit not persisting: routes now commit (get_db never auto-commits)",
      "Fix Drive-imported content mis-parsed: use a text extension so ingestion doesn't PDF-parse plain text",
      "Surface real Drive import/upload error messages instead of swallowing them",
      "Fix email draft generation 500: type EmailDraftOut timestamps as datetime",
      "Enable text selection/copy in the desktop window (pywebview disabled it by default)",
    ],
  },
  {
    build: 34,
    date: "2026-06-08",
    title: "Knowledge Base & Search — end-to-end fixes",
    changes: [
      "Fix Knowledge Base uploads silently failing: upload and Drive-import routes never committed the transaction, so documents rolled back and the KB stayed empty",
      "Fix 500 on upload: refresh document after ingest so server-generated timestamps serialize without a MissingGreenlet error",
      "Fix semantic search returning no results: corrected repository session attribute and switched to typed pgvector cosine_distance",
      "Fix Google shared-drive browsing: list shared-drive roots via corpora+driveId; Drive search now spans all drives",
      "Fix ingestion root cause: document was never added to the session, leaving null IDs and orphaned files",
      "Voyage embeddings: per-provider default model resolution, batch embedding, and rate-limit retry; axios timeout raised to 120s",
      "Google Calendar: scope events to the viewed month; raise maxResults so recurring events no longer swamp results",
      "Verified live end-to-end over HTTP: PC upload, Drive import from PMI Share Drive, and semantic search all working",
    ],
  },
  {
    build: 33,
    date: "2026-06-07",
    title: "Phase 7: Advanced Features",
    changes: [
      "Fix meetings.py _llm_summarize bug: db session was not in scope (runtime crash on Summarize)",
      "Investor Relations page (/investor): company snapshot, 510k/DHF doc registry, AI draft, recent research, IR chat shortcut",
      "Investor Relations nav item added to sidebar (TrendingUp icon)",
      "All Phase 7 features now operational: meetings, briefings, regulatory, QMS/CAPA, Drive KB ingestion, in-app update",
    ],
  },
  {
    build: 32,
    date: "2026-06-08",
    title: "Phase 6: LangGraph multi-agent system",
    changes: [
      "Add LangGraph v2 multi-agent architecture under services/agent/v2/",
      "Seven specialist agents: ExecutiveAssistant, Research, Regulatory, QMS, IR, Engineering, Operations",
      "Supervisor routes each message to the best specialist via LLM classification",
      "LangChain tool wrappers delegate to existing dispatch_tool() without code duplication",
      "Feature flag: llm.use_langgraph (default false) — toggle in system_settings",
      "v1 AgentExecutor remains fully operational; zero user-facing disruption",
    ],
  },
  {
    build: 31,
    date: "2026-06-07",
    title: "Phase 5: Approval workflow — execute on approve, audit trail for all decisions",
    changes: [
      "POST /approvals/{id}/resolve now executes the approved action immediately after human sign-off",
      "send_email intent: calls gmail_send() with payload fields (to/recipient_email, subject, body/draft_body)",
      "create_calendar_event intent: calls calendar_create_event() with payload fields",
      "Email drafts submitted for approval are marked 'sent' in the database once executed",
      "All approval decisions (approved + rejected) are written to the immutable hash-chained audit log",
      "Execution result (success/error/no_action) returned in resolve response and displayed in the Approvals UI",
      "Approve/Reject buttons show loading state and are disabled during submission",
      "Execution failure never rolls back the human approval decision",
    ],
  },
  {
    build: 30,
    date: "2026-06-07",
    title: "Phase 4: Settings UI — model dropdowns, re-index workflow, live AI health panel",
    changes: [
      "llm.provider added to EXPOSED_KEYS so the provider field is always persisted correctly",
      "New GET /settings/ai-options endpoint returns per-provider model lists (Anthropic, OpenAI, Voyage, Ollama)",
      "Embedding model is now a proper dropdown per provider (voyage-3/voyage-3-lite, text-embedding-3-large/small, Ollama list)",
      "Fixed incorrect dimension hints in Voyage AI and OpenAI info boxes (was 768 dims, now provider-native)",
      "Warning banner (⚠ Re-index required) appears automatically when embedding provider/model changes dimension",
      "Re-index Now button opens a progress modal with real-time SSE stream showing doc-by-doc progress",
      "Compact LLM ● / Embeddings ● live status row added at the top of AI Engine settings (from GET /settings/health)",
      "System Health section now includes Embeddings row (provider/model/dims) and re-index flag from GET /health",
      "Default mergedSettings updated to anthropic/voyage/1024 dims instead of ollama/768 dims",
    ],
  },
  {
    build: 29,
    date: "2026-06-07",
    title: "Phase 3: Live API health pings for LLM and embedding providers",
    changes: [
      "GET /health now performs a real live API call to verify each provider (Anthropic count_tokens, OpenAI models.retrieve, Voyage embed)",
      "GET /health now includes an 'embedding' check with provider, model, and measured dimension",
      "GET /health now includes 'kb_needs_reindex' flag from system_settings",
      "New GET /settings/health endpoint: lightweight LLM + embedding ping only, no disk/DB checks, < 3s target",
      "Both health endpoints run LLM and embedding pings concurrently (asyncio.gather) for speed",
      "Anthropic ping uses count_tokens (free, no tokens billed); OpenAI ping uses models.retrieve (free metadata)",
    ],
  },
  {
    build: 28,
    date: "2026-06-07",
    title: "Phase 2: Anthropic/Voyage defaults, no silent Ollama fallback",
    changes: [
      "Default LLM provider changed from Ollama to Anthropic (claude-sonnet-4-6)",
      "Default embedding provider changed from Ollama to Voyage AI (voyage-3, 1024 dims)",
      "LLM router no longer falls back silently to Ollama when a cloud API key is missing",
      "Missing API key now raises a RuntimeError with a clear Settings link instead of silently switching provider",
      "Removed get_llm_client_no_db() — it was never safe to build a client without DB context",
      "config.py defaults updated: default_llm_model=claude-sonnet-4-6, default_embedding_model=voyage-3",
      ".env.example updated with DEFAULT_LLM_PROVIDER, DEFAULT_EMBEDDING_PROVIDER, DEFAULT_EMBEDDING_DIMENSION",
    ],
  },
  {
    build: 27,
    date: "2026-06-07",
    title: "Phase 1: Native embedding dimensions (Voyage 1024, OpenAI 1536/3072)",
    changes: [
      "Voyage AI now returns native 1024-dim vectors (was forced to 768 — losing retrieval quality)",
      "OpenAI text-embedding-3-small/large now return native 1536/3072-dim vectors",
      "Added PROVIDER_DIMENSIONS lookup table for all supported providers and models",
      "POST /documents/reindex SSE endpoint: ALTERs pgvector column, re-embeds all documents, streams progress",
      "Settings PUT now detects embedding dimension mismatch and sets llm.kb_needs_reindex=true",
      "SettingsOut now includes embedding_dimension (int) and reindex_required (bool)",
      "Migration 002: adds document_chunks.embedding_dimension column + seeds system_settings keys",
      "DocumentChunkRepository: added delete_all_chunks() and get_all_document_ids_ready() for re-index",
    ],
  },
  {
    build: 26,
    date: "2026-06-07",
    title: "Planning: v2 Roadmap & documentation suite",
    changes: [
      "Created ROADMAP.md — 7-phase implementation plan with gap analysis and README update directives per phase",
      "Created CHANGELOG.md, USER_GUIDE.md, and DEVELOPER_GUIDE.md",
      "Identified critical gap: all embedding providers forced to 768 dims; Voyage AI native is 1024",
      "v2 spec (LittleGerry_ProjectPrompt_v2.md) accepted as authoritative — supersedes Ollama-first prompt",
    ],
  },
  {
    build: 25,
    date: "2026-06-07",
    title: "Fix: Gerry tool calls — Anthropic streaming rewrite",
    changes: [
      "Root cause found: Anthropic streaming used Raw SSE event string matching which silently dropped tool_use blocks",
      "Rewrote chat_stream to use stream.text_stream (SDK-documented API) + get_final_message() for tool extraction",
      "Gerry now correctly calls Drive, Gmail, Calendar, and KB tools instead of saying 'Let me check'",
      "Google is confirmed connected and valid — tool execution was blocked by streaming parser, now fixed",
    ],
  },
  {
    build: 24,
    date: "2026-06-07",
    title: "Fix: Embedding service & Gerry tool-calling",
    changes: [
      "Agent executor now reads embedding provider from DB — no longer hardcoded to Ollama",
      "KB import and semantic search now work with Voyage AI / OpenAI embedding providers",
      "Gerry: strengthened Google tool-calling instruction — now calls Drive/Gmail immediately instead of saying 'I'll check'",
      "Search error now shows the actual backend error message instead of a hardcoded Ollama hint",
    ],
  },
  {
    build: 23,
    date: "2026-06-07",
    title: "Fix: Embedding provider resets to Ollama after Save",
    changes: [
      "Settings page now invalidates the settings query after a successful save",
      "Embedding provider selection now persists correctly — no longer reverts to Ollama",
      "Added embedding_provider and voyage_key_set to loading state defaults",
    ],
  },
  {
    build: 22,
    date: "2026-06-07",
    title: "Voyage AI Embeddings — Full Anthropic-Only Support",
    changes: [
      "Added Voyage AI as a third embedding provider (Anthropic's official embedding partner)",
      "Voyage AI uses voyage-3 at 768 dims — no database migration required",
      "Settings now offers: Ollama (local), Voyage AI (cloud, Anthropic users), OpenAI (cloud)",
      "Voyage AI API key stored securely in OS keychain; get a free key at dash.voyageai.com",
      "Removed requirement for Ollama or OpenAI when using Anthropic as the LLM provider",
    ],
  },
  {
    build: 21,
    date: "2026-06-06",
    title: "Cloud Embeddings (OpenAI) — Ollama No Longer Required",
    changes: [
      "New 'Embedding Provider' setting: choose Ollama (local) or OpenAI (cloud)",
      "OpenAI text-embedding-3-small at 768 dims — matches the existing KB schema, no database migration needed",
      "Anthropic users without Ollama can now use Knowledge Base and Semantic Search via OpenAI embeddings",
      "Settings page now shows the embedding section clearly, with guidance when Ollama is not available",
      "OpenAI API key entry shown automatically when OpenAI embeddings are selected with Anthropic as LLM",
    ],
  },
  {
    build: 20,
    date: "2026-06-06",
    title: "Bug Fixes — Research, KB, Search, Calendar, Emails",
    changes: [
      "Research agent now returns results — ddgs package was missing from the venv and has been installed",
      "Knowledge Base import and Semantic Search now work — Ollama Server URL field is always visible in Settings regardless of LLM provider (embeddings always use Ollama)",
      "Document ingestion errors now show the actual failure reason instead of a generic message",
      "Google Calendar: added Sync button with spinner; shows error banner if sync fails",
      "Email Drafts: fixed regenerate crashing silently (missing db parameter); errors now shown in the form",
    ],
  },
  {
    build: 19,
    date: "2026-06-07",
    title: "Google Workspace Integration",
    changes: [
      "Import Google Drive files directly into the Knowledge Base from the Documents page",
      "Google Calendar events appear on the Calendar grid alongside local tasks and meetings",
      "Import tasks from Google Tasks — select from a list and import in bulk to the Tasks board",
      "Task attachments: attach Drive files or AI-generated files to any task from the task drawer",
      "Drive browser now shows company Shared Drives alongside My Drive",
    ],
  },
  {
    build: 18,
    date: "2026-06-06",
    title: "Persistent Chat Sidebar + File Generation",
    changes: [
      "New persistent assistant panel — stays open while you navigate between tabs",
      "Sidebar sends the current page name as context so the AI knows what you're viewing",
      "AI can now generate files (TXT, Markdown, CSV, JSON) via the generate_file tool",
      "Download buttons appear automatically in chat when a file is generated",
      "New Generated Files page to browse and download all AI-created files",
      "Status bar shows OpenAI, Anthropic, and Ollama connection states",
    ],
  },
  {
    build: 17,
    date: "2026-06-05",
    title: "First-Run Setup Wizard",
    changes: [
      "After first Google login, a setup wizard appears to configure the AI model",
      "Choose Anthropic, OpenAI, or Ollama; enter API key or server URL",
      "Model list loads live from the selected provider",
      "Connection is tested before proceeding — won't let you in with a broken config",
    ],
  },
  {
    build: 16,
    date: "2026-06-05",
    title: "Migration Preparation",
    changes: [
      "LLM error frames now show in the chat bubble instead of being silently dropped",
      "Added backup-ollama-models.ps1 to back up model files before server migration",
      "Added migrate-to-server.ps1 — guided migration day runbook with verification",
    ],
  },
  {
    build: 15,
    date: "2026-06-05",
    title: "Remote Ollama Server Support",
    changes: [
      "Ollama server URL is now fully configurable — point to any machine on the network",
      "Settings → Ollama shows 'Ollama Server URL' field (e.g. http://192.168.1.50:11434)",
      "Health check and model list both use the configured URL (no longer hardcoded to localhost)",
      "Includes server setup and cleanup PowerShell scripts (scripts/ folder)",
    ],
  },
  {
    build: 14,
    date: "2026-06-04",
    title: "Google Workspace SSO Login",
    changes: [
      "Login now uses Google Sign-In — no more email/password form",
      "Only @pmi-llc.com and @precisianmedical.com accounts are accepted",
      "A browser window opens for Google consent; app waits and logs you in automatically",
      "Unknown accounts are rejected with a clear error message",
    ],
  },
  {
    build: 13,
    date: "2026-06-04",
    title: "First-Run Setup Fix",
    changes: [
      "First-run setup now waits for Docker Desktop to be fully ready (up to 90s) before starting the database",
      "Setup now polls PostgreSQL with pg_isready before running migrations — no more timing failures",
      "Launcher also improved: falls back to launching Docker Desktop.exe if the Windows service fails",
      "Clear user-facing error messages if Docker doesn't start in time",
    ],
  },
  {
    build: 12,
    date: "2026-06-04",
    title: "Database & Stability",
    changes: [
      "Launcher now uses docker compose up — recreates DB container if deleted",
      "Backend stderr redirected to backend/logs/backend_stderr.log for diagnostics",
      "Removed spurious import from backend lifespan",
    ],
  },
  {
    build: 11,
    date: "2026-06-04",
    title: "First-Message Fix",
    changes: [
      "Typing a message before a conversation exists no longer discards it",
      "Message is now sent automatically once the new conversation + WebSocket are ready",
    ],
  },
  {
    build: 10,
    date: "2026-06-04",
    title: "Auth Reliability",
    changes: [
      "Fixed token refresh URL (was hitting Vite dev server instead of backend)",
      "Access token now persisted across restarts to avoid broken-auth loop",
    ],
  },
  {
    build: 9,
    date: "2026-06-04",
    title: "Google OAuth — Full Consent",
    changes: [
      "Added prompt=consent so Google always shows all scopes on reconnect",
      "Prevents Google's cache from silently dropping newly added scopes",
    ],
  },
  {
    build: 8,
    date: "2026-06-04",
    title: "Character Encoding & Google Hallucination Fix",
    changes: [
      "Fixed garbled characters in chat and documents UI (encoding fix)",
      "AI now told explicitly when Google is not connected — stops fabricating file lists",
    ],
  },
  {
    build: 7,
    date: "2026-06-04",
    title: "Backend Health Indicator on Login",
    changes: [
      "Login page polls /health every 3 s and shows Connected / Connecting / Not reachable",
      "Form disabled until backend is confirmed healthy — no more confusing error messages",
      "Backend retries DB connection up to 10× on startup (handles slow Docker starts)",
    ],
  },
  {
    build: 6,
    date: "2026-06-03",
    title: "Login UX",
    changes: [
      "Remember email checkbox persists login email in localStorage",
      "Login errors now classified: network vs auth vs server (no more wrong 'invalid password')",
    ],
  },
  {
    build: 5,
    date: "2026-06-03",
    title: "Update Checker UX",
    changes: [
      "Settings > Update section shows real states: checking, up-to-date, update available",
      "Install button and error detail now visible instead of silent failures",
    ],
  },
  {
    build: 4,
    date: "2026-06-03",
    title: "In-App Service Menu",
    changes: [
      "··· menu in sidebar header: Restart Services, Update, Update & Restart, Stop All",
      "Calls backend control endpoints — no need to use system tray",
    ],
  },
  {
    build: 3,
    date: "2026-06-02",
    title: "System Tray Controls",
    changes: [
      "Tray menu: Restart Services, Update, Update & Restart, Stop All Services",
      "Backend control-file polling for cross-process commands",
    ],
  },
  {
    build: 2,
    date: "2026-06-01",
    title: "Cloud Model Switcher",
    changes: [
      "Header dropdown to switch LLM provider (OpenAI / Anthropic / Ollama)",
      "API key input inline for cloud providers; saves via PUT /settings",
    ],
  },
  {
    build: 1,
    date: "2026-05-31",
    title: "Initial Release",
    changes: [
      "AI chat with tool use (Drive, Gmail, Calendar, Contacts, Tasks, web search)",
      "Knowledge base with document upload and vector search",
      "Projects, Tasks, Calendar, Approvals, Audit Trail",
      "Google Workspace OAuth integration",
      "System tray launcher with splash screen",
    ],
  },
];
