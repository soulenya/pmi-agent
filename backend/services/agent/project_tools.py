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
from services.projects.access import resolve_role, role_at_least, visible_project_ids

# A node the model places has no pointer to aim at, so it lands in a tidy grid
# near the origin rather than on top of whatever is already there.
_GRID_X = 240
_GRID_Y = 150
_GRID_COLS = 5


async def hub_projects(db: AsyncSession, user_id: uuid.UUID) -> list[dict[str, Any]]:
    """Shared projects, read from the hub. Empty if there is no hub to ask.

    A project someone shared with the firm lives only on the hub, so a tool
    that reads the local database alone will honestly report that it does not
    exist — which is what used to happen, and read as Gerry being broken.
    """
    from services.hub import client as hub

    if not hub.configured():
        return []
    try:
        resp = await hub.request(db, user_id, "GET", "/projects")
    except hub.HubError:
        return []
    if resp.status_code != 200:
        return []
    payload = resp.json()
    return payload if isinstance(payload, list) else []


async def find_hub_project(
    db: AsyncSession, user_id: uuid.UUID, text: str
) -> dict[str, Any] | None:
    """One shared project matching a name or id, or None. Ambiguity is None."""
    text = str(text or "").strip()
    if not text:
        return None
    projects = await hub_projects(db, user_id)
    for item in projects:
        if str(item.get("id")) == text:
            return item
    lowered = text.lower()
    exact = [p for p in projects if str(p.get("name", "")).lower() == lowered]
    if len(exact) == 1:
        return exact[0]
    near = [p for p in projects if lowered in str(p.get("name", "")).lower()]
    return near[0] if len(near) == 1 else None


async def resolve_project_anywhere(
    db: AsyncSession, user_id: uuid.UUID, text: str, minimum: str
) -> tuple[Project | None, dict[str, Any] | None, str]:
    """A project by name or id, whether it lives here or on the hub.

    Returns ``(local, shared, "")`` with exactly one of the first two set, or
    ``(None, None, message)``. Tools that only read the local database report a
    shared project as missing even though ``list_projects`` just named it.
    """
    project, problem = await _resolve_project(db, user_id, text, minimum)
    if project is not None:
        return project, None, ""
    shared = await find_hub_project(db, user_id, text)
    if shared is not None:
        return None, shared, ""
    return None, None, problem


async def _hub_get(
    db: AsyncSession, user_id: uuid.UUID, path: str
) -> tuple[Any, str]:
    """Read a path from the hub. Returns ``(payload, "")`` or ``(None, error)``."""
    from services.hub import client as hub

    if not hub.configured():
        return None, "Error: this computer is not connected to the hub."
    try:
        resp = await hub.request(db, user_id, "GET", path)
    except hub.HubError as exc:
        return None, f"Error: could not reach the hub: {exc}"
    if resp.status_code != 200:
        return None, f"Error: the hub refused that request ({resp.status_code})."
    return resp.json(), ""


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


async def _hub_find_task(
    ctx: Any, shared: dict[str, Any], text: str
) -> tuple[dict[str, Any] | None, str]:
    """One task inside a shared project, by id or by title."""
    text = str(text or "").strip()
    if not text:
        return None, "Error: name the task."
    payload, problem = await _hub_get(
        ctx.db, ctx.user_id, f"/tasks?project_id={shared.get('id')}"
    )
    if payload is None:
        return None, problem
    rows = payload if isinstance(payload, list) else payload.get("items") or []
    for row in rows:
        if str(row.get("id")) == text:
            return row, ""
    lowered = text.lower()
    exact = [r for r in rows if str(r.get("title", "")).lower() == lowered]
    near = exact or [r for r in rows if lowered in str(r.get("title", "")).lower()]
    if len(near) > 1:
        titles = ", ".join(f'"{r.get("title")}"' for r in near[:5])
        return None, f"Error: more than one task matches '{text}': {titles}."
    if not near:
        return None, f"Error: \"{shared.get('name')}\" has no task called '{text}'."
    return near[0], ""


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

