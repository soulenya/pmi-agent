# Little Gerry - AI Executive Assistant for Precisian Medical Instruments

**Little Gerry** is a local-first, privacy-focused AI executive assistant built specifically for [Precisian Medical Instruments](https://www.precisianmedical.com) and the **VACTOR** device program. It runs entirely on your own hardware - no cloud dependencies, no data leaving your network.

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
