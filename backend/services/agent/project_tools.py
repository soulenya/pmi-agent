"""Agent tools for project scheduling and the project canvas.

These sit beside the HTTP routes rather than calling them: a tool runs inside
the agent's own session with no request to authenticate. The access rules are
the same ones the routes use (``services.projects.access``), applied here by
hand, so a tool can never reach a project the user cannot open.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.canvas import CanvasEdge, CanvasNode, ProjectCanvas
from models.db.task import Project, Task, TaskDependency
from services.projects import schedule as sched
from services.projects.access import resolve_role, role_at_least

# A node the model places has no pointer to aim at, so it lands in a tidy grid
# near the origin rather than on top of whatever is already there.
_GRID_X = 240
_GRID_Y = 150
_GRID_COLS = 5


async def _resolve_project(
    db: AsyncSession, user_id: uuid.UUID, text: str, minimum: str
) -> tuple[Project | None, str]:
    """Find a project by id or name and check the user's role.

    Returns ``(project, "")`` on success or ``(None, message)`` with a string
    the model can read back to the user.
    """
    text = str(text or "").strip()
    if not text:
        return None, "Error: name the project."

    project: Project | None = None
    try:
        project = (
            await db.execute(select(Project).where(Project.id == uuid.UUID(text)))
        ).scalar_one_or_none()
    except ValueError:
        matches = (
            (
                await db.execute(
                    select(Project).where(
                        Project.name.ilike(f"%{text}%"),
                        Project.is_archived == False,  # noqa: E712
                    )
                )
            )
            .scalars()
            .all()
        )
        visible = [
            p for p in matches if await resolve_role(db, p, user_id) is not None
        ]
        if len(visible) > 1:
            names = ", ".join(f'"{p.name}"' for p in visible[:5])
            return None, f"Error: more than one project matches '{text}': {names}."
        project = visible[0] if visible else None

    if project is None:
        return None, f"Error: no project called '{text}'."

    role = await resolve_role(db, project, user_id)
    if role is None:
        return None, f"Error: no project called '{text}'."
    if not role_at_least(role, minimum):
        return None, (
            f"Error: you have {role} access to \"{project.name}\"; "
            f"this needs {minimum}."
        )
    return project, ""


async def _resolve_task(
    db: AsyncSession, user_id: uuid.UUID, text: str
) -> tuple[Task | None, str]:
    """Find a task by id or title, limited to tasks the user can act on."""
    text = str(text or "").strip()
    if not text:
        return None, "Error: name the task."

    task: Task | None = None
    try:
        task = (
            await db.execute(select(Task).where(Task.id == uuid.UUID(text)))
        ).scalar_one_or_none()
    except ValueError:
        matches = (
            (await db.execute(select(Task).where(Task.title.ilike(f"%{text}%"))))
            .scalars()
            .all()
        )
        visible = [t for t in matches if await _may_touch(db, t, user_id)]
        if len(visible) > 1:
            titles = ", ".join(f'"{t.title}"' for t in visible[:5])
            return None, f"Error: more than one task matches '{text}': {titles}."
        task = visible[0] if visible else None

    if task is None or not await _may_touch(db, task, user_id):
        return None, f"Error: no task called '{text}'."
    return task, ""


async def _may_touch(db: AsyncSession, task: Task, user_id: uuid.UUID) -> bool:
    if task.created_by == user_id or task.assignee_id == user_id:
        return True
    if task.project_id is None:
        return False
    project = (
        await db.execute(select(Project).where(Project.id == task.project_id))
    ).scalar_one_or_none()
    return project is not None and await resolve_role(db, project, user_id) is not None


def _parse_day(raw: Any) -> tuple[datetime | None, str]:
    if raw in (None, ""):
        return None, ""
    try:
        parsed = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return None, f"Error: '{raw}' is not a date I can read. Use YYYY-MM-DD."
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed, ""


async def _project_schedule_inputs(
    db: AsyncSession, project_id: uuid.UUID
) -> tuple[list[Task], list[sched.TaskIn], list[sched.DependencyIn]]:
    tasks = list(
        (
            await db.execute(
                select(Task)
                .where(Task.project_id == project_id)
                .order_by(Task.sort_order, Task.created_at)
            )
        )
        .scalars()
        .all()
    )
    ids = {t.id for t in tasks}
    deps: list[TaskDependency] = []
    if ids:
        deps = [
            d
            for d in (
                await db.execute(
                    select(TaskDependency).where(TaskDependency.successor_id.in_(ids))
                )
            )
            .scalars()
            .all()
            if d.predecessor_id in ids
        ]

    def as_date(value: datetime | None) -> date | None:
        return value.date() if value is not None else None

    task_in = [
        sched.TaskIn(
            id=t.id,
            start_date=as_date(t.start_date),
            end_date=as_date(t.end_date),
            due_date=as_date(t.due_date),
            is_milestone=t.is_milestone,
            progress_pct=t.progress_pct,
        )
        for t in tasks
    ]
    dep_in = [
        sched.DependencyIn(
            predecessor_id=d.predecessor_id,
            successor_id=d.successor_id,
            kind=d.kind,
            lag_days=d.lag_days,
        )
        for d in deps
    ]
    return tasks, task_in, dep_in


# ── tools ─────────────────────────────────────────────────────────────────────

async def execute_get_project_timeline(ctx: Any, args: dict[str, Any]) -> str:
    project, problem = await _resolve_project(
        ctx.db, ctx.user_id, args.get("project", ""), "viewer"
    )
    if project is None:
        return problem

    tasks, task_in, dep_in = await _project_schedule_inputs(ctx.db, project.id)
    if not tasks:
        return f'"{project.name}" has no tasks yet, so there is no timeline to show.'
    try:
        computed = sched.schedule(
            task_in, dep_in, today=datetime.now(timezone.utc).date()
        )
    except sched.CycleError:
        return (
            f'The tasks in "{project.name}" wait on each other in a loop, so no '
            "schedule can be worked out. Remove one of the dependencies."
        )

    by_id = {t.id: t for t in tasks}
    lines = [f'Timeline for "{project.name}" ({len(tasks)} tasks):']
    for item in computed.values():
        task = by_id[item.id]
        flags = []
        if task.is_milestone:
            flags.append("milestone")
        if item.is_critical:
            flags.append("critical path")
        if item.is_late:
            flags.append("LATE")
        suffix = f" [{', '.join(flags)}]" if flags else ""
        lines.append(
            f"- {task.title}: {item.early_start} to {item.early_finish}, "
            f"{item.slack_days}d slack, {task.progress_pct}% done{suffix}"
        )
    if dep_in:
        count = len(dep_in)
        lines.append(
            f"{count} dependency between them."
            if count == 1
            else f"{count} dependencies between them."
        )
    return "\n".join(lines)


async def execute_set_task_schedule(ctx: Any, args: dict[str, Any]) -> str:
    task, problem = await _resolve_task(ctx.db, ctx.user_id, args.get("task", ""))
    if task is None:
        return problem

    changes: list[str] = []

    start, err = _parse_day(args.get("start_date"))
    if err:
        return err
    end, err = _parse_day(args.get("end_date"))
    if err:
        return err

    new_start = start if start is not None else task.start_date
    new_end = end if end is not None else task.end_date
    if new_start and new_end and new_end < new_start:
        return "Error: the end date falls before the start date."

    if start is not None:
        task.start_date = start
        changes.append(f"starts {start.date()}")
    if end is not None:
        task.end_date = end
        changes.append(f"ends {end.date()}")

    if (raw := args.get("progress_pct")) is not None:
        try:
            pct = int(raw)
        except (TypeError, ValueError):
            return f"Error: '{raw}' is not a percentage."
        if not 0 <= pct <= 100:
            return "Error: progress must be between 0 and 100."
        task.progress_pct = pct
        changes.append(f"{pct}% done")

    if (raw := args.get("is_milestone")) is not None:
        task.is_milestone = bool(raw)
        changes.append("marked a milestone" if raw else "no longer a milestone")

    if not changes:
        return "Error: nothing to change. Give a start date, end date, progress or milestone flag."

    await ctx.db.flush()
    return f'Task "{task.title}" updated: {", ".join(changes)}.'


async def execute_add_task_dependency(ctx: Any, args: dict[str, Any]) -> str:
    successor, problem = await _resolve_task(ctx.db, ctx.user_id, args.get("task", ""))
    if successor is None:
        return problem
    predecessor, problem = await _resolve_task(
        ctx.db, ctx.user_id, args.get("depends_on", "")
    )
    if predecessor is None:
        return problem
    if predecessor.id == successor.id:
        return "Error: a task cannot wait on itself."
    if successor.project_id is None or successor.project_id != predecessor.project_id:
        return "Error: both tasks must be in the same project to depend on each other."

    _, _, dep_in = await _project_schedule_inputs(ctx.db, successor.project_id)
    if any(
        d.predecessor_id == predecessor.id and d.successor_id == successor.id
        for d in dep_in
    ):
        return f'"{successor.title}" already waits on "{predecessor.title}".'
    if sched.would_create_cycle(dep_in, predecessor.id, successor.id):
        return (
            "Error: that would make the tasks wait on each other in a loop. "
            "Nothing was changed."
        )

    kind = str(args.get("kind", "FS")).upper()
    if kind not in sched.DEPENDENCY_KINDS:
        kind = "FS"
    try:
        lag = int(args.get("lag_days") or 0)
    except (TypeError, ValueError):
        lag = 0

    ctx.db.add(
        TaskDependency(
            id=uuid.uuid4(),
            predecessor_id=predecessor.id,
            successor_id=successor.id,
            kind=kind,
            lag_days=lag,
            created_by=ctx.user_id,
        )
    )
    await ctx.db.flush()
    return f'"{successor.title}" now waits on "{predecessor.title}" ({kind}, {lag}d lag).'


async def _default_canvas(
    db: AsyncSession, project: Project, user_id: uuid.UUID
) -> ProjectCanvas:
    canvas = (
        await db.execute(
            select(ProjectCanvas)
            .where(ProjectCanvas.project_id == project.id)
            .order_by(ProjectCanvas.created_at)
            .limit(1)
        )
    ).scalar_one_or_none()
    if canvas is None:
        canvas = ProjectCanvas(
            project_id=project.id,
            name="Canvas",
            viewport={"x": 0, "y": 0, "zoom": 1},
            created_by=user_id,
        )
        db.add(canvas)
        await db.flush()
        await db.refresh(canvas)
    return canvas


async def execute_create_canvas_node(ctx: Any, args: dict[str, Any]) -> str:
    project, problem = await _resolve_project(
        ctx.db, ctx.user_id, args.get("project", ""), "editor"
    )
    if project is None:
        return problem

    kind = str(args.get("kind", "sticky")).lower()
    if kind not in ("sticky", "text", "frame", "shape"):
        return (
            "Error: this tool makes sticky, text, frame and shape notes. "
            "Images, ink and links to other records are placed by hand."
        )
    label = str(args.get("label", "")).strip()[:200]
    content = args.get("content")
    if not label and not content:
        return "Error: give the note a label or some content."

    canvas = await _default_canvas(ctx.db, project, ctx.user_id)
    placed = (
        await ctx.db.execute(
            select(CanvasNode.id).where(CanvasNode.canvas_id == canvas.id)
        )
    ).scalars().all()
    index = len(placed)

    node = CanvasNode(
        canvas_id=canvas.id,
        kind=kind,
        label=label or None,
        content=str(content) if content is not None else None,
        x=40 + (index % _GRID_COLS) * _GRID_X,
        y=40 + (index // _GRID_COLS) * _GRID_Y,
        width=200 if kind in ("sticky", "text") else 320,
        height=140 if kind in ("sticky", "text") else 200,
        z=index,
        created_by=ctx.user_id,
    )
    ctx.db.add(node)
    await ctx.db.flush()
    await ctx.db.refresh(node)
    return (
        f'Added a {kind} to the canvas for "{project.name}": '
        f'"{label or (str(content)[:60])}" [id={node.id}]'
    )


async def execute_link_canvas_nodes(ctx: Any, args: dict[str, Any]) -> str:
    project, problem = await _resolve_project(
        ctx.db, ctx.user_id, args.get("project", ""), "editor"
    )
    if project is None:
        return problem

    canvas = await _default_canvas(ctx.db, project, ctx.user_id)
    nodes = list(
        (
            await ctx.db.execute(
                select(CanvasNode).where(CanvasNode.canvas_id == canvas.id)
            )
        )
        .scalars()
        .all()
    )

    def find(text: str) -> tuple[CanvasNode | None, str]:
        text = str(text or "").strip()
        if not text:
            return None, "Error: name both ends of the link."
        try:
            wanted = uuid.UUID(text)
        except ValueError:
            hits = [
                n
                for n in nodes
                if (n.label or "").lower() == text.lower()
                or text.lower() in (n.label or "").lower()
            ]
            if len(hits) > 1:
                return None, f"Error: more than one note on the canvas matches '{text}'."
            return (hits[0], "") if hits else (None, f"Error: no note called '{text}'.")
        found = next((n for n in nodes if n.id == wanted), None)
        return (found, "") if found else (None, f"Error: no note with id {text}.")

    source, problem = find(args.get("from_node", ""))
    if source is None:
        return problem
    target, problem = find(args.get("to_node", ""))
    if target is None:
        return problem
    if source.id == target.id:
        return "Error: a note cannot link to itself."
    if source.kind == "task" and target.kind == "task":
        return (
            "Error: linking two task cards changes the schedule. "
            "Use add_task_dependency instead so the loop check runs."
        )

    existing = (
        await ctx.db.execute(
            select(CanvasEdge).where(
                CanvasEdge.canvas_id == canvas.id,
                CanvasEdge.source_node_id == source.id,
                CanvasEdge.target_node_id == target.id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return "Those two notes are already linked."

    ctx.db.add(
        CanvasEdge(
            canvas_id=canvas.id,
            source_node_id=source.id,
            target_node_id=target.id,
            kind="link",
            label=str(args.get("label") or "").strip()[:200] or None,
            created_by=ctx.user_id,
        )
    )
    await ctx.db.flush()
    src = source.label or source.kind
    dst = target.label or target.kind
    return f'Linked "{src}" to "{dst}" on the canvas for "{project.name}".'


TOOL_DEFINITIONS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "get_project_timeline",
            "description": (
                "Read a project's schedule: every task's worked-out start and finish, "
                "how much slack it has, which tasks are on the critical path and which "
                "are running late. Use when asked when something will finish, what is "
                "holding a project up, or what is late."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "project": {
                        "type": "string",
                        "description": "Project name or id.",
                    },
                },
                "required": ["project"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_task_schedule",
            "description": (
                "Set when a task starts and finishes, how far along it is, or mark it "
                "a milestone. This drives the project timeline. The due date is a "
                "separate thing and is not changed here."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "task": {"type": "string", "description": "Task title or id."},
                    "start_date": {
                        "type": "string",
                        "description": "ISO date the work starts, e.g. '2026-06-01'.",
                    },
                    "end_date": {
                        "type": "string",
                        "description": "ISO date the work finishes.",
                    },
                    "progress_pct": {
                        "type": "integer",
                        "description": "How complete the task is, 0 to 100.",
                    },
                    "is_milestone": {
                        "type": "boolean",
                        "description": "True to show the task as a milestone diamond.",
                    },
                },
                "required": ["task"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "add_task_dependency",
            "description": (
                "Make one task wait on another so the timeline reschedules around it. "
                "Both tasks must be in the same project. A link that would make tasks "
                "wait on each other in a loop is refused."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "task": {
                        "type": "string",
                        "description": "The task that waits (the successor).",
                    },
                    "depends_on": {
                        "type": "string",
                        "description": "The task it waits on (the predecessor).",
                    },
                    "kind": {
                        "type": "string",
                        "enum": ["FS", "SS", "FF", "SF"],
                        "description": "Finish-to-start by default.",
                        "default": "FS",
                    },
                    "lag_days": {
                        "type": "integer",
                        "description": "Days of delay after the predecessor, default 0.",
                    },
                },
                "required": ["task", "depends_on"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_canvas_node",
            "description": (
                "Put a note on a project's canvas — the shared whiteboard. Use when "
                "asked to sketch out, lay out or capture ideas on the board. Makes the "
                "canvas if the project has none yet."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "project": {"type": "string", "description": "Project name or id."},
                    "kind": {
                        "type": "string",
                        "enum": ["sticky", "text", "frame", "shape"],
                        "description": "What sort of note. Sticky by default.",
                        "default": "sticky",
                    },
                    "label": {"type": "string", "description": "Short heading."},
                    "content": {"type": "string", "description": "Body text."},
                },
                "required": ["project", "label"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "link_canvas_nodes",
            "description": (
                "Draw an arrow between two notes already on a project's canvas. "
                "To make one task wait on another, use add_task_dependency instead."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "project": {"type": "string", "description": "Project name or id."},
                    "from_node": {
                        "type": "string",
                        "description": "Label or id of the note the arrow leaves.",
                    },
                    "to_node": {
                        "type": "string",
                        "description": "Label or id of the note the arrow points at.",
                    },
                    "label": {"type": "string", "description": "Optional arrow caption."},
                },
                "required": ["project", "from_node", "to_node"],
            },
        },
    },
]

TOOL_EXECUTORS = {
    "get_project_timeline": execute_get_project_timeline,
    "set_task_schedule": execute_set_task_schedule,
    "add_task_dependency": execute_add_task_dependency,
    "create_canvas_node": execute_create_canvas_node,
    "link_canvas_nodes": execute_link_canvas_nodes,
}

PRIMARY_ARGS = {
    "get_project_timeline": "project",
    "set_task_schedule": "task",
    "add_task_dependency": "task",
    "create_canvas_node": "label",
    "link_canvas_nodes": "from_node",
}

RUNNING_LABELS = {
    "get_project_timeline": "Working out the timeline…",
    "set_task_schedule": "Scheduling the task…",
    "add_task_dependency": "Linking the tasks…",
    "create_canvas_node": "Adding to the canvas…",
    "link_canvas_nodes": "Drawing the link…",
}

TOOL_DOCS = {
    "get_project_timeline": (
        "Read a project's computed schedule: per-task start/finish, slack, critical "
        "path and late flags. JSON: {\"project\": str (name or id)}."
    ),
    "set_task_schedule": (
        "Set a task's start_date, end_date, progress_pct (0-100) or is_milestone. "
        "Drives the Gantt timeline; does not touch due_date. Auto-approved."
    ),
    "add_task_dependency": (
        "Make one task wait on another in the same project. JSON: {\"task\": str, "
        "\"depends_on\": str, \"kind\": FS|SS|FF|SF, \"lag_days\": int}. Loops are refused."
    ),
    "create_canvas_node": (
        "Add a sticky, text, frame or shape note to a project's canvas (whiteboard). "
        "Creates the canvas on first use. Auto-approved."
    ),
    "link_canvas_nodes": (
        "Draw an arrow between two existing canvas notes, found by label or id. "
        "Use add_task_dependency for task-to-task scheduling links."
    ),
}

__all__ = [
    "PRIMARY_ARGS",
    "RUNNING_LABELS",
    "TOOL_DEFINITIONS",
    "TOOL_DOCS",
    "TOOL_EXECUTORS",
]