async def execute_list_projects(ctx: Any, args: dict[str, Any]) -> str:
    """Name every project this person can open, here and on the hub."""
    wanted = str(args.get("query") or "").strip().lower()
    include_archived = bool(args.get("include_archived"))

    ids = await visible_project_ids(ctx.db, ctx.user_id)
    local: list[Project] = []
    if ids:
        rows = (
            await ctx.db.execute(select(Project).where(Project.id.in_(ids)))
        ).scalars().all()
        local = [p for p in rows if include_archived or not p.is_archived]

    lines: list[str] = []
    for project in sorted(local, key=lambda p: p.name.lower()):
        if wanted and wanted not in project.name.lower():
            continue
        lines.append(_project_line("on this computer", project.name, project.id, project.status, project.goal, project.is_archived))

    seen = {p.id for p in local}
    for item in await hub_projects(ctx.db, ctx.user_id):
        try:
            pid = uuid.UUID(str(item.get("id")))
        except (TypeError, ValueError):
            continue
        if pid in seen:
            continue
        if not include_archived and item.get("is_archived"):
            continue
        name = str(item.get("name") or "")
        if wanted and wanted not in name.lower():
            continue
        lines.append(
            _project_line(
                "shared, on the hub",
                name,
                pid,
                str(item.get("status") or ""),
                str(item.get("goal") or ""),
                bool(item.get("is_archived")),
            )
        )

    if not lines:
        if wanted:
            return f"No project matches '{args.get('query')}'."
        return "There are no projects yet."
    return "\n".join(sorted(lines))


def _project_line(
    where: str,
    name: str,
    project_id: uuid.UUID,
    status: str,
    goal: str,
    archived: bool,
) -> str:
    parts = [f'"{name}" ({where}) — id {project_id}']
    if status:
        parts.append(f"status {status}")
    if archived:
        parts.append("archived")
    if goal:
        parts.append(f"goal: {goal[:160]}")
    return ", ".join(parts)


async def execute_get_project_timeline(ctx: Any, args: dict[str, Any]) -> str:
    project, shared, problem = await resolve_project_anywhere(
        ctx.db, ctx.user_id, args.get("project", ""), "viewer"
    )
    if shared is not None:
        return await _hub_timeline(ctx, shared)
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


async def _hub_timeline(ctx: Any, shared: dict[str, Any]) -> str:
    """The same timeline for a project that lives on the hub, computed there."""
    name = shared.get("name")
    payload, problem = await _hub_get(
        ctx.db, ctx.user_id, f"/projects/{shared.get('id')}/timeline"
    )
    if payload is None:
        return problem
    tasks = {str(t.get("id")): t for t in payload.get("tasks") or []}
    if not tasks:
        return f'"{name}" is shared on the hub and has no tasks yet, so there is no timeline to show.'

    lines = [f'Timeline for the shared project "{name}" ({len(tasks)} tasks):']
    for item in payload.get("schedule") or []:
        task = tasks.get(str(item.get("task_id")))
        if task is None:
            continue
        flags = []
        if task.get("is_milestone"):
            flags.append("milestone")
        if item.get("is_critical"):
            flags.append("critical path")
        if item.get("is_late"):
            flags.append("LATE")
        if item.get("blocked_by_gate"):
            flags.append("held by a gate")
        suffix = f" [{', '.join(flags)}]" if flags else ""
        lines.append(
            f"- {task.get('title')}: {item.get('early_start')} to "
            f"{item.get('early_finish')}, {item.get('slack_days')}d slack, "
            f"{task.get('progress_pct', 0)}% done{suffix}"
        )
    count = len(payload.get("dependencies") or [])
    if count:
        lines.append(
            "1 dependency between them."
            if count == 1
            else f"{count} dependencies between them."
        )
    return "\n".join(lines)


