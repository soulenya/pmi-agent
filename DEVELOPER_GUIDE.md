# Little Gerry — Developer Guide
**AI Executive Assistant for Precisian Medical Instruments**

Build 33 · June 2026

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Tech Stack](#tech-stack)
3. [Repository Structure](#repository-structure)
4. [Local Development Setup](#local-development-setup)
5. [Environment Variables](#environment-variables)
6. [AI Provider Architecture](#ai-provider-architecture)
7. [Embedding Architecture](#embedding-architecture)
8. [Agent Executor](#agent-executor)
9. [WebSocket Chat Protocol](#websocket-chat-protocol)
10. [Database](#database)
11. [Google Workspace Integration](#google-workspace-integration)
12. [Frontend Architecture](#frontend-architecture)
13. [Backend Routers](#backend-routers)
14. [Key Services](#key-services)
15. [Testing](#testing)
16. [Database Migrations](#database-migrations)
17. [Building the Installer](#building-the-installer)
18. [Build Conventions](#build-conventions)
19. [Known Issues & Technical Debt](#known-issues--technical-debt)
20. [Security Notes](#security-notes)

---

## Architecture Overview

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
                         │  OpenAI (optional)            │
                         │  Ollama local (optional)      │
                         └──────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  Google Workspace (optional, OAuth 2.0)             │
│  Gmail · Drive · Calendar · Contacts                │
└─────────────────────────────────────────────────────┘
```

---

## Tech Stack

### Frontend
| Technology | Version | Purpose |
|---|---|---|
| React | 19 | UI framework |
| TypeScript | 5 | Type safety |
| Vite | 6 | Build tool + dev server (port 5173) |
| TailwindCSS | v3 | Styling |
| shadcn/ui | latest | Component library |
| Zustand | latest | Client state management |
| TanStack Query | v5 | Server state + caching |
| React Router | v7 | Client-side routing |
| Axios | latest | HTTP client |

### Backend
| Technology | Version | Purpose |
|---|---|---|
| Python | 3.14 | Runtime |
| FastAPI | latest | REST API + WebSocket |
| SQLAlchemy | 2.0 async | ORM |
| asyncpg | latest | PostgreSQL async driver |
| Alembic | latest | DB migrations |
| pgvector | latest | Vector similarity search |
| `anthropic` SDK | 0.105.2 | Claude LLM client |
| `voyageai` | latest | Voyage AI embeddings |
| `keyring` | latest | OS keychain for API keys |
| `httpx` | latest | Async HTTP (Ollama) |
| `pypdf` | latest | PDF parsing |
| `ddgs` | 9.14.4 | DuckDuckGo web search |

### Infrastructure
| Component | Details |
|---|---|
| PostgreSQL | 16 + pgvector, Docker container `pmi_postgres`, port 5432 |
| Vector dimensions | **Provider-native** — Voyage AI: 1024, OpenAI large: 3072, OpenAI small: 1536, Ollama nomic-embed-text: 768. Switching providers requires re-indexing the KB. |
| Desktop wrapper | pywebview + WinForms + WebView2 |
| System tray | pystray |

---

## Repository Structure

```
pmi-agent/
├── backend/
│   ├── main.py                    # FastAPI app + WebSocket endpoints
│   ├── config.py                  # Settings + OS keyring API key management
│   ├── database.py                # Async SQLAlchemy engine + session factory
│   ├── dependencies.py            # FastAPI dependency injection (get_current_user)
│   ├── .env.example               # Environment variable template
│   ├── migrations/                # Alembic migration scripts
│   ├── models/
│   │   ├── db/                    # SQLAlchemy ORM models
│   │   └── schemas/               # Pydantic request/response schemas
│   ├── repositories/              # DB access layer (repository pattern)
│   ├── routers/                   # FastAPI route handlers
│   │   ├── settings.py            # GET/PUT /settings (LLM, embedding provider, keys)
│   │   ├── search.py              # POST /search (semantic vector search)
│   │   ├── documents.py           # Document upload + ingestion
│   │   ├── research.py            # Research report creation
│   │   ├── emails.py              # Email draft CRUD
│   │   └── ...
│   └── services/
│       ├── agent/
│       │   ├── executor.py        # Agentic loop v1 (tool calls, streaming) — operational default
│       │   ├── tools.py           # Tool definitions + dispatch_tool()
│       │   └── v2/                # LangGraph multi-agent system (Build 32+)
│       │       ├── supervisor.py  # LLM classifier → routes to specialist agent
│       │       ├── base_agent.py  # Shared async streaming loop (bind_tools pattern)
│       │       ├── lc_tools.py    # LangChain @tool wrappers over dispatch_tool()
│       │       ├── executive_assistant.py
│       │       ├── research_agent.py
│       │       ├── regulatory_agent.py
│       │       ├── qms_agent.py
│       │       ├── ir_agent.py
│       │       ├── engineering_agent.py
│       │       └── operations_agent.py
│       ├── llm/
│       │   ├── router.py          # LLM provider router (Anthropic/OpenAI/Ollama)
│       │   ├── anthropic_client.py # Anthropic streaming client
│       │   ├── openai_client.py   # OpenAI client
│       │   └── ollama.py          # Ollama client
│       ├── embeddings/
│       │   └── service.py         # Embedding provider router + all three services
│       ├── documents/
│       │   └── ingestion.py       # Document parsing, chunking, embedding pipeline
│       ├── google_service.py      # Google Workspace API wrapper
│       └── research/
│           └── searcher.py        # DuckDuckGo web search (ddgs)
├── frontend/
│   ├── src/
│   │   ├── version.ts             # BUILD_NUMBER + CHANGELOG (bump every session)
│   │   ├── App.tsx                # Router + layout
│   │   ├── api/                   # Axios API clients by domain
│   │   ├── pages/                 # One component per route
│   │   ├── components/            # Shared UI components
│   │   ├── stores/                # Zustand stores
│   │   ├── hooks/                 # Custom React hooks
│   │   └── contexts/              # React contexts
│   ├── tsconfig.app.json          # TS config (note: ignoreDeprecations: "6.0" required)
│   └── vite.config.ts             # Vite config + @/* path alias
├── scripts/                       # PowerShell maintenance scripts
├── installer/                     # Inno Setup installer scripts
├── launcher.py                    # pywebview desktop launcher
├── docker-compose.yml             # PostgreSQL + pgvector container
├── README.md                      # Project README
├── USER_GUIDE.md                  # End-user guide
├── DEVELOPER_GUIDE.md             # This file
└── CHANGELOG.md                   # Full changelog + known issues
```

---

## Local Development Setup

### Prerequisites

| Requirement | Notes |
|---|---|
| Windows 10/11 64-bit | Primary platform |
| Node.js v20+ | [nodejs.org](https://nodejs.org) |
| Python 3.14 | [python.org](https://www.python.org) |
| uv | `pip install uv` |
| Docker Desktop | For PostgreSQL |
| Anthropic API key | [console.anthropic.com](https://console.anthropic.com) |
| Voyage AI API key | [dash.voyageai.com](https://dash.voyageai.com) — free tier |

### Setup Steps

```bash
# 1. Clone
git clone https://github.com/soulenya/pmi-agent.git
cd pmi-agent

# 2. Start PostgreSQL
docker compose up -d

# 3. Backend
cd backend
uv sync
cp .env.example .env
uv run alembic upgrade head
uv run python scripts/seed_admin.py

# 4. Frontend
cd ../frontend
npm install
```

Ensure `frontend/.env.development`:
```env
VITE_API_BASE=http://127.0.0.1:8000
VITE_WS_BASE=ws://127.0.0.1:8000
```

### Running in dev mode

**Terminal 1 — Backend**
```bash
cd backend
.venv\Scripts\Activate.ps1
uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

**Terminal 2 — Frontend**
```bash
cd frontend
npm run dev
```

App: http://localhost:5173

---

## Environment Variables

### `backend/.env`

```env
DATABASE_URL=postgresql+asyncpg://pmi:pmi_dev_password@localhost:5432/pmi_dev
DATABASE_URL_SYNC=postgresql://pmi:pmi_dev_password@localhost:5432/pmi_dev
OLLAMA_BASE_URL=http://localhost:11434
DEFAULT_LLM_MODEL=claude-sonnet-4-6
DEFAULT_EMBEDDING_MODEL=nomic-embed-text
DEBUG=false
```

### API Keys — OS Keychain Only

API keys (Anthropic, OpenAI, Voyage AI) are **never stored in `.env`**. They are read/written via `config.settings.get_api_key(provider)` / `config.settings.set_api_key(provider, key)` which delegates to the `keyring` library (Windows Credential Manager).

```python
# Reading a key
from config import settings
key = settings.get_api_key("voyage")   # returns None if not set

# Writing a key (from Settings PUT handler)
settings.set_api_key("anthropic", "sk-ant-...")
```

---

## AI Provider Architecture

### LLM Router — `backend/services/llm/router.py`

`get_llm_client(db)` reads `llm.provider` from `system_settings`, then returns the correct client:

```
llm.provider = "anthropic" → AnthropicClient(api_key, model)
llm.provider = "openai"    → OpenAIClient(api_key, model)
llm.provider = "ollama"    → OllamaClient(base_url, model)
```

Raises `RuntimeError` if a cloud provider is selected but the API key is not configured — no silent fallback to Ollama.

### Anthropic Client — `backend/services/llm/anthropic_client.py`

**Critical implementation note:**

The `chat_stream` method uses `stream.text_stream` + `get_final_message()`, NOT event-by-event iteration with `async for event in stream`. The old event-string-matching approach silently dropped `tool_use` blocks.

```python
async with self._client.messages.stream(**kwargs) as stream:
    async for text_chunk in stream.text_stream:
        yield StreamChunk(content=text_chunk, done=False, ...)
    final = await stream.get_final_message()
    # extract tool_use blocks from final.content
```

**Message format conversion** (`_split_messages`):
- `role="system"` → extracted to Anthropic's `system=` kwarg
- `role="tool"` → converted to Anthropic `tool_result` content block with `tool_use_id`
- `role="assistant"` with `tool_calls` → converted to `tool_use` content blocks

**Tool format conversion** (`_convert_tools`):
- Ollama/OpenAI format `{type, function: {name, description, parameters}}` → Anthropic format `{name, description, input_schema}`

### StreamChunk Interface

All LLM clients implement the same `StreamChunk` interface (defined in `services/llm/ollama.py`):

```python
@dataclass
class StreamChunk:
    content: str
    done: bool = False
    tool_calls: list[dict] = field(default_factory=list)
    model: str = ""
    input_tokens: int = 0
    output_tokens: int = 0
```

---

## Embedding Architecture

### Provider Router — `backend/services/embeddings/service.py`

Two dependency forms:

1. **`get_embedding_service_db(db)`** — FastAPI `Depends()` generator, used by `/search` router
2. **`get_embedding_service_for_db(db)`** — awaitable coroutine, used by the agent executor (cannot use FastAPI DI)

Both read `llm.embedding_provider` from `system_settings` and route to:

```
"voyage"  → VoyageEmbeddingService(api_key)   — voyage-3, native 1024 dims
"openai"  → OpenAIEmbeddingService(api_key)   — text-embedding-3-large/small, native 3072/1536 dims
"ollama"  → EmbeddingService(base_url)         — nomic-embed-text via Ollama HTTP API, 768 dims
```

Each provider outputs its native vector dimension. The `document_chunks.embedding` column is recreated at the correct dimension on re-index. Switching providers requires running **Re-index Now** from Settings → AI Engine.

### Document Ingestion Pipeline — `backend/services/documents/ingestion.py`

```
Upload file → Parse (pypdf / python-docx) → Chunk (fixed-size + overlap)
→ embed_batch() → store chunks + embeddings in DocumentChunk table
```

---

## Agent Executor

**`backend/services/agent/executor.py`**

The executor is the core agentic loop. It:

1. Persists the user message to DB
2. Builds the message history (last 40 messages)
3. Calls `get_llm_client(db)` to get the active LLM
4. Calls `get_embedding_service_for_db(db)` to get the active embedding service
5. Enters the tool-call loop (max `MAX_TOOL_ROUNDS = 5`):
   - Streams tokens from LLM → yields `WSToken` frames
   - On `done=True`, checks `tool_calls`
   - If tool calls present: executes each via `dispatch_tool()`, appends results to message history, loops
   - If no tool calls: saves final message to DB, yields `WSDone`

### Tool Context

```python
@dataclass
class ToolContext:
    db: AsyncSession
    user_id: uuid.UUID
    conversation_id: uuid.UUID
    embedding_service: EmbeddingService  # DB-aware, correct provider
```

### System Prompt Injection

The system prompt in `executor.py` is dynamically built with:
- Today's date
- Google connection status — if connected, instructs Claude to call tools immediately; if not, instructs it to tell the user to connect

### Tool Dispatch — `backend/services/agent/tools.py`

Tools are defined in `TOOL_DEFINITIONS` (Anthropic/OpenAI-compatible format) and implemented as `async def execute_*(ctx, args)` functions registered in `TOOL_EXECUTORS`.

Available tools:
- `search_knowledge_base` — pgvector similarity search
- `create_task`, `get_tasks`
- `request_approval`, `get_pending_approvals`
- `search_web`, `fetch_page` — DuckDuckGo + httpx
- `search_gmail`, `read_gmail_message`
- `search_drive`, `list_drive_folder`, `search_drive_content`, `read_drive_file`
- `get_calendar_events`, `search_contacts`, `read_google_sheet`, `list_google_tasks`
- `generate_file`
- `get_regulatory_status`

### LangGraph Multi-Agent System (v2) — `backend/services/agent/v2/`

Activated by setting `llm.use_langgraph = "true"` in `system_settings` (default: `"false"`). The v1 `AgentExecutor` remains the default and is fully operational.

**Supervisor** (`supervisor.py`) — sends the user message to the LLM with a routing prompt listing all specialist agents, receives an agent name, instantiates that agent, and forwards all streaming frames to the WebSocket caller. Emits `{"type": "agent_selected", "agent": "..."}` before the specialist runs.

**Specialist agents:**

| Agent | File | Primary domain |
|---|---|---|
| `executive_assistant` | `executive_assistant.py` | Default — email, tasks, calendar, Drive, general |
| `research` | `research_agent.py` | Web research, cited reports, competitive analysis |
| `regulatory` | `regulatory_agent.py` | FDA 510(k), DHF, ISO 13485/14971, IEC 60601-1 |
| `qms` | `qms_agent.py` | CAPA, SOPs, document control, audit |
| `ir` | `ir_agent.py` | Pitch decks, investor updates, grant research |
| `engineering` | `engineering_agent.py` | BOM, V&V, design FMEA, test protocols |
| `operations` | `operations_agent.py` | Procurement, supply chain, scheduling |

**`BaseAgent`** (`base_agent.py`) — shared async streaming loop: calls `llm.bind_tools()` with the agent’s allowed subset, runs up to 5 tool-call rounds, yields `token` / `tool_running` / `tool_done` / `done` frames.

**`lc_tools.py`** — `make_lc_tools(ctx)` returns LangChain `@tool`-decorated callables, each delegating to the existing `dispatch_tool()`. Zero code duplication with v1.

**Adding a new specialist:** subclass `BaseAgent`, define `AGENT_NAME`, `SYSTEM_PROMPT`, and `TOOLS`, then register the class in `supervisor.py`’s `_AGENT_DESCRIPTIONS` dict and `_build_agent()`.

---

## WebSocket Chat Protocol

**Endpoint:** `ws://127.0.0.1:8000/ws/chat/{conversation_id}?token=<jwt>`

Authentication: JWT access token as query param (browsers cannot set Authorization headers on WebSocket upgrades).

### Frame types (server → client)

All frames are JSON strings:

```typescript
// Agent selection (v2 LangGraph supervisor only)
{ "type": "agent_selected", "agent": "executive_assistant" }

// Streaming token
{ "type": "token", "content": "...", "conversation_id": "..." }

// Tool status
{ "type": "tool_status", "tool_name": "...", "status": "running"|"done", "label": "...", "conversation_id": "..." }

// Final done
{ "type": "done", "conversation_id": "...", "message_id": "...", "cited_chunk_ids": [...] }

// Error
{ "type": "error", "detail": "..." }
```

### Client → server

```json
{ "type": "human", "content": "user message" }
// or:
{ "type": "ping" }  // keepalive, server responds with {"type":"pong"}
```

---

## Database

### Connection

- **Async:** `postgresql+asyncpg://` via SQLAlchemy async engine
- **Sync:** `postgresql://` for Alembic only
- **Container:** `pmi_postgres` (Docker), port 5432
- **pgvector extension:** enabled in initial migration

### Key Tables

| Table | Purpose |
|---|---|
| `users` | User accounts, roles, hashed passwords |
| `system_settings` | Key-value store for all app settings (`llm.provider`, `llm.embedding_provider`, etc.) |
| `conversations` | Chat conversation metadata |
| `messages` | Individual chat messages with role, content, cited chunk IDs |
| `documents` | Uploaded document metadata |
| `document_chunks` | Chunked text with provider-native pgvector embedding column |
| `tasks` | Task records (Kanban) |
| `projects` | Project groupings |
| `approval_intents` | Human-in-the-loop approval queue |
| `research_reports` | Research report metadata + content |
| `research_sources` | Citation sources for research reports |
| `meeting_notes` | Meeting transcripts + summaries |
| `email_drafts` | AI-generated email drafts |
| `notifications` | User notification records |
| `audit_events` | Immutable audit log |

### Settings Keys

| Key | Default | Description |
|---|---|---|
| `llm.provider` | `"anthropic"` | Active LLM provider |
| `llm.model` | `"claude-sonnet-4-6"` | Active chat model name |
| `llm.ollama_url` | `"http://localhost:11434"` | Ollama server URL |
| `llm.embedding_provider` | `"voyage"` | Active embedding provider |
| `llm.embedding_model` | `"voyage-3"` | Embedding model name |
| `llm.embedding_dimension` | `"1024"` | Vector dimension (provider-native; triggers re-index when changed) |
| `llm.kb_needs_reindex` | `"false"` | Set to `"true"` when re-index is needed after provider/model change |
| `llm.use_langgraph` | `"false"` | Enable LangGraph v2 multi-agent routing |
| `app.theme` | `"system"` | UI theme |
| `app.timezone` | `"UTC"` | User timezone |
| `notifications.email_enabled` | `false` | Email notifications flag |

---

## Google Workspace Integration

**`backend/services/google_service.py`**

- OAuth 2.0 flow via `google-auth-oauthlib`
- Credentials stored in `backend/google_token.json` (gitignored)
- OAuth client config in `backend/google_credentials.json`
- `get_credentials()` — returns valid `Credentials` or `None`; auto-refreshes if expired

### Scopes requested

```python
SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/contacts.readonly",
    "https://www.googleapis.com/auth/tasks.readonly",
    "https://www.googleapis.com/auth/spreadsheets.readonly",
    "openid", "email", "profile",
]
```

### Adding Google to the agent

The executor checks `get_credentials() is not None` and injects a note into the system prompt. When connected:
> "ALWAYS call the appropriate Google tool immediately when the user mentions Drive, Gmail, Calendar, contacts, or any Google Workspace content."

---

## Frontend Architecture

### State management

- **Server state:** TanStack Query (`useQuery`, `useMutation`) — all API calls go through typed functions in `src/api/`
- **Client state:** Zustand stores in `src/stores/`
- **Auth state:** JWT tokens in `localStorage`; auto-refresh via Axios interceptor in `src/api/client.ts`

### Settings pattern

`SettingsPage` uses a `localSettings: SettingsUpdate` state that accumulates uncommitted changes. `mergedSettings = { ...serverSettings, ...localSettings }` is passed down to child sections. On save:

1. `PUT /settings` with `localSettings`
2. `onSuccess`: `qc.invalidateQueries({ queryKey: ["settings"] })` — **critical** — re-fetches server state so the UI doesn't revert
3. `setLocalSettings({})` — clears pending changes

### WebSocket chat — `src/pages/ChatPage.tsx`

- Connects to `ws://127.0.0.1:8000/ws/chat/{id}?token=<jwt>`
- Handles `WSToken`, `WSDone`, `WSError`, `WSToolStatus` frame types
- Streams tokens into the message buffer in real time
- Tool status frames update a live indicator below the streaming message

### Path alias

`@/` maps to `src/` via `tsconfig.app.json` `paths` + Vite `resolve.alias`. The `"ignoreDeprecations": "6.0"` option suppresses the TypeScript 6.0 `baseUrl` deprecation warning.

---

## Backend Routers

| Router | Prefix | Key endpoints |
|---|---|---|
| `auth.py` | `/api/auth` | `POST /login`, `POST /refresh`, `POST /logout` |
| `settings.py` | `/settings` | `GET /`, `PUT /`, `GET /health`, `GET /ai-options`, `POST /reindex` (SSE) |
| `documents.py` | `/documents` | `POST /upload`, `GET /`, `DELETE /{id}`, `POST /{id}/reembed` |
| `search.py` | `/search` | `POST /` (semantic search) |
| `research.py` | `/research` | `POST /`, `GET /`, `GET /{id}` |
| `emails.py` | `/emails` | `POST /`, `GET /`, `POST /{id}/regenerate` |
| `conversations.py` | `/conversations` | `GET /`, `POST /`, `GET /{id}/messages`, `POST /{id}/resolve` (approvals) |
| `tasks.py` | `/tasks` | full CRUD |
| `meetings.py` | `/meetings` | `POST /`, `GET /`, `POST /{id}/summarize`, `POST /{id}/extract-actions` |
| `regulatory.py` | `/regulatory` | CRUD + `POST /{id}/ai-draft`; `/capas` CRUD; `/risks` CRUD |
| `briefings.py` | `/briefings` | `GET /today` (AI-generated), `GET /` |
| `google_integration.py` | `/google` | `GET /status`, `POST /connect`, `DELETE /disconnect`, `POST /drive/import` |
| `health.py` | `/health` | `GET /` (full system check: DB, LLM, embedding, disk) |
| `update.py` | `/update` | `GET /check`, `POST /apply` |

---

## Testing

```bash
# Backend
cd backend && uv run pytest

# Backend type-checking
cd backend && uv run mypy .

# Frontend type-checking
cd frontend && npx tsc --noEmit
```

---

## Database Migrations

```bash
cd backend

# Create a new migration after changing SQLAlchemy models
uv run alembic revision --autogenerate -m "description"

# Apply all pending migrations
uv run alembic upgrade head

# Roll back one step
uv run alembic downgrade -1

# Show migration history
uv run alembic history
```

Migration files live in `backend/migrations/versions/`. The vector column uses `Vector(dim)` from `pgvector.sqlalchemy`, where `dim` is provider-native (1024 for Voyage AI, 3072/1536 for OpenAI, 768 for Ollama).

---

## Building the Installer

Requires [Inno Setup 6](https://jrsoftware.org/isdl.php).

```
Double-click: build-installer.bat
```

Output: `installer\Output\LittleGerry_Setup.exe`

The installer script is `installer/setup.iss`. It:
1. Bundles the Python venv, frontend build, and all scripts
2. Installs Docker Desktop and Node.js via `winget` if missing
3. Creates `Start Little Gerry.bat`, `Stop Little Gerry.bat`, etc. in the install directory

---

## Build Conventions

**After every session that changes user-facing behavior:**

1. Increment `BUILD_NUMBER` in `frontend/src/version.ts`
2. Add a `CHANGELOG` entry at the top of the array with `build`, `date`, `title`, and `changes[]`
3. Update `CHANGELOG.md` in the repo root
4. Commit with message format: `fix:|feat:|docs: <short description>`
5. Push to `soulenya/pmi-agent` master

```typescript
// frontend/src/version.ts
export const BUILD_NUMBER = 34;  // ← increment (current: 33)
export const BUILD_DATE = "2026-06-07";

export const CHANGELOG: ChangelogEntry[] = [
  {
    build: 26,
    date: "2026-06-07",
    title: "Short descriptive title",
    changes: [
      "What changed and why",
    ],
  },
  // ... previous entries
```

---

## Known Issues & Technical Debt

| # | Area | Description | Priority |
|---|------|-------------|----------|
| 1 | Re-embedding | **Resolved (Build 30)** — Settings → AI Engine has a Re-index Now button with live SSE progress modal. | ✅ |
| 2 | Installer | Installer still includes Ollama install step even though it’s no longer required for Anthropic users | Low |
| 3 | Ollama fallback | **Resolved (Build 28)** — `get_llm_client` now raises `RuntimeError` if a cloud API key is missing. Error surfaces to the user. | ✅ |
| 4 | Tests | Test coverage is minimal — `conftest.py` and two test files exist but most routers are untested | High |
| 5 | Docker timeout | First-run setup can fail on slow machines where Docker takes >90s to start | Medium |
| 6 | Linux/macOS | `launcher.py` and most scripts are Windows-only | Low |
| 7 | Token expiry | WebSocket connections don't handle token expiry mid-session — long sessions may break without reconnect | Medium |
| 8 | Search re-index | After re-embedding a document, old chunks with different embeddings remain in the DB until manually deleted | Medium |
| 9 | No streaming for non-chat | Research summarization, email generation, regulatory drafting all use non-streaming `client.chat()` — long waits with no feedback | Low |

---

## Security Notes

- Backend binds to `127.0.0.1` only — not network-accessible
- JWT secrets stored in OS keyring (Windows Credential Manager) via `keyring`
- API keys (Anthropic, OpenAI, Voyage AI) stored in OS keychain — never written to disk or DB
- All document files encrypted at rest with Fernet symmetric encryption
- Rate limiting on all API endpoints via `slowapi`
- CORS restricted to localhost origins
- Google OAuth tokens stored locally; never transmitted to third parties
- All AI actions logged immutably in `audit_events` table

---

*Built for Precisian Medical Instruments · VACTOR Program · June 2026*
