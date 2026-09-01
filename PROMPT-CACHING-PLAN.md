# Prompt Caching — Plan (PAUSED)

**Status:** paused 2026-08-22. Nothing implemented. `cache_control` appears nowhere in the codebase.
**Target release when resumed:** v3.3.54, build 216.
**Reference doc:** `Prompt caching.md` in the repo root (Anthropic's official guide, untracked).

---

## Why

Measured on 2026-08-22, not estimated. Every Anthropic API call from the v1 agent loop carries this fixed, unchanging prefix:

| Component | Chars | ~Tokens |
|---|---|---|
| 69 tool definitions (converted to Anthropic shape) | 63,905 | ~15,976 |
| Hard-coded system prompt + guardrails | 12,889 | ~3,222 |
| **Total fixed prefix per call** | **76,794** | **~19,198** |

Static system-text breakdown:

| Constant | Chars |
|---|---|
| `SYSTEM_PROMPT` (executor.py L55) | 6,553 |
| `HONESTY_CONTRACT` | 1,401 |
| `PERIOD_REPORT_NOTE` | 1,110 |
| `EMAIL_FACT_CHECK_NOTE` | 936 |
| `WRITING_STYLE_NOTE` | 877 |
| `RESTRICTED_SOURCES_NOTE` | 758 |
| `EDIT_GRANT_NOTE` | 645 |
| `VOICE_MODE_NOTE` (voice turns only) | 609 |

`MAX_TOOL_ROUNDS` is **30** (`config.py` L75 → `executor.py` L50). Each round is a separate API call that re-sends the whole prefix. A five-tool message sends ~115,000 tokens of identical text; at Sonnet 5's $2/MTok that is ~$0.23 per message before any real content.

Cache economics: write = 1.25× base, read = 0.1× base, TTL 5 min refreshed on hit. Break-even is the **second** call — 1.35× for write+read vs 2.0× uncached.

---

## Plan, in priority order

### 1. Breakpoint on the last tool definition — DO THIS FIRST

~16,000 tokens, 83% of the fixed prefix. Tools sit first in Anthropic's `tools` → `system` → `messages` prefix order, so this cache entry is immune to the date, the live document, the workroom journal, and history length. Nothing except a release invalidates it.

Change is confined to `backend/services/llm/anthropic_client.py` — attach `cache_control: {"type": "ephemeral"}` to the final entry of the array built by `_convert_tools`, for both `chat()` and `chat_stream()`.

### 2. Split the system prompt into stable + volatile blocks

`_split_messages` currently emits `system` as one concatenated string, so there is nowhere to put a breakpoint. Must become a list of two content blocks, breakpoint on the first.

The assembly in `executor.py` L618–690 concatenates in this order — note what is mixed in:

```
[A] SYSTEM_PROMPT.format(today=today)  <-- date is at the VERY TOP; system block changes at midnight
[B] google_note                        (2 variants: Connected / NOT CONNECTED)
[C] HONESTY_CONTRACT
[D] RESTRICTED_SOURCES_NOTE
[E] EDIT_GRANT_NOTE
[F] EMAIL_FACT_CHECK_NOTE
[G] PERIOD_REPORT_NOTE
[H] WRITING_STYLE_NOTE
[I] identity            (get_user_identity_context, L645 — per-user, stable)
[J] VOICE_MODE_NOTE     (conditional on voice)
[K] company_ctx         (get_company_context, L658 — session-stable)
[L] voice_ctx           (get_agent_style_block — stable)
[M] attach_ctx          (per-conversation pinned files)
[N] live_doc            <-- RE-READ FROM DRIVE EVERY TURN (build_live_doc_context, L680)
[O] room_ctx            <-- GROWS EVERY TURN (build_workroom_context, L687)
```

Reorder so the stable head is `[B]`–`[L]` (with the breakpoint after it) and the volatile tail is `[A]`'s date + `[M]`–`[O]`. Recovers ~3,200 tokens that are currently invalidated whenever the user edits a followed doc.

### 3. Breakpoint on the last message — lowest confidence

Helps long tool-round turns, since each round appends a large tool result. But `list_for_conversation(..., limit=40, most_recent=True)` drops the oldest messages once past 40, changing the prefix every turn from then on. Don't do this until that window is addressed.

### 4. Instrumentation — ship with 1 and 2, not after

`StreamChunk` (`backend/services/llm/ollama.py`, uses `__slots__`) gained `stop_reason` in v3.3.52 — add `cache_read_input_tokens` and `cache_creation_input_tokens` the same way and log them. Without this there is no way to tell a hit from a miss.

Usage fields on the response: `cache_creation_input_tokens`, `cache_read_input_tokens`, `input_tokens` (**only** the tokens after the last breakpoint). Total = all three summed. If both cache counters read 0, the prompt was below the minimum and caching silently did nothing.

---

## Traps — verified against Anthropic's doc

- **Do NOT use automatic caching** (single top-level `cache_control` in the request body). It places the breakpoint on the last cacheable block. Our system block varies per turn via `live_doc`, so the prefix hash changes and the lookback finds nothing — we would pay a write on every request and never get a read. This is the doc's "breakpoint on content that changes every request" mistake. **Explicit breakpoints only.**
- **Minimum cacheable prompt is 1,024 tokens for `claude-sonnet-5`** (`DEFAULT_MODEL` in `anthropic_client.py`). The tools block clears this by 15×. Below the minimum, caching is a silent no-op.
- **Every release invalidates everything.** One edited tool description changes the tools hash. Expect a cold first call after each update.
- **v2 agents filter tools per agent** (`v2/base_agent.py` L50–51: `allowed = set(self.TOOLS); return [t for t in all_tools if t.name in allowed]`). ~8 specialists = ~8 separate cache entries. Still worth it, just less concentrated than v1, which passes all 69 unfiltered at `executor.py` L396.
- **Images invalidate the message cache.** The vision extraction path passes document blocks, but it is a separate non-streaming call, so it won't disturb the chat cache. Caching won't help there either.
- Also invalidating: `tool_choice` changes, thinking/effort config changes, web-search or citations toggles.
- **Max 4 breakpoints.** Lookback window is 20 blocks.
- Default TTL 5 min, refreshed free on every hit, measured from the **start** of the writing request (generation time counts against it). A 1-hour TTL exists at 2× write cost — don't reach for it without measuring first.

---

## Call sites (from the audit)

**v1 primary loop:**
- `executor.py` L396 `.chat_stream()` — main agent loop, ~20–30K tokens, 1×/turn × up to 30 rounds. **The prize.**
- `executor.py` L266 `.chat()` — auto-title, ~1K tokens, 1×/turn.
- `executor.py` L568 `.chat_stream()` — rare fallback when tool rounds are exhausted.

**v2:** `v2/supervisor.py` L156 (`_SUPERVISOR_PROMPT` hardcoded, ~800–1,000 tokens) then `v2/base_agent.py` L125 — 2 cache entries per turn.

**Secondary target:** `services/meetings/live_assist.py` L334 and L590 — every 30s during a meeting, ~3–5K tokens, stable system prompt, comfortably inside the 5-minute TTL.

**Low frequency, low value:** `assistant/daily_scan.py` L245 (1×/day), `workroom_daily.py` L336 (1×/day), `regulatory/generator.py` L127/L252, `writing_voice.py` L247/L253, `document_extraction.py` L255/L310/L322.

---

## To resume

Start at step 1. Standing release flow applies: throwaway smoke script under `backend/` run with `backend\.venv\Scripts\python.exe` and `set PYTHONIOENCODING=utf-8`, delete it after; `npm run build` in `frontend`; docs gate (`CHANGELOG.md`, `USER_GUIDE.md`, `README.md`, `frontend/src/version.ts` → build 216); commit, push, merge to master, bump `installer/setup.iss` + `VERSION`, `iscc`, **Morgan signs**, verify signature reads `Valid`, `gh release create`, back-merge.
