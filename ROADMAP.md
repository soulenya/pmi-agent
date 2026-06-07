# Little Gerry — v2 Implementation Roadmap
**Reference file for phased development — follow this document for all work**

Last updated: 2026-06-07 · Current build: 25 · Spec: LittleGerry_ProjectPrompt_v2.md

---

## How to Use This File

Before starting any work:
1. Identify which phase the task belongs to
2. Verify all prerequisites for that phase are complete
3. Follow the v2 spec design process (analyze → design → DB impact → API contract → code)
4. Mark items `[x]` when done and update `frontend/src/version.ts`

---

## Gap Analysis: Build 25 vs. v2 Spec

| Area | v2 Spec Requires | Current State | Gap Severity |
|------|-----------------|---------------|--------------|
| Embedding dimensions | Provider-native (768/1024/1536/3072) | Always forced to 768 | **CRITICAL** |
| Re-index workflow | Detect mismatch → warn → re-embed all | Not implemented | **CRITICAL** |
| Embedding health check | Live ping on page load | Key-presence check only | HIGH |
| LLM health check | Live ping on page load | Key-presence check only (Anthropic) | HIGH |
| Default provider | `anthropic` / `voyage` | Still `ollama` in DEFAULTS dict | HIGH |
| `get_llm_client_no_db()` | Should never fall back silently to Ollama | Silently returns OllamaClient | HIGH |
| Settings UI — Re-index button | Present with ⚠ warning | Not implemented | HIGH |
| Settings UI — System Health panel | LLM ● + Embedding ● live | Partial (no embedding status) | MEDIUM |
| Settings UI — Embedding model select | Per-provider model dropdown | Not implemented | MEDIUM |
| LangGraph multi-agent | 7 specialized agents via LangGraph | Single hand-rolled executor | LOW (future) |
| Approval write-through | Google writes via approval queue | Queue exists, some paths bypass | MEDIUM |
| Document re-embed per-doc | POST /documents/{id}/reembed | Route exists, needs testing | LOW |

---

## Phase 1 — Embedding Dimension Foundation
**Priority: CRITICAL — all KB functionality depends on this**
**Prerequisite for: Phases 2, 3, 4, 5**

### Problem Statement
The current DB schema has `document_chunks.embedding vector(768)` hardcoded everywhere:
- `001_initial_schema.py` line 217: `ALTER TABLE document_chunks ADD COLUMN embedding vector(768)`
- `models/db/document.py` line 143: `Vector(768)`
- `services/embeddings/service.py`: All providers forced to `output_dimension=768`

The v2 spec defines native dimensions per provider:
| Provider | Model | Native Dimension |
|----------|-------|-----------------|
| Voyage AI | voyage-3 | **1024** |
| Voyage AI | voyage-3-lite | **512** |
| OpenAI | text-embedding-3-large | **3072** |
| OpenAI | text-embedding-3-small | **1536** |
| Ollama | nomic-embed-text | **768** |

Forcing all to 768 loses retrieval quality for cloud providers and violates the spec.

### Design Decision
Since the DB column dimension is fixed at creation time, the strategy is:
1. Store the **active embedding dimension** as a `system_settings` row: `llm.embedding_dimension`
2. When the admin changes the embedding provider in Settings, detect if the dimension changes
3. If it changes: warn user, block search, surface a "Re-index Knowledge Base" action
4. Re-index = drop all `document_chunks` rows, re-embed all parent `documents` through the new provider, update `llm.embedding_dimension`
5. The pgvector column dimension itself requires an ALTER: `ALTER TABLE document_chunks ALTER COLUMN embedding TYPE vector(N)`

### Tasks

- [x] **1.1** Create Alembic migration `002_embedding_dimension_flexible.py`:
  - Drop the `document_chunks` vector index
  - Add `system_settings` row seed: `llm.embedding_dimension = "768"` (current default)
  - No column ALTER yet — the ALTER happens at re-index time (see 1.4)
  - Add `document_chunks.embedding_dimension` integer column to track per-chunk dimension

- [x] **1.2** Update `models/db/document.py`:
  - Add `embedding_dimension: Mapped[int | None]` column to `DocumentChunk`
  - Keep `Vector(768)` for now — will be changed during re-index when provider switches

