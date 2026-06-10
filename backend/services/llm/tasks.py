"""
LLM Task Registry — defines the general task categories that can each have
their own model override, plus a recommended model per category.

Override resolution (see services.llm.router.get_llm_client):
  1. If settings keys 'llm.task.<task>.provider' AND 'llm.task.<task>.model'
     are both set (non-empty), that pair is used for the task.
  2. Otherwise the global 'llm.provider' / 'llm.model' pick is used.

Overrides are always explicit user choices — the app never switches models
automatically.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class LLMTask:
    key: str
    label: str
    description: str
    recommended_provider: str
    recommended_model: str
    recommended_reason: str


LLM_TASKS: tuple[LLMTask, ...] = (
    LLMTask(
        key="chat",
        label="Chat & Agent",
        description="Main chat conversations, agentic tool use, and scheduled tasks.",
        recommended_provider="anthropic",
        recommended_model="claude-sonnet-4-6",
        recommended_reason="Best balance of reasoning, tool use, and speed for interactive work.",
    ),
    LLMTask(
        key="daily_assistant",
        label="Daily Assistant",
        description="Morning scans of email, calendar, and tasks.",
        recommended_provider="anthropic",
        recommended_model="claude-haiku-4-5",
        recommended_reason="High-volume summarisation — a fast, low-cost model keeps daily scans cheap.",
    ),
    LLMTask(
        key="briefings",
        label="Briefings",
        description="Generated project and status briefings.",
        recommended_provider="anthropic",
        recommended_model="claude-sonnet-4-6",
        recommended_reason="Synthesis across many sources benefits from a mid-tier reasoning model.",
    ),
    LLMTask(
        key="emails",
        label="Email Drafting",
        description="Drafting and summarising emails.",
        recommended_provider="anthropic",
        recommended_model="claude-sonnet-4-6",
        recommended_reason="Strong tone control and concision for professional correspondence.",
    ),
    LLMTask(
        key="meetings",
        label="Meetings",
        description="Agendas, minutes, and meeting summaries.",
        recommended_provider="anthropic",
        recommended_model="claude-sonnet-4-6",
        recommended_reason="Reliable structured output for agendas and minutes.",
    ),
    LLMTask(
        key="regulatory",
        label="Regulatory",
        description="Regulatory document analysis and generation (FDA / ISO).",
        recommended_provider="anthropic",
        recommended_model="claude-opus-4-8",
        recommended_reason="Regulated content warrants the most capable model for accuracy and nuance.",
    ),
    LLMTask(
        key="research",
        label="Research",
        description="Web research and source summarisation.",
        recommended_provider="anthropic",
        recommended_model="claude-haiku-4-5",
        recommended_reason="Summarising many web pages quickly — speed and cost matter most.",
    ),
)

TASK_KEYS: frozenset[str] = frozenset(t.key for t in LLM_TASKS)


def get_task(key: str) -> LLMTask | None:
    for t in LLM_TASKS:
        if t.key == key:
            return t
    return None
