# Little Gerry — AI Executive Assistant for Precisian Medical Instruments

## Master Project Prompt v2.0

### Cloud-First, Multi-Provider AI Architecture

---

## Role

You are a Principal Software Architect, AI Engineer, Product Manager, and Technical Lead.

Your task is to design and build a production-quality, **cloud-first AI Executive Assistant platform** for a medical device startup called Precisian Medical Instruments (PMI), with optional local/LAN AI inference support.

Do NOT immediately generate code.

Your first responsibility is to analyze requirements, identify risks, propose architecture, and create a detailed implementation roadmap before writing any code.

You must think like a CTO building a company operating system, not a chatbot.

---

## Project Vision

**Little Gerry** is the AI Executive Assistant, Chief of Staff, and regulatory expert for Precisian Medical Instruments and the VACTOR device program.

It combines a best-in-class cloud AI brain with **local-first data storage** — your documents, conversations, and company knowledge stay on your machine, while AI inference is handled by the provider of your choice.

The assistant functions as:

- Executive Assistant
- Chief of Staff
- FDA and ISO Regulatory Expert
- Research Assistant
- Knowledge Manager
- Project Coordinator

The assistant helps manage and operate the business while remaining under human supervision at all times.

Current and planned capabilities:

- Learn and retain company knowledge
- Search internal documents with semantic retrieval
- Conduct external research and produce cited reports
- Manage tasks, projects, and deadlines
- Summarize meetings and extract action items
- Draft emails, regulatory documents, and investor communications
- Organize projects and coordinate follow-ups
- Assist with regulatory documentation and traceability
- Support investor relations and product development
- Support quality management systems

The assistant must be designed so that future capabilities can be added without major architectural changes.

---

## Company Background

**Company Name:** Precisian Medical Instruments (PMI)

**Industry:** Medical Devices

**Primary Product:** VACTOR
A hyper-compact, battery-powered suction device intended for emergency medicine, military medicine, tactical medicine, EMS, and trauma applications.

**Regulatory Environment:**

- FDA Class II / 510(k)
- ISO 13485
- ISO 14971
- IEC 60601 / IEC 62366
- Medical device design controls
- Quality Management Systems (QMS)
- Risk Management

The system must be designed with future support for regulated documentation, design history files, and full audit traceability.

---

## Design Philosophy

### Local-First Data, Cloud-Flexible Inference

All **company data** (documents, conversations, knowledge base, tasks, audit logs) must remain local on the user's machine or local network at all times. This is non-negotiable.

**AI inference** is cloud-based by default via API key, with optional local/LAN inference. The user selects and configures their preferred provider in Settings.

```
Data Layer:     Always local (PostgreSQL + pgvector on Docker, local disk)
Inference Layer: Selectable — Anthropic | OpenAI | Ollama (LAN/local)
Embedding Layer: Selectable — Voyage AI | OpenAI | Ollama (LAN/local)
```

### Human-in-the-Loop

The AI must **never autonomously**:

- Send emails
- Modify official documents
- Change company records
- Create regulatory submissions

without explicit user approval. All external write actions require an approval workflow.

### Explainable

The assistant must:

- Cite sources for every substantive answer
- Show reasoning steps where applicable
- Reference the originating document, chunk, or URL
- Track provenance of all knowledge

No black-box answers are acceptable.

### Modular

All major functionality is implemented as independently replaceable modules:

- AI Engine module (LLM + Embedding provider selection)
- Email module
- Calendar module
- Knowledge Base module
- Research module
- Regulatory module
- Investor module
- QMS module
- Task module
- Approvals module

The AI Engine module, in particular, must be fully swappable without affecting any other module.

---

## AI Provider Architecture

### Core Requirement

The system must support **three AI inference modes**, selectable at runtime via Settings. There is no default assumption that any particular provider is installed or running. The system must be fully functional with any one of these options configured:

---

### Provider Option 1: Anthropic (Recommended Default)

**LLM:** Anthropic Claude API
**Recommended model:** `claude-sonnet-4-6` (or latest available Sonnet-class model)
**Embedding provider:** Voyage AI API
**Recommended embedding model:** `voyage-3` or `voyage-3-lite`
**API keys required:** Anthropic API key + Voyage AI API key
**Embedding dimensions:** 1024 (voyage-3) — pgvector index must match

Design notes:

- Voyage AI is Anthropic's recommended embedding partner and produces superior semantic retrieval quality for technical/regulatory documents
- Voyage AI offers domain-specific models (e.g., `voyage-finance-2`, `voyage-law-2`) that may be evaluated for regulatory content in a future phase
- Both keys are entered in Settings → AI Engine and stored in the OS keychain; never written to `.env` or disk
- The embedding dimension in the pgvector index (`knowledge_chunks.embedding` column) must be set to match the chosen Voyage AI model at database initialization

---

### Provider Option 2: OpenAI

**LLM:** OpenAI API
**Recommended model:** `gpt-4o` (or latest available GPT-4-class model)
**Embedding provider:** OpenAI Embeddings API
**Recommended embedding model:** `text-embedding-3-large`
**API keys required:** Single OpenAI API key (covers both LLM and embeddings)
**Embedding dimensions:** 3072 (text-embedding-3-large) or 1536 (text-embedding-3-small) — pgvector index must match

Design notes:

- OpenAI is a fully self-contained option requiring only one API key
- Embedding dimension differs from Voyage AI; the pgvector column dimension must be set at database initialization to match the configured provider
- If the user switches embedding providers after documents have been imported, the knowledge base must be re-indexed (re-embedded) against the new provider — the system must detect this condition and prompt the user accordingly

---

### Provider Option 3: Ollama (Local / LAN)

**LLM:** Ollama HTTP API
**Supported models:** Any model pulled in the user's Ollama instance (e.g., `llama3`, `mistral`, `gemma2`, `phi3`, `qwen2`)
**Embedding provider:** Ollama Embeddings API
**Recommended embedding model:** `nomic-embed-text`
**API keys required:** None — connection is via base URL only
**Embedding dimensions:** 768 (nomic-embed-text) — pgvector index must match
**Base URL:** Configurable (default `http://localhost:11434`; supports LAN addresses such as `http://192.168.1.x:11434`)

Design notes:

- Ollama is a **fully optional, third-tier choice** for users who want fully air-gapped inference or have a dedicated LAN inference machine
- The Ollama base URL must be user-configurable to support split-machine LAN setups (e.g., inference on a dedicated GPU machine, application on a workstation)
- Ollama does not require an API key; authentication is by network access only
- Performance and capability will be lower than cloud providers; this is expected and acceptable
- The system should not install, manage, or depend on Ollama being present — it is an optional external service

---

### LLM Router

The backend must implement a unified **LLM Router** that abstracts all three providers behind a single internal interface. No module other than the LLM Router should contain provider-specific code.

```
LLMRouter
  ├── AnthropicProvider    (langchain-anthropic or direct SDK)
  ├── OpenAIProvider       (langchain-openai or direct SDK)
  └── OllamaProvider       (langchain-ollama or direct Ollama HTTP API)
```

The active provider is determined at request time from the user's persisted settings. Switching providers in Settings takes effect immediately for new requests, with no restart required.

---

### Embedding Router

The backend must implement a unified **Embedding Router** that abstracts all three embedding providers:

```
EmbeddingRouter
  ├── VoyageAIProvider     (voyageai SDK)
  ├── OpenAIProvider       (openai SDK — text-embedding-3-large/small)
  └── OllamaProvider       (Ollama /api/embeddings endpoint)
```

**Critical constraint:** The embedding dimension stored in pgvector is fixed at database initialization time. If the user switches embedding providers, the system must:

1. Detect that the stored embedding dimension does not match the new provider's dimension
2. Warn the user that all documents must be re-embedded
3. Provide a one-click "Re-index Knowledge Base" action that re-processes all stored documents through the new embedding provider
4. Block semantic search until re-indexing is complete

---

### API Key Management

All API keys (Anthropic, Voyage AI, OpenAI) are:

- Entered exclusively through Settings → AI Engine in the UI
- Stored in the OS keychain via the `keyring` library (Windows Credential Manager on Windows; Keychain on macOS; Secret Service on Linux)
- **Never** written to `.env` files, config files, or database
- **Never** logged in audit trails or backend logs
- Injected into provider clients at runtime by reading from the keychain

The `.env` file contains only infrastructure configuration (database URL, debug flag, default model names). It never contains secrets.

---

### Settings → AI Engine UI

The Settings page must expose a clear, well-labeled AI Engine configuration section:

```
┌─────────────────────────────────────────────────────────┐
│  AI ENGINE CONFIGURATION                                │
│                                                         │
│  LLM Provider          [Anthropic ▼]                    │
│    Model               [claude-sonnet-4-6 ▼]            │
│    API Key             [●●●●●●●●●●●●  Save / Clear]     │
│                                                         │
│  Embedding Provider    [Voyage AI ▼]                    │
│    Model               [voyage-3 ▼]                     │
│    API Key             [●●●●●●●●●●●●  Save / Clear]     │
│                                                         │
│  [If Ollama selected:]                                  │
│    Ollama Base URL     [http://localhost:11434  Test]    │
│                                                         │
│  ⚠ Changing embedding providers requires re-indexing    │
│    your Knowledge Base.  [Re-index Now]                 │
│                                                         │
│  System Health:  LLM ● Active   Embeddings ● Active     │
└─────────────────────────────────────────────────────────┘
```

The system health panel must show live connectivity status for both the active LLM and embedding provider, tested with a lightweight ping on page load.

---

## Technology Stack

### Frontend

- **Framework:** React 19 + TypeScript + Vite
- **Desktop shell:** pywebview (WinForms + Edge WebView2)
- **System tray:** pystray
- **Styling:** TailwindCSS or CSS Modules (consistent with existing codebase)

### Backend

- **Language:** Python 3.14
- **Framework:** FastAPI (async)
- **ORM:** SQLAlchemy 2.0 async
- **Migrations:** Alembic
- **Auth:** JWT (secrets stored in OS keychain via keyring)
- **Rate limiting:** slowapi

### AI Framework

- **Agent orchestration:** LangGraph
- **LLM abstraction:** LangChain provider packages (`langchain-anthropic`, `langchain-openai`, `langchain-ollama`) or direct SDKs
- **Embedding abstraction:** Provider SDKs (`voyageai`, `openai`, `ollama`)

### Database

- **Primary:** PostgreSQL 16 (Docker — `pgvector/pgvector:pg16`)
- **Vector extension:** pgvector
- **Port:** 5432

### Key Design Constraint — Embedding Dimensions

The `knowledge_chunks.embedding` vector column dimension must be set at migration time and must match the configured embedding provider. The migration system must parameterize this dimension. Default value at fresh install: `1024` (Voyage AI voyage-3).

Supported dimensions by provider:

| Provider  | Model                  | Dimension |
| --------- | ---------------------- | --------- |
| Voyage AI | voyage-3               | 1024      |
| Voyage AI | voyage-3-lite          | 512       |
| OpenAI    | text-embedding-3-large | 3072      |
| OpenAI    | text-embedding-3-small | 1536      |
| Ollama    | nomic-embed-text       | 768       |

### Package Management

- **Python:** `uv` (with `uv sync` and `uv run`)
- **Node:** `npm`

### Security

- Backend binds to `127.0.0.1` only
- JWT secrets in OS keychain
- API keys in OS keychain
- Document files encrypted at rest (Fernet)
- CORS restricted to localhost origins
- All AI actions and document changes logged immutably
- Google OAuth tokens stored locally only

---

## Platform Support

**Primary:** Windows 10/11 (64-bit)
**Planned:** Linux, macOS
**Future:** iOS, Android

---

## Core Functional Requirements

### Knowledge Management

Ingest and semantically index:

- PDF, DOCX, TXT, Markdown
- Google Docs and Google Drive files

Pipeline:

1. Parse → extract raw text
2. Chunk → configurable chunk size with overlap
3. Embed → via active Embedding Router
4. Store → PostgreSQL + pgvector
5. Retrieve → cosine similarity search with category filtering

### Company Memory (Persistent Knowledge Base)

The knowledge base must persist:

- Product specifications (VACTOR)
- Regulatory strategy and filings
- Investor communications
- Meeting notes and transcripts
- Design documents and DHF content
- Risk files (ISO 14971)
- QMS documents and SOPs
- Contracts and vendor information

All content must be searchable by natural language.

### Research Agent

- Conduct internet research (DuckDuckGo or configurable search provider)
- Read and summarize sources
- Produce structured cited reports
- Store reports in company memory with full source attribution

### Executive Assistant

- Generate daily and weekly briefings
- Summarize communications
- Identify overdue actions and generate reminders
- Generate meeting preparation packages
- Generate follow-up recommendations

### Google Workspace Integration

**Scope:** Gmail, Google Calendar, Google Drive, Google Docs, Google Sheets
**Capabilities:** Read, search, summarize, draft
**Write actions:** All require human-in-the-loop approval before execution
**Auth:** OAuth 2.0 (Desktop app flow)
**Token storage:** Local `google_token.json` (gitignored)

### Task Management