- [x] **1.3** Add dimension constants to `services/embeddings/service.py`:
  ```python
  PROVIDER_DIMENSIONS = {
      "voyage": {"voyage-3": 1024, "voyage-3-lite": 512},
      "openai": {"text-embedding-3-large": 3072, "text-embedding-3-small": 1536},
      "ollama": {"nomic-embed-text": 768},
  }
  DEFAULT_DIMENSION = 768  # backward compat — current DB column
  ```
  - Remove `output_dimension=768` from `VoyageEmbeddingService.embed()` and `embed_batch()`
  - Remove `dimensions=768` from `OpenAIEmbeddingService.embed()` and `embed_batch()`
  - Each service now returns its native dimension

- [x] **1.4** Add `POST /documents/reindex` endpoint in `routers/documents.py`:
  - Request body: `{ "provider": "voyage", "model": "voyage-3" }` (optional — defaults to current settings)
  - Response: SSE stream with progress `{ "processed": N, "total": M, "status": "running"|"done"|"error" }`
  - Implementation:
    1. Read current `llm.embedding_provider` and `llm.embedding_model` from DB
    2. Get target dimension from `PROVIDER_DIMENSIONS[provider][model]`
    3. If target dimension != current DB column dimension:
       - Run `ALTER TABLE document_chunks ALTER COLUMN embedding TYPE vector({N}) USING NULL`
       - Drop and recreate the pgvector index for new dimension
       - Update `system_settings` `llm.embedding_dimension` = target dimension
    4. Delete all existing `document_chunks` rows
    5. For each `document` with `status=ready`, re-parse and re-embed all chunks
    6. Stream progress events

- [x] **1.5** Add dimension mismatch detection to `routers/settings.py` PUT handler:
  - When `embedding_provider` or `embedding_model` changes:
    - Compare new provider's native dimension with stored `llm.embedding_dimension`
    - If different: set `system_settings` `llm.kb_needs_reindex = "true"`
    - Return a `reindex_required: true` field in the response

- [x] **1.6** Add `reindex_required: bool` and `embedding_dimension: int` to `SettingsOut` schema

- [x] **1.7** Update `repositories/document_repo.py` `DocumentChunkRepository`:
  - `delete_all_chunks()` method for re-index
  - `get_all_document_ids_ready()` method for re-index batch

**Acceptance criteria:**
- Switching to Voyage AI and clicking Re-index stores 1024-dim vectors
- Switching to OpenAI text-embedding-3-large stores 3072-dim vectors
- Search returns results using the correct dimension
- Switching back to Ollama after Voyage triggers re-index warning

### README Update (Phase 1)
After completing this phase, update `README.md`:
- AI Configuration section: update embedding setup instructions to note that Voyage AI stores 1024-dim vectors (no longer 768)
- Knowledge Base section: add note about Re-index requirement when switching embedding providers
- Architecture diagram: update embedding dimension labels per provider
- Remove any mention of "768 dims" as a universal constraint

---

## Phase 2 — Provider Defaults & Silent Fallback Elimination
**Priority: HIGH**
**Prerequisite for: Phase 3 (health checks need correct defaults)**

### Problem Statement
- `DEFAULTS` dict in `settings.py` says `"llm.provider": "ollama"` — should be `"anthropic"`
- `get_llm_client_no_db()` always returns `OllamaClient` regardless of configured provider — used in WebSocket setup path, causes silent degradation
- `config.py` has `default_llm_model = "gemma3:27b"` — should be `claude-sonnet-4-6`

### Tasks

- [x] **2.1** Update `routers/settings.py` DEFAULTS dict:
  ```python
  DEFAULTS = {
      "llm.provider": "anthropic",
      "llm.model": "claude-sonnet-4-6",
      ...
  }
  ```

- [x] **2.2** Update `backend/.env.example` to match v2 spec configuration reference

- [x] **2.3** Update `config.py` `Settings`:
  - `default_llm_model: str = "claude-sonnet-4-6"`
  - `default_embedding_model: str = "voyage-3"`
  - `default_embedding_dimension: int = 1024`

- [x] **2.4** Fix `services/llm/router.py` `get_llm_client_no_db()`:
  - Removed — it is never safe to construct an LLM client without a DB session

- [x] **2.5** Add explicit error response instead of silent Ollama fallback in `get_llm_client()`:
  - Missing cloud API key now raises RuntimeError with Settings link

**Acceptance criteria:**
- Fresh install with Anthropic key set: defaults to claude-sonnet-4-6, no Ollama calls
- Missing API key returns 503 with clear error, not silent Ollama substitution
- `get_llm_client_no_db` removed from codebase

### README Update (Phase 2)
After completing this phase, update `README.md`:
- Prerequisites section: replace any Ollama requirement with "Anthropic API key (required)" as the default
- AI Configuration section: remove any implication that Ollama is the default or fallback
- Troubleshooting section: replace "Check Ollama is running" entries with "Verify API key is set in Settings"
- `.env.example` reference: update shown defaults to `DEFAULT_LLM_PROVIDER=anthropic`