async def execute_set_task_schedule(ctx: Any, args: dict[str, Any]) -> str:
    task, problem = await _resolve_task(ctx.db, ctx.user_id, args.get("task", ""))
    if task is None:
        # A task in a shared project is not in this database at all, so a named
        # project is the only way to reach it.
        if args.get("project"):
            _, shared, where = await resolve_project_anywhere(
                ctx.db, ctx.user_id, args["project"], "editor"
            )
            if shared is not None:
                return await _hub_set_schedule(ctx, shared, args)
            if where:
                return where
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


async def _hub_set_schedule(ctx: Any, shared: dict[str, Any], args: dict[str, Any]) -> str:
    """The same change, applied to a task that lives on the hub."""
    from services.hub import client as hub

    row, problem = await _hub_find_task(ctx, shared, args.get("task", ""))
    if row is None:
        return problem

    body: dict[str, Any] = {}
    changes: list[str] = []

    start, err = _parse_day(args.get("start_date"))
    if err:
        return err
    end, err = _parse_day(args.get("end_date"))
    if err:
        return err

    def _existing(field: str) -> datetime | None:
        parsed, _ = _parse_day(row.get(field))
        return parsed

    new_start = start if start is not None else _existing("start_date")
    new_end = end if end is not None else _existing("end_date")
    if new_start and new_end and new_end < new_start:
        return "Error: the end date falls before the start date."

    if start is not None:
        body["start_date"] = start.isoformat()
        changes.append(f"starts {start.date()}")
    if end is not None:
        body["end_date"] = end.isoformat()
        changes.append(f"ends {end.date()}")

    if (raw := args.get("progress_pct")) is not None:
        try:
            pct = int(raw)
        except (TypeError, ValueError):
            return f"Error: '{raw}' is not a percentage."
        if not 0 <= pct <= 100:
            return "Error: progress must be between 0 and 100."
        body["progress_pct"] = pct
        changes.append(f"{pct}% done")

    if (raw := args.get("is_milestone")) is not None:
        body["is_milestone"] = bool(raw)
        changes.append("marked a milestone" if raw else "no longer a milestone")

    if not changes:
        return "Error: nothing to change. Give a start date, end date, progress or milestone flag."

    try:
        resp = await hub.request(
            ctx.db, ctx.user_id, "PATCH", f"/tasks/{row.get('id')}", json_body=body
        )
    except hub.HubError as exc:
        return f"Error: could not reach the hub: {exc}"
    if resp.status_code >= 400:
        return f"Error: the hub refused that change ({resp.status_code})."
    return (
        f'Task "{row.get("title")}" in the shared project "{shared.get("name")}" '
        f'updated: {", ".join(changes)}.'
    )


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


_STATUSES = ("backlog", "todo", "in_progress", "in_review", "done", "cancelled")
_PRIORITIES = ("low", "medium", "high", "critical")
_MAX_BATCH = 100


def _batch_row(raw: Any, index: int) -> tuple[dict[str, Any] | None, str]:
    """One entry of a create_tasks batch, cleaned, or an error naming its place."""
    where = f"task {index + 1}"
    if isinstance(raw, str):
        raw = {"title": raw}
    if not isinstance(raw, dict):
        return None, f"Error: {where} is not a task. Give a title, or an object with one."
    title = str(raw.get("title") or "").strip()[:500]
    if not title:
        return None, f"Error: {where} has no title."

    status = str(raw.get("status") or "todo").lower()
    if status not in _STATUSES:
        return None, f"Error: {where} has status '{status}'. Use one of {', '.join(_STATUSES)}."
    priority = str(raw.get("priority") or "medium").lower()
    if priority not in _PRIORITIES:
        return None, f"Error: {where} has priority '{priority}'. Use one of {', '.join(_PRIORITIES)}."

    dates: dict[str, datetime | None] = {}
    for field in ("due_date", "start_date", "end_date"):
        value, err = _parse_day(raw.get(field))
        if err:
            return None, f"Error: {where}'s {field.replace('_', ' ')} — {err[7:]}"
        dates[field] = value
    if dates["start_date"] and dates["end_date"] and dates["end_date"] < dates["start_date"]:
        return None, f"Error: {where} ends before it starts."

    return {
        "title": title,
        "description": (str(raw["description"]) if raw.get("description") else None),
        "status": status,
        "priority": priority,
        "is_milestone": bool(raw.get("is_milestone")),
        "parent": str(raw.get("parent") or "").strip(),
        **dates,
    }, ""