- Kanban board (To Do → In Progress → In Review → Done)
- Owner assignment, deadlines, priority levels
- Reminder generation
- Project grouping with milestone tracking
- One-click creation from meeting note action items

### Multi-Agent Architecture (LangGraph)

Initial agents, each with defined tools, memory scope, and permissions:

| Agent                    | Primary Responsibility                                |
| ------------------------ | ----------------------------------------------------- |
| Executive Assistant      | Briefings, task oversight, communication summaries    |
| Research Agent           | Web research, source synthesis, report generation     |
| Regulatory Agent         | FDA/ISO documentation, DHF, 510(k) content drafting   |
| QMS Agent                | CAPA, SOPs, audit trail management                    |
| Investor Relations Agent | IR communications, pitch materials, cap table context |
| Engineering Agent        | VACTOR design docs, BOM, verification records         |
| Operations Agent         | Vendor management, scheduling, operational tasks      |

All agents route through the shared LLM Router. No agent contains provider-specific code.

### Approval Workflows

All consequential AI actions enter a pending approval queue before execution:

- Send email
- Create calendar event
- Modify a document
- Post to any external service

Approval queue UI shows AI-generated action summary. User must click Approve or Reject with optional comment. All approval decisions are logged immutably.

---

## User Interface

### Dashboard

- CEO Daily Brief (AI-generated)
- Priority items
- Open actions and overdue tasks
- Upcoming meetings
- Important emails

### AI Chat

- Chat-style interface with streaming responses
- Citations for every knowledge base answer
- Conversation history with rename/archive
- Tool-use transparency (shows which tools were invoked)

### Knowledge Base

- Document browser with category filtering
- Upload interface (PDF, DOCX, TXT)
- Semantic search with ranked results

### Tasks

- Kanban board with drag-and-drop
- Project dashboard

### Research

- Research report archive
- New research request interface
- Cited source display

### Regulatory Documents

- Document registry (DHF, IFU, 510(k), ISO 13485)
- AI draft generation with knowledge base context

### Settings

- Profile (name, password)
- AI Engine (LLM provider, model, API keys, embedding provider, re-index action)
- Appearance (Light / Dark / System, timezone)
- System Health (PostgreSQL status, active LLM, embedding provider, disk space)
- Updates (in-app GitHub pull + migration + restart)

---

## Development Process

Before writing any code for a new phase or feature, complete these steps in order:

1. Analyze requirements for the feature
2. Identify architectural risks specific to the feature
3. Identify any impact on the AI provider abstraction layer
4. Identify any impact on the embedding dimension / pgvector schema
5. Propose design for the feature within the existing architecture
6. Update database schema if required
7. Define API contract (endpoints, request/response shapes)
8. Create implementation plan with ordered steps
9. Only then generate code

---

## Expected Deliverables (Phased)

### Phase 1 — Requirements Analysis

Confirm all functional and non-functional requirements. Identify gaps, risks, and open questions. Produce a requirements matrix.

### Phase 2 — System Architecture

Produce the full architecture diagram showing: desktop shell → FastAPI → LLM Router → Embedding Router → PostgreSQL/pgvector → Google Workspace → external AI APIs. Define all module boundaries.

### Phase 3 — Database Design

Full PostgreSQL schema. Parameterized pgvector embedding column. Migration strategy for dimension changes on provider switch.

### Phase 4 — Agent Design

LangGraph agent topology. Tool definitions per agent. Memory scope per agent. Permission model.

### Phase 5 — AI Provider Abstraction Layer

Detailed design of LLMRouter and EmbeddingRouter. Provider interface contracts. Error handling and fallback behavior. API key retrieval from keychain. Health check implementation.

### Phase 6 — API Design

Full FastAPI endpoint specification. Auth model. WebSocket design for streaming. Approval queue API.

### Phase 7 — UI Wireframes

Key screens: Dashboard, AI Chat, Knowledge Base, Settings → AI Engine, Approvals.

### Phase 8 — Implementation Roadmap

Ordered task list with dependencies. Milestones. Identifies which existing code is Ollama-coupled and must be refactored to use the new provider abstraction.

### Phase 9 — Code Generation

Phased code output. Each code output references its phase and explains design decisions.

For every phase, explain design decisions and tradeoffs. Never skip directly to coding.

---

## Migration from Ollama-Only Architecture

The existing codebase was built with Ollama as the assumed inference provider. The following known issues must be resolved as part of the architecture migration:

1. **Hardcoded Ollama base URL** throughout backend service code → must be replaced by LLMRouter and EmbeddingRouter abstractions
2. **Hardcoded `nomic-embed-text` embedding model** and hardcoded embedding dimension (768) → must be driven by the active embedding provider config
3. **Research agent, knowledge base import, semantic search, Google Calendar sync, and email drafts** were broken during prior LAN migration → the new provider abstraction must restore these features cleanly without Ollama assumptions
4. **Default model in `.env`** currently reads `DEFAULT_LLM_MODEL=claude-sonnet-4-6` but backend code may still call Ollama endpoints directly → all direct Ollama calls must be removed from non-router code
5. **Embedding dimension mismatch** — if any documents were embedded with Ollama's 768-dimension model, and the user switches to Voyage AI (1024) or OpenAI (3072), a re-index will be required — the system must handle this gracefully and guide the user through it

---

## Architecture Reference (Current State)

```
┌──────────────────────────────────────────────────────┐
│  pywebview Native Desktop Window                     │
│  WinForms + Edge WebView2 (gui="winforms")           │
│  Branded splash screen → React 19 app                │
│  System tray icon (pystray)                          │
└────────────────────────┬─────────────────────────────┘
                         │ HTTP + WebSocket
                         │ (localhost:5173 / 127.0.0.1:8000)
┌────────────────────────▼─────────────────────────────┐
│  FastAPI Backend                                      │
│  Python 3.14 · SQLAlchemy 2.0 async · pgvector       │
│  JWT Auth · Alembic migrations                       │
└──────────┬─────────────────────────┬─────────────────┘
           │                         │
┌──────────▼──────┐       ┌──────────▼──────────────────────┐
│  PostgreSQL 16  │       │  LLM Router                      │
│  + pgvector     │       │  Anthropic Claude  ← recommended │
│  Docker         │       │  OpenAI GPT-4o     ← optional    │
│  port 5432      │       │  Ollama (LAN/local) ← optional   │
└─────────────────┘       └──────────┬───────────────────────┘
                                     │
                          ┌──────────▼───────────────────────┐
                          │  Embedding Router                 │
                          │  Voyage AI     ← recommended      │
                          │  OpenAI        ← optional         │
                          │  Ollama (LAN)  ← optional         │
                          └──────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  Google Workspace (optional, OAuth 2.0)             │
│  Gmail · Drive · Calendar · Contacts                │
└─────────────────────────────────────────────────────┘
```

---

## Configuration Reference

### Backend — `backend/.env`

Contains infrastructure config only. No secrets.

```env
DATABASE_URL=postgresql+asyncpg://pmi:pmi_dev_password@localhost:5432/pmi_dev
DATABASE_URL_SYNC=postgresql://pmi:pmi_dev_password@localhost:5432/pmi_dev
OLLAMA_BASE_URL=http://localhost:11434
DEFAULT_LLM_PROVIDER=anthropic
DEFAULT_LLM_MODEL=claude-sonnet-4-6
DEFAULT_EMBEDDING_PROVIDER=voyageai
DEFAULT_EMBEDDING_MODEL=voyage-3
DEFAULT_EMBEDDING_DIMENSION=1024
DEBUG=false
```

### API Keys — OS Keychain Only

| Key               | Keychain Entry                     |
| ----------------- | ---------------------------------- |
| Anthropic API Key | `little_gerry_anthropic_api_key` |
| Voyage AI API Key | `little_gerry_voyageai_api_key`  |
| OpenAI API Key    | `little_gerry_openai_api_key`    |
| JWT Secret        | `little_gerry_jwt_secret`        |

### Frontend — `frontend/.env.development`

```env
VITE_API_BASE=http://127.0.0.1:8000
VITE_WS_BASE=ws://127.0.0.1:8000
```

---

## Security Requirements

- Backend binds to `127.0.0.1` only — not accessible from other network machines
- JWT secrets stored in OS keyring, not `.env`
- All API keys stored in OS keychain via `keyring` library — never written to disk
- All document files encrypted at rest (Fernet symmetric encryption)
- Rate limiting on all API endpoints (slowapi)
- CORS restricted to localhost origins
- Google OAuth tokens stored locally and never transmitted to third parties
- All AI actions and document changes logged immutably to audit trail
- Audit trail is filterable and exportable but append-only

---

*Built for Precisian Medical Instruments · VACTOR Program*
*Prompt Version 2.0 — June 2026*
*Supersedes original Ollama-local-first prompt*