---

## Phase 3 — Health Check & Live Connectivity
**Priority: HIGH**
**Prerequisite for: Phase 4 (UI needs real status data)**

### Problem Statement
The v2 spec requires: "live connectivity status for both the active LLM and embedding provider, tested with a lightweight ping on page load."

Current `GET /health`:
- Anthropic: checks `if api_key` → status ok. No actual API call.
- OpenAI: same.
- Embedding: not checked at all.

### Tasks

- [x] **3.1** Add live LLM ping to `routers/health.py`:
  - Anthropic: `count_tokens` (free)
  - OpenAI: `models.retrieve` (free metadata)
  - Ollama: `GET /api/tags` (unchanged)

- [x] **3.2** Add embedding provider health check to `GET /health`

- [x] **3.3** Add `reindex_required` and `embedding_dimension` to health response

- [x] **3.4** Add a dedicated `GET /settings/health` endpoint:
  - LLM + embedding pings only, concurrent via `asyncio.gather`
  - No disk/DB checks
  - Called by Settings page on load

**Acceptance criteria:**
- `/health` returns embedding check with actual API ping result
- `/settings/health` is callable without impacting the main health check
- A disconnected Voyage key returns `{"status": "error", "detail": "401 Unauthorized"}`

### README Update (Phase 3)
After completing this phase, update `README.md`:
- System Health section: document the `/health` endpoint response shape including new `embedding` and `kb_needs_reindex` fields
- Developer setup: note that `GET /health` performs live API pings (Anthropic, Voyage AI) — requires keys set before health will show green
- Troubleshooting: add entry for each provider-specific health error and its resolution

---

## Phase 4 — Settings UI Completion
**Priority: HIGH**
**Prerequisite: Phases 1, 2, 3 must be complete (UI needs the backend data)**

### Problem Statement
The v2 spec AI Engine Settings UI requires:
1. LLM Provider dropdown → per-provider model selection
2. Embedding Provider dropdown → per-provider model selection (not just free text)
3. ⚠ Warning when embedding provider/model changes (dimension change = re-index required)
4. [Re-index Now] button with progress indicator
5. System Health panel showing live LLM ● and Embedding ● status

### Tasks

- [x] **4.1** Add `llm_provider: str` to `EXPOSED_KEYS` in `routers/settings.py` and include it in `SettingsOut`

- [x] **4.2** Define model option lists for all providers — add to `routers/settings.py` or a new `routers/ai_config.py`:
  ```python
  # GET /settings/ai-options → returns available models per provider
  AI_OPTIONS = {
      "llm": {
          "anthropic": ["claude-sonnet-4-6", "claude-opus-4-5", "claude-haiku-3-5"],
          "openai":    ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
          "ollama":    None,  # dynamic — fetch from ollama /api/tags
      },
      "embedding": {
          "voyage":  ["voyage-3", "voyage-3-lite"],
          "openai":  ["text-embedding-3-large", "text-embedding-3-small"],
          "ollama":  None,  # dynamic
      },
  }
  ```

- [x] **4.3** Update `frontend/src/pages/SettingsPage.tsx` AI Engine section:
  - Replaced embedding provider text input with per-provider `<select>` for embedding model
  - LLM model dropdown uses provider-specific options
  - Added ⚠ warning banner when `settings.reindex_required === true`
  - Added [Re-index Now] button — calls `POST /documents/reindex` via SSE
  - Fixed Voyage AI info box (no longer says "768 dims")
  - Fixed OpenAI info box (no longer says "768 dims")

- [x] **4.4** Add System Health panel to SettingsPage:
  - Compact LLM ● / Embeddings ● live status row inside AI Engine section via `GET /settings/health`
  - System Health section now shows Embeddings row with provider/model/dims and re-index flag

- [x] **4.5** Add re-index progress modal/drawer:
  - `ReindexModal` component connects to `POST /documents/reindex` SSE stream
  - Shows per-document progress (Embedding: doc title (N/M))
  - Shows schema ALTER events (⚙ Changing vector dimension…)
  - Shows success or error state
  - `onReindexComplete` invalidates settings + health queries

**Acceptance criteria:**
- Switching from Voyage to OpenAI shows ⚠ and [Re-index Now] button
- Clicking Re-index Now shows progress and completes without page reload
- Health panel shows live status on Settings page load

