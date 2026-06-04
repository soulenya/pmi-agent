# Little Gerry — AI Executive Assistant for Precisian Medical Instruments

**Little Gerry** is a local-first, privacy-focused AI executive assistant built for [Precisian Medical Instruments](https://www.precisianmedical.com) and the **VACTOR** device program. It runs entirely on your own hardware — no cloud dependencies, no data leaving your network.

---

## Table of Contents

1. [Overview](#overview)
2. [Features](#features)
3. [Architecture](#architecture)
4. [Windows Installer (Recommended)](#windows-installer-recommended)
5. [Prerequisites (Manual Setup)](#prerequisites-manual-setup)
6. [Setup & Installation (Manual)](#setup--installation-manual)
7. [Running the Application](#running-the-application)
8. [Usage Guide](#usage-guide)
9. [Configuration](#configuration)
10. [Development](#development)

---

## Overview

Little Gerry runs as a **native Windows desktop application** — a branded splash screen launches all services in the background, then loads the full React app in a WebView2 window. A system tray icon provides quick access and graceful shutdown.

The stack: **React 19 + TypeScript + Vite** frontend, **FastAPI** backend (Python 3.14), local AI via **Ollama**, and **PostgreSQL 16 + pgvector** for vector search — all on your machine.

Key design principles:
- **Local-first** — all AI inference and data storage happens on your machine
- **Medical-grade context** — purpose-built prompts for FDA/ISO regulatory workflows, CAPA, and VACTOR device documentation
- **Human-in-the-loop** — AI suggestions require explicit approval before executing consequential actions
- **Full audit trail** — every AI action and document change is logged immutably

---

## Features

| Module | Description |
|---|---|
| **AI Chat (Little Gerry)** | Streaming conversational AI with tool use, RAG over your knowledge base, and real-time WebSocket responses |
| **Dashboard** | At-a-glance view of tasks, pending approvals, today's meetings, and AI-generated daily briefing |
| **Projects & Tasks** | Kanban board with drag-and-drop, project tracking, due dates, and priority management |
| **Calendar** | Scheduled events with meeting integration |
| **Knowledge Base** | Upload and semantically search internal documents (PDFs, DOCX, TXT); auto-chunked and embedded |
| **Search** | Semantic vector search across all uploaded documents with category filtering |
| **Research** | AI-assisted literature/regulatory research with cited responses |
| **Meeting Notes** | Meeting transcripts with AI summarization and one-click action item extraction → Tasks |
| **Email Drafts** | AI-generated email drafts for regulatory, investor, and operational communications |
| **Regulatory** | Track regulatory documents (DHF, IFU, 510(k), ISO 13485) with AI content drafting |
| **Approvals** | Workflow approval queue with accept/reject and AI-generated summaries |
| **Notifications** | Real-time WebSocket push notifications with read/unread management |
| **Audit Trail** | Immutable log of all system and AI actions with filtering and export |
| **User Management** | Role-based access control (Admin / User), user creation and deactivation |
| **Google Workspace** | Connect your Google account for Gmail, Drive, Calendar, and Contacts integration with human-in-the-loop write approvals |
| **Settings** | LLM model selection, appearance (light/dark/system), notification preferences, live system health monitoring, and one-click in-app updates |

---

## Architecture

```
┌────────────────────────────────────────────────────┐
│         pywebview Native Desktop Window             │
│   WinForms + Edge WebView2 (gui="winforms")         │
│   Branded splash screen → React 19 app              │
│   System tray icon (pystray)                        │
└──────────────────────┬─────────────────────────────┘
                       │ HTTP + WebSocket
                       │ (localhost:5173 / 127.0.0.1:8000)
┌──────────────────────▼─────────────────────────────┐
│               FastAPI Backend                       │
│   Python 3.14 · SQLAlchemy 2.0 async                │
│   pgvector · JWT Auth · LangGraph agents            │
└────────────┬───────────────────────┬───────────────┘
             │                       │
┌────────────▼─────┐   ┌─────────────▼──────────────┐
│  PostgreSQL 16   │   │      Ollama (local)          │
│  + pgvector      │   │  llama3.2 (chat)             │
│  Docker          │   │  nomic-embed-text (embed)    │
└──────────────────┘   └────────────────────────────┘
             │
┌────────────▼─────────────────────────────────────┐
│  Google Workspace (optional)                      │
│  Gmail · Drive · Calendar · Contacts              │
│  OAuth 2.0 via google-auth-oauthlib               │
└───────────────────────────────────────────────────┘
```

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

| File | Purpose |
|---|---|
| `Start Little Gerry.bat` | Start all services and launch Little Gerry (runs first-time setup if needed) |
| `Stop Little Gerry.bat` | Gracefully stop backend, frontend, and PostgreSQL |
| `Update Little Gerry.bat` | Pull the latest version from GitHub and restart |
| `Install Little Gerry.bat` | Re-run the full setup (useful after a clean clone) |
| `build-installer.bat` | Compile `LittleGerry_Setup.exe` using Inno Setup 6 |

### Updating

Go to **Settings → Updates** and click **Check for Updates**. If a new version is available, click **Install Update** — the app pulls from GitHub, runs migrations, and restarts automatically.

You can also run `Update Little Gerry.bat` directly at any time. The update script automatically ensures Docker and PostgreSQL are running before applying database migrations.

### Exit Confirmation

Closing the Little Gerry window shows a native confirmation dialog before shutting down all services. Using **Stop All Services** from the system tray bypasses the dialog (the tray action is already intentional).

---

## Prerequisites (Manual Setup)

| Requirement | Version | Notes |
|---|---|---|
| **Windows 10/11** | 64-bit | Primary supported platform |
| **Node.js** | v20+ | [nodejs.org](https://nodejs.org) |
| **Python** | 3.14 | [python.org](https://www.python.org) |
| **uv** | latest | `pip install uv` |
| **Docker Desktop** | latest | [docker.com](https://www.docker.com/products/docker-desktop) |
| **Ollama** | latest | [ollama.com](https://ollama.com) |
| **Inno Setup 6** | 6.x | Only needed to build the installer |

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

### 3. Pull AI models via Ollama

```bash
ollama pull llama3.2
ollama pull nomic-embed-text
```

### 4. Set up the Python backend

```bash
cd backend
uv sync
cp .env.example .env
uv run alembic upgrade head
uv run python scripts/seed_admin.py
```

`seed_admin.py` reads `PMI_ADMIN_EMAIL`, `PMI_ADMIN_NAME`, and `PMI_ADMIN_PASSWORD` from environment variables, or prompts interactively if they are not set.

### 5. Set up the frontend

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

## Usage Guide

### Logging In

Sign in with the email and password you set during first-run setup.

---

### AI Chat — Little Gerry

Navigate to **AI Assistant** in the sidebar.

- Type a message and press **Enter** (Shift+Enter for a new line)
- Little Gerry can search your knowledge base, look up tasks, summarize documents, and draft content
- Rename or archive conversations by hovering over them in the left panel
- Click **+** for a new conversation

Example prompts:
```
Summarize the VACTOR DHF status and flag any gaps
What are my open tasks this week?
Draft an email to the FDA about our PMA submission timeline
Generate a risk assessment section for the VACTOR IFU
```

---

### Knowledge Base & Search

Navigate to **Knowledge Base** → **Upload Document** → select a PDF, DOCX, or TXT file and assign a category. The document is automatically chunked, embedded, and indexed.

Navigate to **Search** to query with natural language. Results are ranked by semantic similarity.

---

### Tasks & Projects

- **Tasks** — Kanban board with drag-and-drop (To Do → In Progress → In Review → Done)
- **Projects** — Group tasks by project, track milestones and progress

---

### Meeting Notes

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

Connected services: Gmail (read + send), Google Drive (read), Google Calendar (read + create events), and Contacts (read).

**Write actions** (send email, create calendar event) go through the human-in-the-loop approval queue on the same page — click **Approve** or **Cancel** before they execute.

To disconnect: click **Disconnect Google**. Your local token is deleted immediately.

---

### Approvals

Navigate to **Approvals** for the human-in-the-loop queue. Pending approvals show AI-generated summaries. Click **Approve** or **Reject** with an optional comment.

---

### Settings

- **Profile** — update your name and email
- **AI Engine** — select the Ollama model and configure the base URL
- **Appearance** — Light, Dark, or System theme
- **System Health** — live status of PostgreSQL, Ollama, and disk space
- **Updates** — check and install updates in-app

---

## Configuration

### Backend — `backend/.env`

```env
DATABASE_URL=postgresql+asyncpg://pmi:pmi_dev_password@localhost:5432/pmi_dev
DATABASE_URL_SYNC=postgresql://pmi:pmi_dev_password@localhost:5432/pmi_dev
OLLAMA_BASE_URL=http://localhost:11434
DEFAULT_LLM_MODEL=llama3.2
DEFAULT_EMBEDDING_MODEL=nomic-embed-text
DEBUG=false
```

### Frontend — `frontend/.env`

```env
VITE_API_BASE=http://127.0.0.1:8000
VITE_WS_BASE=ws://127.0.0.1:8000
```

### Google Workspace

OAuth credentials are stored in `backend/google_credentials.json` (Desktop app type, Google Workspace Internal). The per-user token is written to `backend/google_token.json` after the first sign-in and is gitignored.

### Alternative LLM Models

```bash
ollama pull llama3.1:8b        # Faster, good for most tasks
ollama pull llama3.3:70b       # Higher quality, requires ~48 GB RAM
ollama pull mistral             # Alternative chat model
```

Update `DEFAULT_LLM_MODEL` in `.env` and restart the backend.

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
- All document files are encrypted at rest using Fernet symmetric encryption
- Rate limiting is applied to all API endpoints via `slowapi`
- CORS is restricted to localhost origins
- Google OAuth tokens are stored locally and never transmitted to any third-party service

---

*Built for Precisian Medical Instruments · VACTOR Program · June 2026*

---

## Table of Contents

1. [Overview](#overview)
2. [Features](#features)
3. [Architecture](#architecture)
4. [Windows Installer (Recommended)](#windows-installer-recommended)
5. [Prerequisites (Manual Setup)](#prerequisites-manual-setup)
6. [Setup & Installation (Manual)](#setup--installation-manual)
7. [Running the Application](#running-the-application)
8. [Usage Guide](#usage-guide)
9. [Default Credentials](#default-credentials)
10. [Configuration](#configuration)
11. [Development](#development)

---

## Overview

Little Gerry combines a **React + TypeScript frontend** (served via Vite) with a **FastAPI backend** powered by local AI models via **Ollama**. All conversation history, documents, and AI embeddings are stored in a local **PostgreSQL** database with vector search capabilities via **pgvector**.

Key design principles:
- **Local-first** — all AI inference and data storage happens on your machine
- **Medical-grade context** — purpose-built prompts for FDA/ISO regulatory workflows, CAPA, VACTOR device documentation
- **Human-in-the-loop** — AI suggestions require explicit approval before executing consequential actions
- **Full audit trail** — every AI action and document change is logged immutably

---

## Features

| Module | Description |
|---|---|
| **AI Chat (Little Gerry)** | Streaming conversational AI with tool use, RAG over your knowledge base, and real-time WebSocket responses |
| **Dashboard** | At-a-glance view of tasks, pending approvals, today's meetings, and AI-generated daily briefing |
| **Projects & Tasks** | Kanban board with drag-and-drop, project tracking, due dates, and priority management |
| **Calendar** | Scheduled events with meeting integration |
| **Knowledge Base** | Upload and semantically search internal documents (PDFs, DOCX, TXT); auto-chunked and embedded |
| **Search** | Semantic vector search across all uploaded documents with category filtering |
| **Research** | AI-assisted literature/regulatory research with cited responses |
| **Meeting Notes** | Voice-transcribed meeting notes with AI summarization and one-click action item extraction → Tasks |
| **Email Drafts** | AI-generated email drafts for regulatory, investor, and operational communications |
| **Regulatory** | Track regulatory documents (DHF, IFU, 510(k), ISO 13485 procedures) with AI content drafting |
| **Approvals** | Workflow approval queue with accept/reject and AI-generated summaries |
| **Notifications** | Real-time WebSocket push notifications with read/unread management |
| **Audit Trail** | Immutable log of all system and AI actions with filtering and export |
| **User Management** | Role-based access control (Admin / User), user creation and deactivation |
| **Settings** | LLM model selection, appearance (light/dark/system), notification preferences, live system health monitoring (DB/Ollama/disk), and one-click in-app updates |

---

## Architecture

```
┌─────────────────────────────────────────────┐
│         Browser / Tauri Desktop App          │
│  React 19 · TypeScript · Vite · TailwindCSS │
│  Zustand · TanStack Query · React Router     │
└─────────────────┬───────────────────────────┘
                  │ HTTP + WebSocket
                  │ (localhost:8000)
┌─────────────────▼───────────────────────────┐
│            FastAPI Backend                   │
│  Python 3.14 · SQLAlchemy 2.0 async          │
│  pgvector · JWT Auth                         │
└────────────┬────────────────┬───────────────┘
             │                │
┌────────────▼────┐  ┌────────▼────────────────┐
│  PostgreSQL 16  │  │      Ollama (local)      │
│  + pgvector     │  │  llama3.2 (chat)         │
│  Docker         │  │  nomic-embed-text (embed)│
└─────────────────┘  └─────────────────────────┘
```

---

## Windows Installer (Recommended)

The easiest way to install Little Gerry is with the one-click Windows installer. It automatically installs all prerequisites and configures everything.

### Requirements
- Windows 10 or 11 (64-bit)
- Internet access (~3-5 GB download)
- ~5 GB free disk space

### Steps

1. **Build the installer** (or use a pre-built `LittleGerry_Setup.exe`):
   ```
   Double-click: build-installer.bat
   ```
   Output: `installer\Output\LittleGerry_Setup.exe`

2. **Run `LittleGerry_Setup.exe`** — follow the wizard. The installer will:
   - Install Docker Desktop, Ollama, Python 3.14, and Node.js (via winget, if not already present)
   - Start PostgreSQL in Docker
   - Set up the Python virtual environment and run database migrations
   - Install frontend dependencies
   - Pull the `llama3.2` and `nomic-embed-text` AI models
   - Create a desktop shortcut and Start Menu entry

3. **Launch** by double-clicking the **Little Gerry** desktop shortcut or running `Start Little Gerry.bat` from the install folder.

> **Install location:** `C:\Users\<you>\AppData\Local\Little Gerry`  
> The app installs to your user profile (not Program Files) so it can write files without requiring admin on every run.

### Utility Scripts

| File | Purpose |
|---|---|
| `Start Little Gerry.bat` | Start all services (Docker, backend, frontend) and open the browser |
| `Stop Little Gerry.bat` | Gracefully stop backend, frontend, and PostgreSQL |
| `Update Little Gerry.bat` | Pull the latest version from GitHub and restart |
| `Install Little Gerry.bat` | Re-run the full setup (useful after a clean clone) |
| `build-installer.bat` | Compile `LittleGerry_Setup.exe` using Inno Setup 6 |

### Updating

Little Gerry has a built-in update checker. Go to **Settings → Updates** and click **Check for Updates**. If a new version is available, click **Install Update** — the app pulls from GitHub, runs migrations, and restarts automatically.

You can also run `Update Little Gerry.bat` directly at any time.

---

## Prerequisites (Manual Setup)

For manual / developer setup, ensure the following are installed:

| Requirement | Version | Notes |
|---|---|---|
| **Windows 10/11** | 64-bit | Primary supported platform |
| **Node.js** | v20+ | [nodejs.org](https://nodejs.org) |
| **Python** | 3.12+ | [python.org](https://www.python.org) |
| **uv** | latest | `pip install uv` - Python package manager |
| **Docker Desktop** | latest | [docker.com](https://www.docker.com/products/docker-desktop) - for PostgreSQL |
| **Ollama** | latest | [ollama.com](https://ollama.com) - local LLM runtime |

> Rust is only required if building the Tauri desktop app. For browser-based use it is not needed.

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

This starts a `pgvector/pgvector:pg16` container named `pmi_postgres` on port **5432**.

Verify it's healthy:
```bash
docker ps
```

### 3. Pull AI models via Ollama

Ensure Ollama is running, then pull the required models:

```bash
ollama pull llama3.2
ollama pull nomic-embed-text
```

Verify Ollama is accessible at `http://localhost:11434`.

### 4. Set up the Python backend

```bash
cd backend
uv sync                         # Install all Python dependencies
```

Create a `.env` file (or copy from the example):

```bash
cp .env.example .env
```

Run database migrations:

```bash
uv run alembic upgrade head
```

Create the initial admin user:

```bash
uv run python scripts/seed_admin.py
```

### 5. Set up the frontend

```bash
cd frontend
npm install
```

Create a `.env` file in `frontend/`:

```env
VITE_API_BASE=http://127.0.0.1:8000
VITE_WS_BASE=ws://127.0.0.1:8000
```

---

## Running the Application

> **Using the installer?** Just double-click `Start Little Gerry.bat` (or the desktop shortcut). Skip this section.

For manual / dev runs, open two terminals:

**Terminal 1 - Backend API**
```bash
cd backend
uv run uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

**Terminal 2 - Frontend dev server**
```bash
cd frontend
npm run dev
```

**Optional - Tauri desktop app**
```bash
cd frontend
npm run tauri dev
```

The application opens at **http://localhost:5173** in your browser (or as a native desktop window via Tauri).

---

## Usage Guide

### Logging In

1. Open the application (browser or desktop window)
2. Sign in with your credentials (see [Default Credentials](#default-credentials))

---

### AI Chat — Little Gerry

Navigate to **AI Assistant** in the sidebar.

- **Start a conversation** — type a message and press Enter (or click Send)
- **Tool use** — Little Gerry can search your knowledge base, look up tasks, summarize documents, and draft content autonomously; a tool activity indicator appears while it works
- **Shift+Enter** — inserts a new line without sending
- **Rename conversations** — hover over a conversation in the left panel and click the pencil icon
- **Archive conversations** — hover and click the archive icon
- **New chat** — click the **+** button at the top of the conversation list

Example prompts:
```
Summarize the VACTOR DHF status and flag any gaps
What are my open tasks this week?
Draft an email to the FDA notifying them of our PMA submission timeline
Generate a risk assessment section for the VACTOR IFU
```

---

### Knowledge Base & Search

Navigate to **Knowledge Base** to upload documents:

1. Click **Upload Document**
2. Select a file (PDF, DOCX, or TXT)
3. Assign a category (e.g., "Regulatory", "Clinical", "Engineering")
4. The document is automatically chunked, embedded, and indexed for semantic search

Navigate to **Search** to query your documents:

- Type a natural language query
- Filter by category using the chips at the top
- Results are ranked by semantic similarity

---

### Tasks & Projects

Navigate to **Tasks** for the Kanban board:

- **Create a task** — click **+ New Task**
- **Move tasks** — drag and drop cards between columns (To Do → In Progress → In Review → Done)
- **Edit a task** — click the pencil icon on a card
- Column drop zones highlight in blue when you drag over them

Navigate to **Projects** to group tasks by project, track milestones, and monitor progress.

---

### Meeting Notes

Navigate to **Meeting Notes**:

1. **Add a meeting** — click **+ New Meeting**
2. Paste or type the raw meeting transcript
3. Click **Summarize** — Little Gerry generates a structured summary with key decisions and action items
4. Click **Extract Actions** (appears after summarization) — Little Gerry identifies action items and presents them as checkboxes
5. Select the items you want to create and click **Create N Tasks** — tasks are added to your Kanban board instantly

---

### Regulatory Documents

Navigate to **Regulatory**:

- View all tracked regulatory documents with type, status, and version
- Hover over a document row to reveal the **AI Draft** button
- Click **AI Draft** — Little Gerry retrieves relevant knowledge base context and generates professional regulatory content
- Use the **Copy** button in the draft modal to copy the content to your clipboard
- Review and edit the draft before use; a disclaimer is shown on all AI-generated content

---

### Approvals

Navigate to **Approvals** for the human-in-the-loop queue:

- Pending approvals are shown with AI-generated summaries
- Click **Approve** or **Reject** with an optional comment
- Approved actions are executed; rejections are logged in the Audit Trail

---

### Settings

Navigate to **Settings**:

- **Profile** - update your name and email
- **AI Engine** - select the Ollama model and configure the base URL
- **Appearance** - switch between Light, Dark, and System theme
- **Notifications** - configure notification preferences
- **System Health** - live status of PostgreSQL, Ollama, and disk space; click **Refresh** to re-check
- **Updates** - click **Check for Updates** to compare your local version against GitHub; click **Install Update** to pull the latest code and restart automatically

---

## Default Credentials

> ⚠️ Change these immediately after first login in a production environment.

| Field | Value |
|---|---|
| Email | `admin@precisian.local` |
| Password | `Admin1234!` |
| Role | Admin |

---

## Configuration

### Backend — `backend/.env`

```env
DATABASE_URL=postgresql+asyncpg://pmi:pmi_dev_password@localhost:5432/pmi_dev
DATABASE_URL_SYNC=postgresql://pmi:pmi_dev_password@localhost:5432/pmi_dev
OLLAMA_BASE_URL=http://localhost:11434
DEFAULT_LLM_MODEL=llama3.2
DEFAULT_EMBEDDING_MODEL=nomic-embed-text
DEBUG=false
```

### Frontend — `frontend/.env`

```env
VITE_API_BASE=http://127.0.0.1:8000
VITE_WS_BASE=ws://127.0.0.1:8000
```

### Alternative LLM Models (Ollama)

You can swap to a larger model for better quality at the cost of speed:

```bash
ollama pull llama3.1:8b        # Faster, good for most tasks
ollama pull llama3.3:70b       # Higher quality, requires 48GB+ RAM
ollama pull mistral             # Alternative chat model
```

Update `DEFAULT_LLM_MODEL` in `.env` and reload the backend.

---

## Development

### Backend type-checking

```bash
cd backend
uv run mypy .
```

### Frontend type-checking

```bash
cd frontend
npx tsc --noEmit
```

### Run backend tests

```bash
cd backend
uv run pytest
```

### Build the Windows installer

Requires [Inno Setup 6](https://jrsoftware.org/isdl.php) installed.

```
Double-click: build-installer.bat
```

Output: `installer\Output\LittleGerry_Setup.exe`

### Build the Tauri desktop app (production)

```bash
cd frontend
npm run tauri build
```

The installer is generated at `frontend/src-tauri/target/release/bundle/`.

### Database migrations

```bash
cd backend
# Create a new migration after changing models
uv run alembic revision --autogenerate -m "description"
# Apply migrations
uv run alembic upgrade head
# Roll back one step
uv run alembic downgrade -1
```

---

## Security Notes

- The backend binds to `127.0.0.1` only — not accessible from other machines on the network by default
- JWT secrets are stored in the OS keyring (Windows Credential Manager), never in `.env` files
- All document files are encrypted at rest using Fernet symmetric encryption
- Rate limiting is applied to all API endpoints via `slowapi`
- CORS is restricted to Tauri and localhost origins

---

*Built for Precisian Medical Instruments · VACTOR Program · June 2026*
