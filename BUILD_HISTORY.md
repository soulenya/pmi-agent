# Little Gerry — Build / Commit Reference

Use this file to identify the exact GitHub commit for any build and roll back if needed.

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
| 33+   | `8d08b23` | 2026-06-07 | fix: ChatSidebar WebSocket — wrong URL, send format, broken handler |
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
| `002`              | Flexible embedding dimensions (Phase 1) — **current HEAD** |
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
| 33 | `frontend/src/pages/InvestorPage.tsx` (new), `backend/routers/meetings.py` |
| 32 | `backend/services/agent/v2/` (new package — 9 files), `backend/main.py`, `backend/routers/settings.py` |
| 31 | `backend/routers/conversations.py`, `frontend/src/pages/ApprovalsPage.tsx`, `frontend/src/types/chat.ts` |
| 30 | `frontend/src/pages/SettingsPage.tsx`, `backend/routers/settings.py` |
| 29 | `backend/routers/health.py`, `backend/routers/settings.py` |
| 28 | `backend/services/llm/router.py`, `backend/routers/settings.py`, `backend/config.py` |
| 27 | `backend/migrations/versions/002_embedding_dimension_flexible.py`, `backend/services/embeddings/service.py`, `backend/models/db/document.py` |

---

*Updated: 2026-06-07 after Build 33 + ChatSidebar fix*