### README Update (Phase 4)
After completing this phase, update `README.md`:
- Settings → AI Engine section: replace the current text description with the full ASCII wireframe from the v2 spec (LLM Provider, model dropdown, API key, Embedding Provider, model dropdown, Re-index button, System Health panel)
- USER_GUIDE.md: update the AI Configuration section with per-provider model selection instructions and Re-index Now workflow
- Screenshots or wireframe references if any exist in `/docs/`

---

## Phase 5 — Approval Workflow Completeness
**Priority: MEDIUM**

### Problem Statement
The approval queue DB table and UI exist, but not all consequential actions route through it. The v2 spec requires approvals for: send email, create calendar event, modify a document, post to any external service.

### Tasks

- [x] **5.1** Audit all Google write tools in `services/agent/tools.py`:
  - `send_email` → already routes through `request_approval` tool (no direct execution)
  - `create_calendar_event` → already routes through `request_approval` tool
  - `create_drive_file` / `update_drive_file` → not yet implemented as tools; will be added in Phase 7
  - `request_approval` tool is correctly wired; approved intent now executes via `_execute_approved_action()`

- [x] **5.2** Add `POST /approvals/{id}/execute` endpoint:
  - Implemented as execution logic inside `POST /approvals/{id}/resolve` to keep the API surface minimal
  - When `approved=true`: dispatches `_execute_approved_action()` based on `intent_type`
  - `send_email` → `gmail_send(to, subject, body)` + marks email draft `sent` if `draft_id` in payload
  - `create_calendar_event` → `calendar_create_event(title, start, end, ...)`
  - All other types → `{"status": "no_action"}` (approved but no automated executor)
  - Execution failure returns error result but never rolls back the approval record

- [x] **5.3** Add audit log entry for every approval decision (approved/rejected, by whom, timestamp):
  - `approval.approved` — logged when `approved=true`
  - `approval.rejected` — logged when `approved=false` with rejection reason
  - `approval.action_executed` — logged on successful execution
  - `approval.action_failed` — logged on execution error
  - All entries go through `AuditLogger.log()` with hash-chaining

- [x] **5.4** Verify the Approvals page in the frontend displays pending intents and wires up Approve/Reject buttons to the new execute endpoint:
  - `ApprovalCard` now returns a `Promise<ApprovalIntent>` from `onResolve`
  - Execution result stored in local state and displayed inline after resolution
  - Green banner for executed, red banner for error, grey for no-action
  - Approve/Reject buttons show loading state and are disabled during submission

**Acceptance criteria:**
- Asking Gerry to send an email creates an approval card, not an immediate send
- Approving the card sends the email and logs the action

### README Update (Phase 5)
After completing this phase, update `README.md`:
- Human-in-the-Loop section: document exactly which actions require approval (send email, create calendar event, create/modify Drive file)
- Approvals queue: describe the approve/reject/execute flow and audit log entry
- USER_GUIDE.md Approvals section: confirm the workflow description matches the newly implemented behavior

---

## Phase 6 — Multi-Agent Architecture (LangGraph)
**Priority: LOW — do not start until Phases 1–4 are complete**

### Problem Statement
Current executor is a single hand-rolled agentic loop in `services/agent/executor.py`. The v2 spec calls for LangGraph with 7 specialized agents.

### Design (to be detailed when Phase 5 is done)

```
LangGraph Supervisor
  ├── ExecutiveAssistantAgent   (briefings, task overview, comms summary)
  ├── ResearchAgent             (web search, source synthesis, report gen)
  ├── RegulatoryAgent           (FDA/ISO docs, DHF, 510k drafting)
  ├── QMSAgent                  (CAPA, SOPs, audit trail)
  ├── IRAgent                   (investor comms, pitch materials)
  ├── EngineeringAgent          (VACTOR design docs, BOM)
  └── OperationsAgent           (vendor, scheduling)
```

Each agent:
- Has its own system prompt and tool subset
- Routes through the shared LLM Router (no provider-specific code in agents)
- Has a defined memory scope (conversation-local vs. KB vs. task DB)
- Cannot execute write actions without going through the approval queue

### Migration approach
- Keep current `executor.py` operational during migration
- Build LangGraph agents in `services/agent/v2/` directory
- Add feature flag `llm.use_langgraph = "false"` in system_settings
- Enable per-conversation when stable

### Tasks (to be expanded)