async def execute_create_tasks(ctx: Any, args: dict[str, Any]) -> str:
    """Write a whole list of tasks into one project in a single pass."""
    raw_rows = args.get("tasks")
    if isinstance(raw_rows, str):
        # Some models hand back a JSON string, or one task per line.
        import json

        try:
            raw_rows = json.loads(raw_rows)
        except ValueError:
            raw_rows = [line.strip("-• \t") for line in raw_rows.splitlines() if line.strip()]
    if not isinstance(raw_rows, list) or not raw_rows:
        return "Error: give a 'tasks' list with at least one task in it."
    if len(raw_rows) > _MAX_BATCH:
        return (
            f"Error: {len(raw_rows)} tasks at once is too many. Send at most "
            f"{_MAX_BATCH} per call and make a second call for the rest."
        )

    rows: list[dict[str, Any]] = []
    for index, raw in enumerate(raw_rows):
        row, problem = _batch_row(raw, index)
        if row is None:
            return f"{problem} Nothing was created."
        rows.append(row)

    project, shared, problem = await resolve_project_anywhere(
        ctx.db, ctx.user_id, args.get("project", ""), "editor"
    )
    if shared is not None:
        return await _create_tasks_on_hub(ctx, shared, rows)
    if project is None:
        return problem

    made: dict[str, uuid.UUID] = {}
    created: list[Task] = []
    for row in rows:
        parent_id: uuid.UUID | None = None
        if row["parent"]:
            parent_id = made.get(row["parent"].lower())
            if parent_id is None:
                found, _ = await _resolve_task(ctx.db, ctx.user_id, row["parent"])
                if found is None or found.project_id != project.id:
                    return (
                        f"Error: \"{row['title']}\" says it sits under "
                        f"\"{row['parent']}\", but there is no such task in "
                        f'"{project.name}". Nothing was created — list the parent '
                        "earlier in the same batch, or check the title."
                    )
                parent_id = found.id
        task = Task(
            title=row["title"],
            description=row["description"],
            status=row["status"],
            priority=row["priority"],
            due_date=row["due_date"],
            start_date=row["start_date"],
            end_date=row["end_date"],
            is_milestone=row["is_milestone"],
            parent_task_id=parent_id,
            project_id=project.id,
            sort_order=len(created),
            source_conversation_id=getattr(ctx, "conversation_id", None),
            created_by=ctx.user_id,
        )
        ctx.db.add(task)
        await ctx.db.flush()
        made[row["title"].lower()] = task.id
        created.append(task)

    return _batch_report(project.name, [t.title for t in created], rows, "")


def _batch_report(
    name: str, titles: list[str], rows: list[dict[str, Any]], where: str
) -> str:
    subs = sum(1 for r in rows if r["parent"])
    stones = sum(1 for r in rows if r["is_milestone"])
    extras = []
    if subs:
        extras.append(f"{subs} of them sub-tasks")
    if stones:
        extras.append(f"{stones} marked milestones")
    tail = f" ({', '.join(extras)})" if extras else ""
    listed = "\n".join(f"- {t}" for t in titles[:20])
    more = f"\n… and {len(titles) - 20} more." if len(titles) > 20 else ""
    return (
        f'Created {len(titles)} tasks in {where}"{name}"{tail}:\n{listed}{more}'
    )


