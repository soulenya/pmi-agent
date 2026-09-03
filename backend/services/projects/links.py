"""Links between projects: precedence, containment and gates.

Two graphs live in one table.

*Precedence* is who waits for whom. ``A depends_on B`` and ``B gates A`` say
the same thing from opposite ends, so both become the edge B -> A and both are
checked against the same loop. *Containment* is ``subproject_of``, its own
graph and its own loop check — a project cannot end up inside itself.
``parallel`` imposes no order at all and can never loop.

A gate is the only link that carries a condition: a milestone in the upstream
project. While that milestone is unfinished the gate is open, and downstream
work scheduled to start before it is flagged. Waiving is deliberate and sticky.

Links also decide how far the agent may read. Visibility says who may open a
project; links say which other projects it may look across, and only ever at
their goal, their milestones and their gate status.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timezone

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.project_link import PRECEDENCE_KINDS, ProjectLink
from models.db.task import Project, Task
from services.projects.access import visible_project_ids

logger = logging.getLogger(__name__)

MAX_LINK_CONTEXT_CHARS = 1_500

# A cancelled milestone does not satisfy a gate — it means the thing the gate
# was waiting for is never going to happen. It is still not upcoming, though.
_SATISFYING_STATUSES = ("done",)
_SETTLED_STATUSES = ("done", "cancelled")

RELATION_PHRASES = {
    "depends_on": "waits for",
    "gates": "gates",
    "parallel": "runs alongside",
    "subproject_of": "is part of",
}


@dataclass(frozen=True)
class LinkIn:
    """The shape the loop checks need. No ORM, so they can be tested alone."""

    from_project_id: uuid.UUID
    to_project_id: uuid.UUID
    kind: str


def _status_of(task: Task) -> str:
    """Rows read back are plain strings; rows just set are TaskStatus members."""
    return str(getattr(task.status, "value", task.status)).lower()


def precedence_edge(
    kind: str, from_id: uuid.UUID, to_id: uuid.UUID
) -> tuple[uuid.UUID, uuid.UUID] | None:
    """The upstream -> downstream edge a link implies, if it implies one."""
    if kind == "depends_on":
        return (to_id, from_id)
    if kind == "gates":
        return (from_id, to_id)
    return None


def _edges(links: list[LinkIn], kind: str) -> list[tuple[uuid.UUID, uuid.UUID]]:
    if kind == "subproject_of":
        return [
            (link.from_project_id, link.to_project_id)
            for link in links
            if link.kind == "subproject_of"
        ]
    out = []
    for link in links:
        edge = precedence_edge(link.kind, link.from_project_id, link.to_project_id)
        if edge is not None:
            out.append(edge)
    return out


def _reaches(
    edges: list[tuple[uuid.UUID, uuid.UUID]], start: uuid.UUID, goal: uuid.UUID
) -> list[uuid.UUID] | None:
    """A path from start to goal, or None. Depth-first; any path will do."""
    onward: dict[uuid.UUID, list[uuid.UUID]] = {}
    for tail, head in edges:
        onward.setdefault(tail, []).append(head)

    stack: list[tuple[uuid.UUID, list[uuid.UUID]]] = [(start, [start])]
    seen: set[uuid.UUID] = set()
    while stack:
        node, path = stack.pop()
        if node == goal:
            return path
        if node in seen:
            continue
        seen.add(node)
        for nxt in onward.get(node, []):
            stack.append((nxt, path + [nxt]))
    return None


def cycle_path(
    links: list[LinkIn], kind: str, from_id: uuid.UUID, to_id: uuid.UUID
) -> list[uuid.UUID] | None:
    """The loop a new link would close, or None if it closes none.

    Returned as a path so the refusal can name the projects involved rather
    than saying "that would loop" and leaving the user to find it.
    """
    if from_id == to_id:
        return [from_id, to_id]
    if kind == "parallel":
        return None
    if kind == "subproject_of":
        edges = _edges(links, "subproject_of")
        tail, head = from_id, to_id
    else:
        edges = _edges(links, "precedence")
        edge = precedence_edge(kind, from_id, to_id)
        if edge is None:
            return None
        tail, head = edge
    back = _reaches(edges, head, tail)
    return back + [head] if back else None


# ── Database side ────────────────────────────────────────────────────────────

async def links_for_project(
    db: AsyncSession, project_id: uuid.UUID
) -> list[ProjectLink]:
    """Every link with this project at either end."""
    rows = (
        await db.execute(
            select(ProjectLink)
            .where(
                or_(
                    ProjectLink.from_project_id == project_id,
                    ProjectLink.to_project_id == project_id,
                )
            )
            .order_by(ProjectLink.created_at)
        )
    ).scalars()
    return list(rows)


async def all_links(db: AsyncSession) -> list[LinkIn]:
    """Every link, flattened for the loop checks."""
    rows = (
        await db.execute(
            select(
                ProjectLink.from_project_id, ProjectLink.to_project_id, ProjectLink.kind
            )
        )
    ).all()
    return [LinkIn(from_project_id=f, to_project_id=t, kind=k) for f, t, k in rows]


async def refresh_gates(
    db: AsyncSession, links: list[ProjectLink]
) -> list[ProjectLink]:
    """Bring gate statuses in line with their milestones. Returns those that closed.

    A milestone that is reopened reopens its gate. Waived stays waived —
    someone decided to proceed without it, and that decision is not the
    scheduler's to reverse.
    """
    gates = [
        link
        for link in links
        if link.kind == "gates" and link.status != "waived" and link.gate_task_id
    ]
    if not gates:
        return []

    task_ids = {link.gate_task_id for link in gates if link.gate_task_id}
    rows = (
        await db.execute(select(Task).where(Task.id.in_(list(task_ids))))
    ).scalars()
    tasks = {t.id: t for t in rows}

    closed: list[ProjectLink] = []
    for link in gates:
        task = tasks.get(link.gate_task_id) if link.gate_task_id else None
        done = task is not None and _status_of(task) in _SATISFYING_STATUSES
        if done and link.status != "satisfied":
            link.status = "satisfied"
            link.satisfied_at = datetime.now(timezone.utc)
            closed.append(link)
        elif not done and link.status == "satisfied":
            link.status = "open"
            link.satisfied_at = None
    return closed


async def gates_into(db: AsyncSession, project_id: uuid.UUID) -> list[ProjectLink]:
    """Gates the given project is waiting on."""
    rows = (
        await db.execute(
            select(ProjectLink).where(
                ProjectLink.to_project_id == project_id, ProjectLink.kind == "gates"
            )
        )
    ).scalars()
    return list(rows)


async def gates_on_task(db: AsyncSession, task_id: uuid.UUID) -> list[ProjectLink]:
    """Gates whose condition is this task."""
    rows = (
        await db.execute(
            select(ProjectLink).where(
                ProjectLink.gate_task_id == task_id, ProjectLink.kind == "gates"
            )
        )
    ).scalars()
    return list(rows)


def gate_date(task: Task | None) -> date | None:
    """When a gate's milestone lands. None when nobody has dated it."""
    if task is None:
        return None
    when = task.end_date or task.due_date or task.start_date
    return when.date() if when is not None else None