- [ ] **6.1** Add `langgraph`, `langchain-anthropic`, `langchain-openai`, `langchain-ollama` to `pyproject.toml`
- [ ] **6.2** Create `services/agent/v2/base_agent.py` — abstract agent with shared LLM routing
- [ ] **6.3** Create `services/agent/v2/executive_assistant.py` — first agent to implement
- [ ] **6.4** Create `services/agent/v2/research_agent.py`
- [ ] **6.5** Create `services/agent/v2/supervisor.py` — routes queries to correct specialist
- [ ] **6.6** Remaining 5 agents
- [ ] **6.7** Migrate WebSocket handler in `main.py` to use supervisor when feature flag enabled
- [ ] **6.8** Update tool definitions to LangChain tool format

### README Update (Phase 6)
After completing this phase, update `README.md`:
- Architecture diagram: update to show LangGraph Supervisor → 7 specialist agents
- Agent descriptions: add a table of agents (Executive Assistant, Research, Regulatory, QMS, IR, Engineering, Operations) with their primary responsibilities and tool subsets
- DEVELOPER_GUIDE.md: expand the Agent Executor section to document the LangGraph graph structure, supervisor routing logic, and how to add a new agent
- Feature flag: document `llm.use_langgraph` setting and how to enable/disable

---

## Phase 7 — Advanced Features
**Priority: LOW — do not start until Phase 6 is stable**

- [ ] **7.1** Meeting notes: extract action items → one-click create tasks
- [ ] **7.2** Regulatory module: document registry (DHF, IFU, 510k), AI draft generation
- [ ] **7.3** Dashboard: CEO Daily Brief AI generation
- [ ] **7.4** Investor module: IR communications, pitch material context
- [ ] **7.5** QMS module: CAPA tracking, SOP library
- [ ] **7.6** Google Docs ingestion: ingest Drive files directly into KB
- [ ] **7.7** In-app update: GitHub pull + alembic upgrade + restart workflow

### README Update (Phase 7)
After completing this phase, update `README.md`:
- Features section: add Regulatory module, Dashboard briefing, Investor module, QMS module, and Google Docs ingestion
- USER_GUIDE.md: add full documentation sections for each new module matching the detail level of existing sections
- Update the Features at a Glance table with new module status
- Update build number references throughout all docs

---

## Current State Snapshot (Build 25)

### What works correctly
- Anthropic Claude streaming chat (Build 25 rewrite)
- Google Workspace read tools (Gmail, Drive, Calendar, Contacts)
- Embedding provider routing (Voyage/OpenAI/Ollama) — but all at 768 dims
- Settings save/load with query invalidation
- KB import pipeline (with current 768-dim constraint)
- Semantic search (with 768-dim vectors)
- Task CRUD + Kanban
- Research reports with DuckDuckGo
- Email draft generation
- Approval queue (partial)
- Audit log

### What is broken or incomplete
- Voyage AI produces 768-dim vectors instead of native 1024 (forced truncation)
- OpenAI embeddings produce 768-dim instead of native 1536/3072
- No re-index workflow when switching providers
- Health check doesn't actually ping cloud APIs
- Settings UI has no System Health panel or Re-index button
- `get_llm_client_no_db()` silently falls back to Ollama
- Default provider in code is still `ollama` (DEFAULTS dict)

---

## File Change Registry

Files expected to be modified per phase:

| Phase | Files |
|-------|-------|
| 1 | `backend/migrations/versions/002_embedding_dimension.py` (new), `backend/models/db/document.py`, `backend/services/embeddings/service.py`, `backend/routers/documents.py`, `backend/routers/settings.py`, `backend/repositories/document_repo.py` |
| 2 | `backend/routers/settings.py`, `backend/services/llm/router.py`, `backend/config.py`, `backend/.env.example` |
| 3 | `backend/routers/health.py`, `backend/routers/settings.py` |
| 4 | `frontend/src/pages/SettingsPage.tsx`, `backend/routers/settings.py` (AI options endpoint) |
| 5 | `backend/services/agent/tools.py`, `backend/routers/` (approvals) |
| 6 | `backend/services/agent/v2/` (new directory), `backend/main.py`, `pyproject.toml` |
| 7 | Multiple — to be planned at Phase 7 start |

---

## Build Conventions (repeat from DEVELOPER_GUIDE)

Every session that produces user-visible changes:
1. Increment `BUILD_NUMBER` in `frontend/src/version.ts`
2. Add entry at top of `CHANGELOG` array
3. Update `CHANGELOG.md` with same content
4. Commit: `fix:|feat:|refactor: <short description>`
5. Push to `soulenya/pmi-agent` master
6. Mark completed tasks `[x]` in this file

---

*Precisian Medical Instruments · VACTOR Program · v2 Roadmap · 2026-06-07*
