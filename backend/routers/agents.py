"""
Agents roster — read-only directory of every agent in the system.

The tool lists are read dynamically from each v2 agent class's TOOLS
whitelist so they stay current. The one-line descriptions are maintained
here (derived from each agent's SYSTEM_PROMPT); update them if an agent's
role changes.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_current_user

router = APIRouter(prefix="/agents", tags=["agents"])


class AgentInfo(BaseModel):
    name: str
    display_name: str
    kind: str  # "supervisor" | "specialist" | "custodian" | "legacy"
    description: str
    tools: list[str]
    surfaces: list[str]  # where the user encounters this agent


class AgentRosterResponse(BaseModel):
    agents: list[AgentInfo]
    chat_model: str | None
    chat_provider: str | None


# Maintained descriptions — keep in sync with each agent's SYSTEM_PROMPT.
_DESCRIPTIONS: dict[str, tuple[str, str]] = {
    "executive_assistant": (
        "Executive Assistant",
        "General queries, daily briefings, email triage, task management, "
        "scheduling, Google Workspace access, and communications summaries.",
    ),
    "research": (
        "Research",
        "Web research, market analysis, competitive intelligence, literature "
        "review, FDA/ISO guidance lookup, and cited report generation.",
    ),
    "regulatory": (
        "Regulatory",
        "FDA 510(k), Design History File, IFU, labeling compliance, ISO 13485, "
        "ISO 14971, IEC 60601-1, regulatory strategy, and gap analysis for VACTOR.",
    ),
    "qms": (
        "QMS",
        "Quality Management System: CAPA, SOPs, non-conformances, internal "
        "audits, document control, and supplier quality.",
    ),
    "ir": (
        "Investor Relations",
        "Pitch decks, financial narratives, due diligence data room, cap table, "
        "investor updates, and SBIR/grant research.",
    ),
    "engineering": (
        "Engineering",
        "Hardware, firmware, systems engineering, BOM review, test protocols, "
        "design V&V, design FMEA, and technical documentation for VACTOR.",
    ),
    "operations": (
        "Operations",
        "Procurement, supply chain, production scheduling, vendor management, "
        "Google Sheets BOM/budget data, and operational logistics.",
    ),
    "house_manager": (
        "House Manager",
        "Application custodian for voice sessions: manages conversations, "
        "generated files, tasks, schedules, and the knowledge base; reports on "
        "settings, users, the audit trail, and approvals (read-only); can "
        "delegate work to any specialist. Destructive actions and Drive "
        "uploads require spoken confirmation.",
    ),
}


def _v2_agent_classes() -> dict[str, type]:
    from services.agent.v2.executive_assistant import ExecutiveAssistantAgent
    from services.agent.v2.research_agent import ResearchAgent
    from services.agent.v2.regulatory_agent import RegulatoryAgent
    from services.agent.v2.qms_agent import QMSAgent
    from services.agent.v2.ir_agent import IRAgent
    from services.agent.v2.engineering_agent import EngineeringAgent
    from services.agent.v2.operations_agent import OperationsAgent
    from services.agent.v2.house_manager import HouseManagerAgent

    return {
        cls.AGENT_NAME: cls
        for cls in (
            ExecutiveAssistantAgent,
            ResearchAgent,
            RegulatoryAgent,
            QMSAgent,
            IRAgent,
            EngineeringAgent,
            OperationsAgent,
            HouseManagerAgent,
        )
    }


@router.get("", response_model=AgentRosterResponse)
async def get_agent_roster(
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
) -> AgentRosterResponse:
    from services.llm.router import resolve_task_llm

    agents: list[AgentInfo] = []

    # Supervisor (v2 router — not an agent the user picks directly)
    agents.append(
        AgentInfo(
            name="supervisor",
            display_name="Supervisor",
            kind="supervisor",
            description=(
                "Routes each request to the right specialist. Voice sessions "
                "are pinned to the House Manager and skip routing."
            ),
            tools=[],
            surfaces=["Voice sessions (routing layer)"],
        )
    )

    # v2 specialists + House Manager
    for name, cls in _v2_agent_classes().items():
        display, desc = _DESCRIPTIONS.get(name, (name.replace("_", " ").title(), ""))
        if name == "house_manager":
            kind, surfaces = "custodian", ["Talk with Little Gerry (voice)"]
        else:
            kind, surfaces = "specialist", ["Voice sessions (via supervisor or delegation)"]
        agents.append(
            AgentInfo(
                name=name,
                display_name=display,
                kind=kind,
                description=desc,
                tools=sorted(getattr(cls, "TOOLS", [])),
                surfaces=surfaces,
            )
        )

    # v1 legacy executor — still serves all typed chat
    from services.agent.tools import TOOL_DEFINITIONS

    agents.append(
        AgentInfo(
            name="agent_executor",
            display_name="Little Gerry (chat)",
            kind="legacy",
            description=(
                "The original all-in-one agent that handles every typed chat "
                "conversation, with access to the full tool registry."
            ),
            tools=sorted(t["function"]["name"] for t in TOOL_DEFINITIONS),
            surfaces=["Text chat", "Chat sidebar", "Scheduled tasks", "Daily Assistant"],
        )
    )

    provider, model = await resolve_task_llm(db, task="chat")
    return AgentRosterResponse(agents=agents, chat_model=model, chat_provider=provider)