async def _create_tasks_on_hub(
    ctx: Any, shared: dict[str, Any], rows: list[dict[str, Any]]
) -> str:
    """The same batch, written to the hub where the shared project lives."""
    from services.hub import client as hub

    if not hub.configured():
        return "Error: this computer is not connected to the hub."
    project_id = str(shared.get("id"))
    name = str(shared.get("name"))
    made: dict[str, str] = {}
    titles: list[str] = []
    for row in rows:
        parent_id = made.get(row["parent"].lower()) if row["parent"] else None
        if row["parent"] and parent_id is None:
            return (
                f"Error: \"{row['title']}\" says it sits under \"{row['parent']}\", "
                f'which is not in this batch. {len(titles)} tasks were already '
                f'created in "{name}"; list the parent before its children and '
                "send the rest again."
            )
        body = {
            "title": row["title"],
            "description": row["description"],
            "project_id": project_id,
            "parent_task_id": parent_id,
            "status": row["status"],
            "priority": row["priority"],
            "is_milestone": row["is_milestone"],
            "due_date": row["due_date"].isoformat() if row["due_date"] else None,
            "start_date": row["start_date"].isoformat() if row["start_date"] else None,
            "end_date": row["end_date"].isoformat() if row["end_date"] else None,
        }
        try:
            resp = await hub.request(ctx.db, ctx.user_id, "POST", "/tasks", json_body=body)
        except hub.HubError as exc:
            return (
                f'Error: the hub stopped answering after {len(titles)} of '
                f'{len(rows)} tasks were created in "{name}": {exc}'
            )
        if resp.status_code not in (200, 201):
            return (
                f'Error: the hub refused "{row["title"]}" ({resp.status_code}). '
                f'{len(titles)} of {len(rows)} tasks were created in "{name}" '
                "before it stopped."
            )
        made[row["title"].lower()] = str(resp.json().get("id"))
        titles.append(row["title"])

    return _batch_report(name, titles, rows, "the shared project ")


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
    project, shared, problem = await resolve_project_anywhere(
        ctx.db, ctx.user_id, args.get("project", ""), "editor"
    )
    if project is None and shared is None:
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

    if shared is not None:
        return await _hub_canvas_node(ctx, shared, kind, label, content)

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


async def _hub_default_canvas(
    ctx: Any, shared: dict[str, Any]
) -> tuple[dict[str, Any] | None, str]:
    """The shared project's first canvas, nodes and edges included."""
    payload, problem = await _hub_get(
        ctx.db, ctx.user_id, f"/projects/{shared.get('id')}/canvas/default"
    )
    if payload is None:
        return None, problem
    return payload, ""


