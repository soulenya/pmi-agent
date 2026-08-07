# Little Gerry — AI Executive Assistant for Precisian Medical Instruments

**Little Gerry** is the AI Executive Assistant, chief of staff, and regulatory expert for [Precisian Medical Instruments](https://www.precisianmedical.com) and the **VACTOR** device program. It combines a powerful cloud AI brain (Anthropic Claude) with local-first data storage — your documents and conversations stay on your machine, while your AI is best-in-class.

---

## Table of Contents

1. [Overview](#overview)
2. [Features](#features)
3. [Architecture](#architecture)
4. [Windows Installer (Recommended)](#windows-installer-recommended)
5. [Prerequisites (Manual Setup)](#prerequisites-manual-setup)
6. [Setup &amp; Installation (Manual)](#setup--installation-manual)
7. [AI Configuration](#ai-configuration)
8. [Running the Application](#running-the-application)
9. [Usage Guide](#usage-guide)
10. [Configuration Reference](#configuration-reference)
11. [Development](#development)
12. [Security Notes](#security-notes)

---

## Overview

Little Gerry runs as a **native Windows desktop application** — a branded splash screen launches all services in the background, then loads the full React app in a WebView2 window. A system tray icon provides quick access and graceful shutdown.

The stack: **React 19 + TypeScript + Vite** frontend, **FastAPI** backend (Python 3.14), **Anthropic Claude** for AI, **Voyage AI** for document embeddings, and **PostgreSQL 16 + pgvector** for vector search — all data stored locally on your machine.

Key design principles:

- **Local-first data, cloud-flexible inference** — all documents, conversations, and tasks are stored on your machine; AI inference is provided by Anthropic (or OpenAI / Ollama optionally)
- **Medical-grade context** — purpose-built prompts for FDA/ISO regulatory workflows, CAPA, and VACTOR device documentation
- **Human-in-the-loop** — AI suggestions require explicit approval before executing consequential actions
- **Full audit trail** — every AI action and document change is logged immutably

---

## Features

| Module                           | Description                                                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **AI Chat (Little Gerry)** | Streaming conversational AI with tool use, RAG over your knowledge base, and real-time WebSocket responses. Turns can be **stopped mid-answer** — the partial reply and any work already done are kept — and long conversations page back through their full history |
| **Ask Gerry about this**   | One-click button on any task, project, contact, email, draft, calendar event, KB document, generated file, or attachment — opens a chat seeded with that item (files are read in full) |
| **Dashboard**              | At-a-glance view of tasks, pending approvals, today's meetings, and AI-generated daily briefing                                            |
| **Daily Assistant**        | Once-a-day background scan of your Gmail and Google Tasks that surfaces suggested follow-ups and to-dos for human review, **grouped by what they're about** (one box per workroom or per person you're waiting on) and ordered by how often you accept that kind of suggestion — resolve them individually, by group, or in bulk — plus a docked **briefing panel** on the home screen showing today's schedule, unread email, tasks due, pending approvals, suggestions, and an Odoo snapshot |
| **Company Profile**        | A short, always-loaded company-context file (people, products, partners, regulatory context) injected into every agent's system prompt — sourced from a shared Google Drive file so every teammate's install stays consistent; synced at launch and on demand |
| **Writing Voice**          | Per-user voice profile: Gerry analyses the last six months of your own sent mail and writes a detailed description of how you write, then drafts email in that voice; upload/edit/remove it yourself, and optionally apply it to other writing. Stored per user — never shared between accounts |
| **Projects & Tasks**       | Kanban board with drag-and-drop, project tracking, due dates, and priority management. Every task remembers what it's about, so it links straight to the email thread, document, meeting, workroom or chat behind it — with **Ask Gerry** and one-click **Gerry draft** for email follow-ups |
| **Workrooms**              | Persistent co-work spaces for work spanning days or weeks: a goal, a dedicated chat, a progress journal, and pinned artifacts (Drive docs, KB documents, generated files, notes, websites, email threads, tasks, Odoo records, regulatory documents, budgets) that Gerry carries into every message. Goal and title edits are journaled with their previous wording so Gerry tracks how the work has turned; files belonging to another room are flagged before she opens them and blocked before she edits them; and she sees when a document was last saved and by whom, so you can both work in it at once. Standing tasks, a morning digest, and Drive sharing so teammates can join their own mirror |
| **Calendar**               | Scheduled events with meeting integration                                                                                                  |
| **Knowledge Base**         | Upload and semantically search internal documents (PDFs, DOCX, TXT); auto-chunked and embedded. Little Gerry can also read an entire document in full when asked to summarize or analyze it |
| **Search**                 | Semantic vector search across all uploaded documents with category filtering                                                               |
| **Research**               | AI-assisted literature/regulatory research with cited responses                                                                            |
| **Meeting Notes**          | Auto-detects video calls (Zoom/Teams/Meet) and records + transcribes system audio, then AI-summarizes with one-click action item extraction → Tasks; manual transcript paste also supported; meetings and transcripts are searchable from chat |
| **Gmail**                  | Full inbox: browse standard Gmail folders (Inbox, Sent, Drafts, Starred, Important, Archived, Spam, Trash, All Mail), sort your mail (newest/oldest/sender/unread first), read/search/tag emails, reply, reply-all & forward, mark read or unread (opening a thread clears its highlight automatically), long threads open with only the unread part expanded behind a Gerry-written summary, move to Trash, open attachments in Google Workspace, add attachments straight to the Knowledge Base, and compose & send your own email directly (no approval needed for mail you write yourself) |
| **Email Drafts**           | AI-generated email drafts for regulatory, investor, and operational communications; submit for approval to send from your Gmail account     |
| **Regulatory**             | File explorer for regulatory documents (DHF, IFU, 510(k), ISO 13485): browse/create folders, upload, import from Drive, edit, rename, move, and delete — write access gated per user |
| **Slide Decks**            | Ask for a presentation and Gerry builds a real deck in the company house style — fourteen layouts, brand colours and type measured from the company's own deck, uploaded to Drive as native Google Slides. Every deck carries a security classification you choose; the theme itself lives in the shared templates folder, so the look changes without a release |
| **Investor Relations**     | IR hub: company snapshot, regulatory proof-points, AI-drafted pitch context, research feed, and IR specialist chat                          |
| **Approvals**              | Approve/reject anywhere — inline in the email thread, inline in chat, from any notification, or from the global top-bar approvals drawer — with automatic execution and full audit trail |
| **Notifications**          | Actionable notifications — approve/reject approvals directly from the bell, with deep links to the right page for everything else          |
| **Feedback**               | Top-bar button to report a bug or request a feature; submissions are routed to the owner's notifications                                   |
| **Setup Wizard**           | One-time guided first-use onboarding: explains the stack, connects Claude + Voyage (pre-set defaults) and Google, and covers roles & usage |
| **Audit Trail**            | Immutable log of all system and AI actions with filtering and export                                                                       |
| **User Management**        | Google sign-in only (no passwords); invite teammates by email; accounts auto-created on first sign-in (owner = admin, everyone else = full-access member); per-user Regulatory write permission and deactivation |
| **Google Workspace**       | Connect your Google account for Gmail, Drive, Calendar, and Contacts integration with human-in-the-loop write approvals; Drive files can be edited in place one file at a time, each requiring its own explicit permission. Word/Excel/PowerPoint files are converted to an editable Google copy automatically, edits change one occurrence at a time, and every edit is verified by re-reading the document                    |
| **Odoo ERP**               | Connect an Odoo account via encrypted API key; Little Gerry reads ERP data and proposes write actions through the Approvals queue           |
| **Settings**               | Collapsible sections that flag what you haven't set up yet and re-flag themselves when a new release or a new model arrives: LLM model selection, embedding provider, re-index KB, live health monitoring, appearance, notification preferences, and one-click in-app updates |

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│         pywebview Native Desktop Window               │
│   WinForms + Edge WebView2 (gui="winforms")           │
│   Branded splash screen → React 19 app               │
│   System tray icon (pystray)                         │
└────────────────────────┬─────────────────────────────┘
                         │ HTTP + WebSocket
                         │ (localhost:5173 / 127.0.0.1:8000)
┌────────────────────────▼─────────────────────────────┐
│                 FastAPI Backend                        │
│   Python 3.14 · SQLAlchemy 2.0 async · pgvector       │
│   JWT Auth · Alembic migrations                       │
└──────────┬─────────────────────────┬─────────────────┘
           │                         │
┌──────────▼──────┐     ┌────────────▼──────────────────┐
│  PostgreSQL 16  │     │       LLM Router               │
│  + pgvector     │     │  Anthropic Claude ← default    │
│  Docker         │     │  OpenAI (optional)             │
│  port 5432      │     │  Ollama local (optional)       │
└─────────────────┘     └────────────┬──────────────────┘
                                     │
                         ┌───────────▼──────────────────┐
                         │     Embedding Router          │
                         │  Voyage AI ← recommended     │
                         │    voyage-3      → 1024 dims  │
                         │    voyage-3-lite → 512 dims   │
                         │  OpenAI (optional)            │
                         │    text-embedding-3-large     │
                         │                   → 3072 dims │
                         │    text-embedding-3-small     │
                         │                   → 1536 dims │
                         │  Ollama local (optional)      │
                         │    nomic-embed-text → 768 dims│
                         └──────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  Google Workspace (optional, OAuth 2.0)             │
│  Gmail · Drive · Calendar · Contacts                │
└─────────────────────────────────────────────────────┘
```

> **Embedding dimensions are provider-native.** Each embedding provider returns its own vector size. Switching providers requires re-indexing the Knowledge Base (Settings → AI Engine → Re-index Now).

---

## Windows Installer (Recommended)

### Requirements

- Windows 10 or 11 (64-bit)
- Internet access (~3–5 GB download on first run)
- ~5 GB free disk space

### Steps

1. **Build the installer** (skip if you have a pre-built `LittleGerry_Setup.exe`):

   ```
   Double-click: build-installer.bat
   ```

   Output: `installer\Output\LittleGerry_Setup.exe`
2. **Run `LittleGerry_Setup.exe`** — the installer will:

   - Install Docker Desktop, Ollama, Python 3.14, and Node.js (via winget, if not already present)
   - Copy all application files to `C:\Users\<you>\AppData\Local\Little Gerry\`
   - Create a desktop shortcut and Start Menu entry
3. **Launch** via the desktop shortcut or `Start Little Gerry.bat`.

   **On first launch,** a setup wizard runs automatically and asks you to enter:

   - Your company email address (used as your login)
   - Your display name
   - A password of your choice

   It then starts PostgreSQL, runs database migrations, seeds your account, and installs frontend dependencies before launching Little Gerry.

> **Install location:** `C:\Users\<you>\AppData\Local\Little Gerry\`

### Utility Scripts

| File                         | Purpose                                                                      |
| ---------------------------- | ---------------------------------------------------------------------------- |
| `Start Little Gerry.bat`   | Start all services and launch Little Gerry (runs first-time setup if needed) |
| `Stop Little Gerry.bat`    | Gracefully stop backend, frontend, and PostgreSQL                            |
| `Update Little Gerry.bat`  | Pull the latest version from GitHub and restart                              |
| `Install Little Gerry.bat` | Re-run the full setup (useful after a clean clone)                           |
| `build-installer.bat`      | Compile `LittleGerry_Setup.exe` using Inno Setup 6                         |

### Updating

Go to **Settings → Updates** and click **Check for Updates**. If a new version is available, click **Install Update** — the app pulls from GitHub, runs migrations, and restarts automatically.

You can also run `Update Little Gerry.bat` directly at any time. The update script automatically ensures Docker and PostgreSQL are running before applying database migrations.

### Exit Confirmation

Closing the Little Gerry window shows a native confirmation dialog before shutting down all services. Using **Stop All Services** from the system tray bypasses the dialog (the tray action is already intentional).

---

## Prerequisites (Manual Setup)

| Requirement              | Version | Notes                                                     |
| ------------------------ | ------- | --------------------------------------------------------- |
| **Windows 10/11**  | 64-bit  | Primary supported platform                                |
| **macOS**          | 12+ (Apple Silicon) | Supported — see the [macOS section](#macos-apple-silicon) |
| **Node.js**        | v20+    | [nodejs.org](https://nodejs.org)                             |
| **Python**         | 3.14    | [python.org](https://www.python.org)                         |
| **uv**             | latest  | `pip install uv`                                        |
| **Docker Desktop** | latest  | [docker.com](https://www.docker.com/products/docker-desktop) |
| **Anthropic API key** | —    | [console.anthropic.com](https://console.anthropic.com) — required for AI chat |
| **Voyage AI API key** | —    | [dash.voyageai.com](https://dash.voyageai.com) — free tier, required for KB/search |
| **Ollama** (optional) | latest | [ollama.com](https://ollama.com) — only needed if using Ollama as LLM or embedding provider |
| **Inno Setup 6**   | 6.x     | Only needed to build the installer                        |

---

## Setup & Installation (Manual)

### 1. Clone the repository

```bash
git clone https://github.com/soulenya/pmi-agent.git
cd pmi-agent
```

### 2. Start PostgreSQL (Docker)

```bash
docker compose up -d
```

Starts a `pgvector/pgvector:pg16` container named `pmi_postgres` on port **5432**.

### 3. Set up the Python backend

```bash
cd backend
uv sync
cp .env.example .env
uv run alembic upgrade head
uv run python scripts/seed_admin.py
```

`seed_admin.py` reads `PMI_ADMIN_EMAIL`, `PMI_ADMIN_NAME`, and `PMI_ADMIN_PASSWORD` from environment variables, or prompts interactively.

### 4. Set up the frontend

```bash
cd frontend
npm install
```

Create `frontend/.env`:

```env
VITE_API_BASE=http://127.0.0.1:8000
VITE_WS_BASE=ws://127.0.0.1:8000
```

---

## Running the Application

### Desktop app (recommended)

```bash
# From the project root:
backend\.venv\Scripts\pythonw.exe launcher.py
```

`launcher.py` opens a branded splash screen in a pywebview WinForms window, starts all services in the background, then navigates to the React app when services are ready.

### Manual / developer mode

**Terminal 1 — Backend**

```bash
cd backend
uv run uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

**Terminal 2 — Frontend**

```bash
cd frontend
npm run dev
```

Open **http://localhost:5173** in your browser.

---

## macOS (Apple Silicon)

Little Gerry runs on macOS using the same backend, frontend, and Docker stack. The
launcher (`launcher.py`) is cross-platform; macOS-specific scripts live alongside the
Windows `.bat` files.

### First-time setup

```bash
git clone https://github.com/soulenya/pmi-agent.git
cd pmi-agent
bash scripts/install.sh        # installs Homebrew deps, DB, migrations, frontend
```

`install.sh` installs the prerequisites via Homebrew (Docker Desktop, Python, Node 20,
`uv`), brings up PostgreSQL, runs migrations, seeds the admin user, and makes the
launcher scripts executable.

### Running

Double-click **`Start Little Gerry.command`** in Finder (or run it from a terminal).
It performs first-run setup if needed, then opens the app in a native Cocoa/WebKit
window. **`Stop Little Gerry.command`** shuts the services down.

> If a script won't run after a fresh `git clone`, make them executable once:
> `chmod +x *.command scripts/*.sh`

| File | Purpose |
| --- | --- |
| `Start Little Gerry.command` | Start all services and launch Little Gerry (first-run setup if needed) |
| `Stop Little Gerry.command` | Gracefully stop backend, frontend, and PostgreSQL |
| `scripts/install.sh` | Full Homebrew-based setup (run once after cloning) |
| `scripts/update.sh` | Developer update — git pull, deps, migrations, restart |
| `scripts/build-macos.sh` | Build the macOS installer `installer/Output/LittleGerry.pkg` |
| `scripts/publish-macos.sh` | Build and attach `LittleGerry.pkg` to the GitHub release |

### Building the macOS installer (.pkg)

```bash
bash scripts/build-macos.sh
```

Produces a per-user `installer/Output/LittleGerry.pkg` that installs to
`~/Applications/Little Gerry` with a double-clickable **Little Gerry.app** launcher —
the macOS analog of the Windows `LittleGerry_Setup.exe`.

**Code signing / notarization** (requires a paid Apple Developer account) is optional
and enabled via environment variables — when unset, the build is unsigned (works on
your own Mac; other Macs need a one-time right-click → Open):

```bash
export DEVELOPER_ID_INSTALLER="Developer ID Installer: Your Name (TEAMID)"
export NOTARY_PROFILE="littlegerry"   # from: xcrun notarytool store-credentials
bash scripts/publish-macos.sh         # builds, signs, notarizes, uploads to the release
```

The Windows `.exe` and macOS `.pkg` attach to the **same** GitHub release/tag, and the
in-app auto-updater downloads the correct asset for each platform automatically.

---


## Usage Guide

### Logging In

Click **Sign in with Google**. Little Gerry uses Google sign-in only — there are no passwords to manage. Your account must belong to an approved Workspace domain (`pmi-llc.com` or `precisianmedical.com`). On your **first** sign-in your account is created automatically: the owner becomes the **admin**, and everyone else joins as a **full-access member**. The one-time Setup Wizard then walks you through configuration.

---

### Inviting Teammates

Admins can invite others from **Users** → **Invite**:

1. Enter the teammate's **email** (optionally a display name and a personal note).
2. They receive an email with a link to download Little Gerry and instructions to **Sign in with Google**.
3. Their account is created automatically on first sign-in as a **full-access member** — no passwords, no manual setup.

Because each person runs their own local copy, every install keeps its own data; the invite simply gets them the app and an account on their own machine.

---

### AI Chat — Little Gerry

Navigate to **AI Assistant** in the sidebar.

- Type a message and press **Enter** (Shift+Enter for a new line)
- Little Gerry can search your knowledge base, look up tasks, summarize documents, and draft content
- Rename or archive conversations by hovering over them in the left panel
- Click **+** for a new conversation
- Click **Ask Gerry about this** on any task, email, file, contact, or event to open a chat already seeded with that item (attachments and generated files are read in full)

Example prompts:

```
Summarize the VACTOR DHF status and flag any gaps
What are my open tasks this week?
Draft an email to the FDA about our PMA submission timeline
Generate a risk assessment section for the VACTOR IFU
Build a 10-slide product briefing on VACTOR for a distributor meeting
```

---

### Slide Decks

Ask for a presentation — "build me a pitch deck", "a product briefing", "a board update" — and Gerry builds a real `.pptx` in the company house style, then uploads it to Drive as native Google Slides when Google is connected. It is downloadable either way; a deck can be built with Google disconnected.

**Gerry will ask you one question first: the security classification.** It is required, never guessed, and it is stamped on every slide:

| Classification | Printed on each slide |
| -------------- | --------------------- |
| Open | *nothing* — a deck for an outside audience is deliberately unmarked |
| Confidential — Internal | CONFIDENTIAL — INTERNAL |
| Confidential — Proprietary | CONFIDENTIAL — PROPRIETARY INFORMATION |
| Confidential — Trade Secret | CONFIDENTIAL — TRADE SECRET, in the accent colour |

**Fourteen layouts** are available (`cover`, `section_break`, `statement_media`, `bullets`, `points_with_metrics`, `numbered_cards`, `profile_cards`, `tier_cards`, `metric_cards`, `media_feature`, `split_detail`, `comparison_grid`, `milestone_track`, `hero_number`). They are named for their **structure**, not a business purpose, so the same set serves a fundraise, a demo or a technical briefing. Text is measured and flowed rather than dropped into fixed boxes — long headings shrink to fit instead of overlapping.

**The theme lives on Drive.** A doc named **Deck Theme** in the shared templates folder overrides colours, fonts, type sizes, the grid and the classification wording — see [Slide deck theme](#slide-deck-theme) below. Layouts remain in code.

**Editing an existing deck.** With a per-file edit grant, Gerry can rewrite a text box, **add** one, remove one, **add a whole new slide**, or delete a slide.

A new slide is built from the same fourteen layouts and the same theme as a generated deck — the layouts are recorded from the deck builder and replayed through the Slides API, so there is one layout implementation rather than two that drift. She reads the deck's existing classification mark and applies it rather than asking again, and **page numbers are renumbered** after any insert or delete (only shapes at the theme's page-number position that contain nothing but digits are touched). Pass a position to insert, or omit it to append. New text is styled by **role** — `footnote`, `caption`, `body`, `detail`, `callout`, `label`, `figure`, `heading` — and the font, size and colour for each come from the deck theme, so she cannot pick her own and an added box matches its neighbours. Placement is checked against the slide's real geometry: a box that would run off the canvas or cover existing content is refused with the ids it would have hit. A footnote with no stated position goes on the bottom margin, above whatever is already there.

---

### Knowledge Base & Search

1. Navigate to **Knowledge Base** → **Upload Document** → select a PDF, DOCX, or TXT file and assign a category
2. The document is automatically chunked, embedded (using your configured embedding provider), and indexed
3. Navigate to **Search** to query with natural language — results are ranked by semantic similarity

> **Embedding provider must be configured first.** Go to Settings → AI Engine and enter your Voyage AI API key (free at [dash.voyageai.com](https://dash.voyageai.com)) before importing documents. Voyage AI is the recommended provider and stores vectors at native 1024 dimensions for superior retrieval quality.

> **Switching embedding providers after importing documents requires re-indexing.** Go to Settings → AI Engine — if the new provider uses a different vector dimension, a warning will appear and you must click **Re-index Now** before semantic search will work. The re-index re-embeds all documents through the new provider.

---

### Research

Navigate to **Research** → **New Research Report** → enter a topic. Little Gerry searches the web (DuckDuckGo), reads sources, and generates a structured cited report stored in the research archive.

---

### Calendar

Displays local events and Google Calendar events side by side. Use the **Sync** button (top right, visible when Google is connected) to refresh Google Calendar on demand.

---

### Tasks & Projects

- **Tasks** — Kanban board (To Do → In Progress → In Review → Done)
- **Projects** — Group tasks by project with milestone tracking

---

### Gmail

Open **Gmail** from the Communications area (Google must be connected). Use the **folder** dropdown to switch between Gmail's standard folders (Inbox, Sent, Drafts, Starred, Important, Archived, Spam, Trash, All Mail) and the **sort** dropdown to order your mail (newest first by default, or oldest, sender A–Z, or unread first). Read, search, and tag-filter your inbox; reply, reply-all, or forward (the original is quoted and its attachments carried across); mark a thread read or unread — opening one in Little Gerry clears its inbox highlight automatically; move messages to Trash; open attachments in Google Workspace; or click the **Add to Knowledge Base** button on any attachment to import it for Little Gerry to reference. In a long thread only the messages you haven't read are expanded — the rest collapse to single clickable lines beneath a short Gerry-written summary of the conversation. Click **New email → Write it myself** to compose and send email directly from your Gmail account (no approval needed for mail you write yourself). You can also ask Little Gerry to draft replies, which route to Approvals.

---

### Email Drafts

Navigate to **Email Drafts** → **New Email Draft** → fill in topic and context → **Generate**. Review, then submit for approval to send from your Gmail account. Errors are shown inline if generation fails.

---

### Meeting Notes

Little Gerry can **auto-record and transcribe video calls** (Zoom/Teams/Meet) when auto-recording is enabled in Settings (system-audio capture is Windows-only), then summarize them automatically. To add one manually:

1. **+ New Meeting** → paste or type the meeting transcript
2. **Summarize** — generates a structured summary with decisions and action items
3. **Extract Actions** → select items → **Create N Tasks** — adds directly to the Kanban board

---

### Regulatory Documents

Hover over a document row → click **AI Draft** — Little Gerry retrieves relevant knowledge base context and generates professional regulatory content. Review and edit before use.

---

### Google Workspace

Navigate to **Google Workspace** in the sidebar.

1. Click **Connect Google** — your default browser opens Google's sign-in page
2. Sign in with your Google account and grant the requested permissions
3. Once connected, the status turns green and your Google account email is shown

Connected services: Gmail (read + send), Google Drive (read, plus per-file editing you grant), Google Calendar (read + create events), and Contacts (read).

**Write actions** (send email, create calendar event) go through the human-in-the-loop approval queue on the same page — click **Approve** or **Cancel** before they execute.

**Editing a Drive file** is granted per file: when Gerry wants to change a document she asks in chat, naming that one file. Allowing it gives her write access to that file only — every other file stays read-only and the next one needs its own permission. Docs, Sheets, **Google Slides** and plain-text files are editable in place; PDFs and images are not. Rewriting a slide's text box carries the box's existing font, size, colour and spacing onto the new text, so an edited slide still matches the deck; Gerry can also add and remove text boxes on a slide, styled from the deck theme by role (footnote, caption, callout…) rather than by fonts she picks, and a box that would cover existing content is refused. Whole slides can be added from the deck layouts or deleted, with page numbers renumbered either way. Granted files are listed under **Settings → Drive Edit Permissions** and can be revoked at any time; Drive's own **File → Version history** is the undo. A permission also lifts the QMS/draft read restriction for that single file, since naming it and clicking Allow is the explicit request that rule asks for.

> Slides access is new — reading or editing an existing deck requires reconnecting Google once so the new permission is granted. Creating a deck does not.

To disconnect: click **Disconnect Google**. Your local token is deleted immediately.

---

### Approvals

Anything Little Gerry wants to do on your behalf needs your sign-off, and you can now give it wherever you are:

- **Inline in the email thread** — a Gerry-drafted reply appears at the top of its Gmail thread with Approve/Edit/Reject buttons.
- **Inline in chat** — when Gerry proposes an action mid-conversation, the approval card renders right in the conversation.
- **Global drawer** — the clipboard icon in the top bar (with a live pending count) opens a slide-out panel with every pending approval, on any page.
- **From a notification** — approval notifications carry Approve/Reject buttons directly.
- The **Approvals** page remains as the full-page queue and history view.

---

### Settings

- **Profile** — update display name and password
- **AI Engine** — LLM provider + model + API key; Embedding provider + model + API key; Re-index Knowledge Base button (appears when switching providers that use a different vector dimension); live System Health panel showing LLM ● and Embedding ● status with actual API ping results
- **Appearance** — Light, Dark, or System theme; Timezone
- **System Health** — live status of PostgreSQL, active LLM (with live ping), active embedding provider (with live ping), disk space, and re-index flag
- **Updates** — check and install updates in-app

> **Automatic updates on launch.** Each time Little Gerry starts it checks GitHub for a newer version. **Installed apps** download the latest signed installer and apply it in the background (stop → silent install → relaunch) — the updater runs as an independent process so it completes even after the app closes to swap files. **Developer checkouts** instead pull the latest code, refresh dependencies, and apply pending database migrations. Either way, the in-app **Updates** panel remains available for an on-demand check. (Auto-update is skipped on developer machines with uncommitted changes.)

---

## Configuration Reference

### Backend — `backend/.env`

```env
DATABASE_URL=postgresql+asyncpg://pmi_app:pmi_dev_password@localhost:5432/pmi_dev
DATABASE_URL_SYNC=postgresql://pmi_app:pmi_dev_password@localhost:5432/pmi_dev
DEFAULT_LLM_PROVIDER=anthropic
DEFAULT_LLM_MODEL=claude-sonnet-4-6
DEFAULT_EMBEDDING_PROVIDER=voyage
DEFAULT_EMBEDDING_MODEL=voyage-3
DEFAULT_EMBEDDING_DIMENSION=1024
OLLAMA_BASE_URL=http://localhost:11434
DEBUG=false
```

API keys (Anthropic, OpenAI, Voyage AI) are **never** stored in `.env` — they are entered in Settings → AI Engine and stored in the OS keychain (Windows Credential Manager).

### System Health API

Two health endpoints are available:

| Endpoint | Purpose |
|---|---|
| `GET /health` | Full system check: database, LLM live ping, embedding live ping, disk space, re-index flag |
| `GET /settings/health` | Lightweight AI-only check: LLM + embedding live pings only (< 3s), used by Settings page |

Sample `GET /health` response:
```json
{
  "status": "ok",
  "checks": {
    "database": {"status": "ok"},
    "llm": {"status": "ok", "provider": "anthropic", "model": "claude-sonnet-4-6"},
    "embedding": {"status": "ok", "provider": "voyage", "model": "voyage-3", "dimension": 1024},
    "kb_needs_reindex": false,
    "disk": {"status": "ok", "free_gb": 42.5}
  }
}
```

### Frontend — `frontend/.env.development`

```env
VITE_API_BASE=http://127.0.0.1:8000
VITE_WS_BASE=ws://127.0.0.1:8000
```

### Google Workspace

OAuth credentials are stored in `backend/google_credentials.json` (Desktop app type) and are **gitignored** — never committed to source control and **not bundled in the installers**. Add the file once after installing (see `docs/INSTALL.md` → "Google OAuth credentials"); it survives app updates. The per-user token is written to `backend/google_token.json` after first sign-in and is also gitignored. If you ever rotate the OAuth client secret in Google Cloud, distribute the new file privately.

### Slide deck theme

The deck look is sourced from the same shared **PMI Templates** Drive folder as document templates: create a doc named **Deck Theme** (or "Deck Style" / "Slide Theme"). It is read only when a deck is being built, cached locally so decks still build offline, and takes effect immediately — no release.

Write `key: value` lines, grouped either by a `###` heading or by a dotted prefix. Only keys you list are overridden; everything else keeps its built-in value.

```
### Palette
background: 000000     card: 0A0A0A     card_alt: 111111     panel: 161616
primary: FFFFFF        body: C9C9C9     caption: 6F6F6F      dim: 4D4D4D
accent: FF0000

### Fonts
display: Archivo             # headlines and body
mono: JetBrains Mono         # eyebrows, indices, page numbers

### Sizes
hero: 95.29    headline_xl: 44.76   headline_lg: 40.42   headline: 37.54
headline_sm: 33.21   figure_lg: 31.76   figure: 24.54     subtitle: 18.77
name: 15.88    body: 13.72    body_sm: 12.27   detail: 11.55   item: 10.83
detail_sm: 10.11   caption: 9.38   index: 9.38   page_no: 8.66   eyebrow: 7.94

### Grid
margin_l: 0.56   margin_r: 0.56   content_w: 12.88   rule_w: 11.71
cols_3: 0.56, 4.48, 8.40         col_3_w: 3.88
cols_4: 0.56, 3.50, 6.44, 9.37   col_4_w: 2.90
right_l: 6.18    right_w: 6.09

### Chrome
confidential_l: 0.56   confidential_t: 0.34   confidential_w: 4.00
page_no_l: 12.09       page_no_t: 6.72

classification.confidential_internal: CONFIDENTIAL — INTERNAL
name: VACTOR
```

Colours are 6-digit hex, sizes are points, everything positional is inches. Values are range-checked: a bad line falls back to the built-in value and is **reported in Gerry's reply** rather than silently producing a broken deck. Classification levels can be **relabelled but not added or removed** (the four choices are fixed), and `open` cannot be given a label. Layouts are code, not configuration.

---

## Development

### Backend type-checking

```bash
cd backend && uv run mypy .
```

### Frontend type-checking

```bash
cd frontend && npx tsc --noEmit
```

### Run backend tests

```bash
cd backend && uv run pytest
```

### Database migrations

```bash
cd backend
uv run alembic revision --autogenerate -m "description"   # new migration
uv run alembic upgrade head                                # apply
uv run alembic downgrade -1                               # roll back one step
```

### Build the Windows installer

Requires [Inno Setup 6](https://jrsoftware.org/isdl.php).

```
Double-click: build-installer.bat
```

Output: `installer\Output\LittleGerry_Setup.exe`

---

## Security Notes

- The backend binds to `127.0.0.1` only — not accessible from other machines on the network
- JWT secrets are stored in the OS keyring (Windows Credential Manager), not in `.env` files
- API keys (Anthropic, OpenAI, Voyage AI) are stored in the OS keychain via the `keyring` library — never written to disk
- All document files are encrypted at rest using Fernet symmetric encryption
- Rate limiting is applied to all API endpoints via `slowapi`
- CORS is restricted to localhost origins
- Google OAuth tokens are stored locally and never transmitted to any third-party service
- Sign-in is Google SSO only and restricted to approved Workspace domains (`pmi-llc.com`, `precisianmedical.com`); no passwords are stored or transmitted
- `backend/google_credentials.json` (OAuth client secret) is gitignored and is not bundled in the installers — users add it after installing (docs/INSTALL.md); rotate the secret in Google Cloud if it is ever exposed

---

*Built for Precisian Medical Instruments · VACTOR Program · June 2026*