async def announce_closed_gates(db: AsyncSession, closed: list[ProjectLink]) -> None:
    """Tell the downstream owner their gate cleared. Never raises."""
    if not closed:
        return
    try:
        from models.db.enums import NotificationType
        from repositories.conversation_repo import NotificationRepository

        rows = (
            await db.execute(
                select(Project).where(
                    Project.id.in_([link.to_project_id for link in closed])
                )
            )
        ).scalars()
        downstream = {p.id: p for p in rows}
        task_ids = [lk.gate_task_id for lk in closed if lk.gate_task_id]
        titles: dict[uuid.UUID, str] = {}
        if task_ids:
            title_rows = (
                await db.execute(select(Task.id, Task.title).where(Task.id.in_(task_ids)))
            ).all()
            titles = {tid: title for tid, title in title_rows}

        repo = NotificationRepository(db)
        for link in closed:
            project = downstream.get(link.to_project_id)
            if project is None:
                continue
            owner = project.owner_id or project.created_by
            if owner is None:
                continue
            milestone = (
                titles.get(link.gate_task_id, "A milestone")
                if link.gate_task_id
                else "A milestone"
            )
            await repo.create(
                user_id=owner,
                type=NotificationType.GATE_CLEARED.value,
                title=f"Gate cleared on {project.name}",
                message=(
                    f'"{milestone}" is done, so {project.name} is no longer '
                    "waiting on it."
                ),
                entity_type="project",
                entity_id=project.id,
            )
    except Exception:  # noqa: BLE001 — a missed notification must not fail the write
        logger.exception("Failed to announce closed gates")