async def _hub_canvas_node(
    ctx: Any, shared: dict[str, Any], kind: str, label: str, content: Any
) -> str:
    from services.hub import client as hub

    canvas, problem = await _hub_default_canvas(ctx, shared)
    if canvas is None:
        return problem
    index = len(canvas.get("nodes") or [])
    body = {
        "kind": kind,
        "label": label,
        "content": str(content) if content is not None else "",
        "x": 40 + (index % _GRID_COLS) * _GRID_X,
        "y": 40 + (index // _GRID_COLS) * _GRID_Y,
        "width": 200 if kind in ("sticky", "text") else 320,
        "height": 140 if kind in ("sticky", "text") else 200,
        "z": index,
    }
    try:
        resp = await hub.request(
            ctx.db,
            ctx.user_id,
            "POST",
            f"/projects/{shared.get('id')}/canvas/{canvas.get('id')}/nodes",
            json_body=body,
        )
    except hub.HubError as exc:
        return f"Error: could not reach the hub: {exc}"
    if resp.status_code >= 400:
        return f"Error: the hub refused that note ({resp.status_code})."
    return (
        f'Added a {kind} to the canvas for the shared project "{shared.get("name")}": '
        f'"{label or (str(content)[:60])}" [id={resp.json().get("id")}]'
    )


async def execute_link_canvas_nodes(ctx: Any, args: dict[str, Any]) -> str:
    project, shared, problem = await resolve_project_anywhere(
        ctx.db, ctx.user_id, args.get("project", ""), "editor"
    )
    if project is None and shared is None:
        return problem
    if shared is not None:
        return await _hub_link_canvas(ctx, shared, args)

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


def _find_hub_node(
    nodes: list[dict[str, Any]], text: str
) -> tuple[dict[str, Any] | None, str]:
    text = str(text or "").strip()
    if not text:
        return None, "Error: name both ends of the link."
    for node in nodes:
        if str(node.get("id")) == text:
            return node, ""
    lowered = text.lower()
    exact = [n for n in nodes if str(n.get("label", "")).lower() == lowered]
    hits = exact or [n for n in nodes if lowered in str(n.get("label", "")).lower()]
    if len(hits) > 1:
        return None, f"Error: more than one note on the canvas matches '{text}'."
    return (hits[0], "") if hits else (None, f"Error: no note called '{text}'.")


async def _hub_link_canvas(ctx: Any, shared: dict[str, Any], args: dict[str, Any]) -> str:
    from services.hub import client as hub

    canvas, problem = await _hub_default_canvas(ctx, shared)
    if canvas is None:
        return problem
    nodes = list(canvas.get("nodes") or [])

    source, problem = _find_hub_node(nodes, args.get("from_node", ""))
    if source is None:
        return problem
    target, problem = _find_hub_node(nodes, args.get("to_node", ""))
    if target is None:
        return problem
    if source.get("id") == target.get("id"):
        return "Error: a note cannot link to itself."
    if source.get("kind") == "task" and target.get("kind") == "task":
        return (
            "Error: linking two task cards changes the schedule. "
            "Use add_task_dependency instead so the loop check runs."
        )
    for edge in canvas.get("edges") or []:
        if str(edge.get("source_node_id")) == str(source.get("id")) and str(
            edge.get("target_node_id")
        ) == str(target.get("id")):
            return "Those two notes are already linked."

    body = {
        "source_node_id": str(source.get("id")),
        "target_node_id": str(target.get("id")),
        "kind": "link",
        "label": str(args.get("label") or "").strip()[:200],
    }
    try:
        resp = await hub.request(
            ctx.db,
            ctx.user_id,
            "POST",
            f"/projects/{shared.get('id')}/canvas/{canvas.get('id')}/edges",
            json_body=body,
        )
    except hub.HubError as exc:
        return f"Error: could not reach the hub: {exc}"
    if resp.status_code >= 400:
        return f"Error: the hub refused that link ({resp.status_code})."
    src = source.get("label") or source.get("kind")
    dst = target.get("label") or target.get("kind")
    return (
        f'Linked "{src}" to "{dst}" on the canvas for the shared project '
        f'"{shared.get("name")}".'
    )


TOOL_DEFINITIONS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "list_projects",
            "description": (
                "Name every project the user can open, both on this computer and "
                "shared on the hub, with their ids. Use this FIRST whenever a "
                "project is mentioned by name and you do not already know its id \u2014 "
                "a shared project exists only on the hub and no other tool will "
                "find it for you."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Optional: only projects whose name contains this.",
                    },
                    "include_archived": {
                        "type": "boolean",
                        "description": "Include archived projects. False by default.",
                        "default": False,
                    },
                },
                "required": [],
            },
        },
    },
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
            "name": "create_tasks",
            "description": (
                "Create MANY tasks in one project in a single call — the line items of "
                "a contract, a list of deliverables, a work breakdown. Always prefer "
                "this over calling create_task repeatedly. Works on shared hub projects "
                "as well as local ones. Give each task a 'parent' naming an earlier task "
                "in the same list to nest it underneath. Nothing is created if any entry "
                "is malformed, so send the whole list at once."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "project": {
                        "type": "string",
                        "description": "Project name or id. Shared hub projects included.",
                    },
                    "tasks": {
                        "type": "array",
                        "description": "The tasks to create, in the order they should appear.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "title": {"type": "string", "description": "Required."},
                                "description": {"type": "string"},
                                "status": {
                                    "type": "string",
                                    "enum": list(_STATUSES),
                                    "default": "todo",
                                },
                                "priority": {
                                    "type": "string",
                                    "enum": list(_PRIORITIES),
                                    "default": "medium",
                                },
                                "due_date": {
                                    "type": "string",
                                    "description": "ISO date, e.g. '2026-06-30'.",
                                },
                                "start_date": {"type": "string", "description": "ISO date."},
                                "end_date": {"type": "string", "description": "ISO date."},
                                "is_milestone": {"type": "boolean"},
                                "parent": {
                                    "type": "string",
                                    "description": (
                                        "Title of the task this one sits under. Must be "
                                        "listed earlier in this same call."
                                    ),
                                },
                            },
                            "required": ["title"],
                        },
                    },
                },
                "required": ["project", "tasks"],
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
                "separate thing and is not changed here. For a task in a shared hub "
                "project, name the project too."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "task": {"type": "string", "description": "Task title or id."},
                    "project": {
                        "type": "string",
                        "description": (
                            "The project holding the task. Required for a shared "
                            "hub project, optional otherwise."
                        ),
                    },
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
    "list_projects": execute_list_projects,
    "get_project_timeline": execute_get_project_timeline,
    "create_tasks": execute_create_tasks,
    "set_task_schedule": execute_set_task_schedule,
    "add_task_dependency": execute_add_task_dependency,
    "create_canvas_node": execute_create_canvas_node,
    "link_canvas_nodes": execute_link_canvas_nodes,
}

PRIMARY_ARGS = {
    "list_projects": "query",
    "get_project_timeline": "project",
    "create_tasks": "tasks",
    "set_task_schedule": "task",
    "add_task_dependency": "task",
    "create_canvas_node": "label",
    "link_canvas_nodes": "from_node",
}

RUNNING_LABELS = {    "list_projects": "Looking through the projects\u2026",    "get_project_timeline": "Working out the timeline…",
    "create_tasks": "Writing the tasks in…",
    "set_task_schedule": "Scheduling the task…",
    "add_task_dependency": "Linking the tasks…",
    "create_canvas_node": "Adding to the canvas…",
    "link_canvas_nodes": "Drawing the link…",
}

TOOL_DOCS = {
    "list_projects": (
        "Every project the user can open, on this computer and shared on the hub, "
        "with ids. Call it before any other project tool when you only have a name. "
        "JSON: {\"query\": str optional, \"include_archived\": bool}."
    ),
    "get_project_timeline": (
        "Read a project's computed schedule: per-task start/finish, slack, critical "
        "path and late flags. Works for shared hub projects too. "
        "JSON: {\"project\": str (name or id)}."
    ),
    "create_tasks": (
        "Create MANY tasks in one project at once — contract line items, deliverables, "
        "a work breakdown. Prefer this over repeated create_task calls. Auto-approved. "
        "JSON: {\"project\": str, \"tasks\": [{\"title\": str, \"description\": str, "
        "\"status\": todo|in_progress|in_review|done|backlog|cancelled, "
        "\"priority\": low|medium|high|critical, \"due_date\": ISO, \"start_date\": ISO, "
        "\"end_date\": ISO, \"is_milestone\": bool, \"parent\": title listed earlier}]}. "
        "Nothing is written if any entry is bad. Shared hub projects included."
    ),
    "set_task_schedule": (
        "Set a task's start_date, end_date, progress_pct (0-100) or is_milestone. "
        "Drives the Gantt timeline; does not touch due_date. Pass \"project\" as well "
        "to reach a task in a shared hub project. Auto-approved."
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