# ── Agent context ────────────────────────────────────────────────────────────

async def build_link_context(
    db: AsyncSession, project_id: uuid.UUID, user_id: uuid.UUID
) -> str:
    """LINKED PROJECTS block for injection, or "" (never raises).

    Deliberately thin: goal, next milestone, gate status. A link is permission
    to see how a neighbour is placed, not permission to read its material.
    """
    try:
        links = await links_for_project(db, project_id)
        if not links:
            return ""
        allowed = set(await visible_project_ids(db, user_id))
        other_ids = {
            link.to_project_id if link.from_project_id == project_id else link.from_project_id
            for link in links
        }
        readable = other_ids & allowed
        if not readable:
            return ""

        rows = (
            await db.execute(select(Project).where(Project.id.in_(list(readable))))
        ).scalars()
        projects = {p.id: p for p in rows}

        await refresh_gates(db, links)

        milestones: dict[uuid.UUID, Task] = {}
        m_rows = (
            await db.execute(
                select(Task)
                .where(
                    Task.project_id.in_(list(readable)),
                    Task.is_milestone.is_(True),
                    Task.status.notin_(_SETTLED_STATUSES),
                )
                .order_by(Task.due_date.asc().nullslast())
            )
        ).scalars()
        for task in m_rows:
            if task.project_id is not None:
                milestones.setdefault(task.project_id, task)

        lines = ["\n\nLINKED PROJECTS:"]
        for link in links:
            outward = link.from_project_id == project_id
            other_id = link.to_project_id if outward else link.from_project_id
            other = projects.get(other_id)
            if other is None:
                continue
            phrase = RELATION_PHRASES.get(link.kind, link.kind)
            sentence = (
                f"this project {phrase} \"{other.name}\""
                if outward
                else f"\"{other.name}\" {phrase} this project"
            )
            detail = ""
            if other.goal.strip():
                detail = f" Goal: {other.goal.strip()[:200].rstrip('.')}."
            milestone = milestones.get(other_id)
            if milestone is not None:
                due = milestone.due_date.strftime("%Y-%m-%d") if milestone.due_date else "undated"
                detail += f" Next milestone: {milestone.title} ({due})."
            if link.kind == "gates":
                detail += f" Gate is {link.status}."
            lines.append(f"- {sentence}.{detail}")

        if len(lines) == 1:
            return ""
        closing = (
            "You may use these projects' goals, milestones and gate status to "
            "reason about this one. You may not read their tasks, documents or "
            "conversations — a link is not access. If the user needs something "
            "from inside a linked project, open that project."
        )
        body = "\n".join(lines)[: MAX_LINK_CONTEXT_CHARS - len(closing) - 2]
        return f"{body}\n{closing}\n"
    except Exception:  # noqa: BLE001 — context must never break a turn
        logger.exception("Failed to build link context for project %s", project_id)
        return ""
