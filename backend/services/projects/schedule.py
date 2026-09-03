"""Critical-path scheduling for a project's tasks.

Pure functions over plain dataclasses: no ORM, no session, no clock. The
router converts rows in and out, which keeps the arithmetic testable and keeps
the graph walk away from lazy-loading.

Dates are whole days. A task that starts and ends on the same day has a
duration of one day, which is what a Gantt bar shows.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import date, timedelta

# Finish-to-start, start-to-start, finish-to-finish, start-to-finish.
DEPENDENCY_KINDS = ("FS", "SS", "FF", "SF")

_DEFAULT_DURATION_DAYS = 1


class CycleError(ValueError):
    """A dependency edge would close a loop. Carries the offending path."""

    def __init__(self, path: list[uuid.UUID]) -> None:
        self.path = path
        super().__init__("These dependencies form a loop.")


@dataclass(frozen=True)
class TaskIn:
    id: uuid.UUID
    start_date: date | None
    end_date: date | None
    due_date: date | None
    is_milestone: bool = False
    progress_pct: int = 0


@dataclass(frozen=True)
class DependencyIn:
    predecessor_id: uuid.UUID
    successor_id: uuid.UUID
    kind: str = "FS"
    lag_days: int = 0


@dataclass(frozen=True)
class GateIn:
    """A milestone in another project that this project is waiting on.

    ``opens_on`` is when that milestone lands. An undated milestone flags
    nothing: a gate with no date cannot say which work starts too early.
    """

    id: uuid.UUID
    opens_on: date | None
    is_open: bool = True


@dataclass
class Scheduled:
    id: uuid.UUID
    early_start: date
    early_finish: date
    late_start: date
    late_finish: date
    slack_days: int
    is_critical: bool
    # True when the computed finish is later than the date the task is due.
    is_late: bool = False
    # The open gate this task is scheduled to start ahead of, if any.
    blocked_by_gate: uuid.UUID | None = None
    predecessors: list[uuid.UUID] = field(default_factory=list)
    successors: list[uuid.UUID] = field(default_factory=list)


def topological_order(
    task_ids: list[uuid.UUID], deps: list[DependencyIn]
) -> list[uuid.UUID]:
    """Kahn's algorithm. Raises CycleError naming one cycle if the graph loops."""
    known = set(task_ids)
    edges = [d for d in deps if d.predecessor_id in known and d.successor_id in known]

    successors: dict[uuid.UUID, list[uuid.UUID]] = {t: [] for t in task_ids}
    indegree: dict[uuid.UUID, int] = {t: 0 for t in task_ids}
    for d in edges:
        successors[d.predecessor_id].append(d.successor_id)
        indegree[d.successor_id] += 1

    queue = [t for t in task_ids if indegree[t] == 0]
    order: list[uuid.UUID] = []
    while queue:
        node = queue.pop(0)
        order.append(node)
        for nxt in successors[node]:
            indegree[nxt] -= 1
            if indegree[nxt] == 0:
                queue.append(nxt)

    if len(order) != len(task_ids):
        remaining = {t for t in task_ids if t not in set(order)}
        raise CycleError(_find_cycle(remaining, successors))
    return order


def _find_cycle(
    remaining: set[uuid.UUID], successors: dict[uuid.UUID, list[uuid.UUID]]
) -> list[uuid.UUID]:
    """Walk the tangled remainder until a node repeats; that slice is the loop."""
    start = next(iter(remaining))
    seen: list[uuid.UUID] = []
    node = start
    while node not in seen:
        seen.append(node)
        onward = [s for s in successors.get(node, []) if s in remaining]
        if not onward:
            break
        node = onward[0]
    if node in seen:
        return seen[seen.index(node):] + [node]
    return seen


def would_create_cycle(
    deps: list[DependencyIn], predecessor_id: uuid.UUID, successor_id: uuid.UUID
) -> bool:
    """True when adding predecessor -> successor closes a loop."""
    if predecessor_id == successor_id:
        return True
    onward: dict[uuid.UUID, list[uuid.UUID]] = {}
    for d in deps:
        onward.setdefault(d.predecessor_id, []).append(d.successor_id)

    stack = [successor_id]
    seen: set[uuid.UUID] = set()
    while stack:
        node = stack.pop()
        if node == predecessor_id:
            return True
        if node in seen:
            continue
        seen.add(node)
        stack.extend(onward.get(node, []))
    return False


def _bounds(task: TaskIn, fallback: date) -> tuple[date, date]:
    """A task's own dates, filling in whatever it is missing."""
    if task.is_milestone:
        day = task.start_date or task.end_date or task.due_date or fallback
        return day, day
    start = task.start_date
    end = task.end_date or task.due_date
    if start and end:
        return start, max(start, end)
    if start:
        return start, start + timedelta(days=_DEFAULT_DURATION_DAYS - 1)
    if end:
        return end - timedelta(days=_DEFAULT_DURATION_DAYS - 1), end
    return fallback, fallback + timedelta(days=_DEFAULT_DURATION_DAYS - 1)


def schedule(
    tasks: list[TaskIn],
    deps: list[DependencyIn],
    *,
    today: date,
    gates: list[GateIn] | None = None,
) -> dict[uuid.UUID, Scheduled]:
    """Forward and backward pass over the dependency graph.

    Returns one Scheduled per task. Raises CycleError if the graph loops, so
    callers can refuse the write rather than render a chart that cannot exist.

    Gates do not move any dates. A gate belongs to another project and its
    milestone may slip or be waived, so it flags work that starts too early
    rather than silently pushing this project's schedule out.
    """
    if not tasks:
        return {}

    by_id = {t.id: t for t in tasks}
    order = topological_order([t.id for t in tasks], deps)
    known = set(by_id)
    edges = [d for d in deps if d.predecessor_id in known and d.successor_id in known]

    incoming: dict[uuid.UUID, list[DependencyIn]] = {t.id: [] for t in tasks}
    outgoing: dict[uuid.UUID, list[DependencyIn]] = {t.id: [] for t in tasks}
    for d in edges:
        incoming[d.successor_id].append(d)
        outgoing[d.predecessor_id].append(d)

    duration: dict[uuid.UUID, int] = {}
    early_start: dict[uuid.UUID, date] = {}
    early_finish: dict[uuid.UUID, date] = {}

    for tid in order:
        task = by_id[tid]
        own_start, own_end = _bounds(task, today)
        duration[tid] = (own_end - own_start).days

        start = own_start
        for d in incoming[tid]:
            lag = timedelta(days=d.lag_days)
            p_start, p_finish = early_start[d.predecessor_id], early_finish[d.predecessor_id]
            if d.kind == "FS":
                candidate = p_finish + timedelta(days=1) + lag
            elif d.kind == "SS":
                candidate = p_start + lag
            elif d.kind == "FF":
                candidate = p_finish + lag - timedelta(days=duration[tid])
            else:  # SF
                candidate = p_start + lag - timedelta(days=duration[tid])
            start = max(start, candidate)

        early_start[tid] = start
        early_finish[tid] = start + timedelta(days=duration[tid])

    project_finish = max(early_finish.values())

    late_finish: dict[uuid.UUID, date] = {}
    late_start: dict[uuid.UUID, date] = {}
    for tid in reversed(order):
        finish = project_finish
        for d in outgoing[tid]:
            lag = timedelta(days=d.lag_days)
            s_start, s_finish = late_start[d.successor_id], late_finish[d.successor_id]
            if d.kind == "FS":
                candidate = s_start - timedelta(days=1) - lag
            elif d.kind == "SS":
                candidate = s_start - lag + timedelta(days=duration[tid])
            elif d.kind == "FF":
                candidate = s_finish - lag
            else:  # SF
                candidate = s_finish - lag + timedelta(days=duration[tid])
            finish = min(finish, candidate)
        late_finish[tid] = finish
        late_start[tid] = finish - timedelta(days=duration[tid])

    blocking = sorted(
        (g for g in (gates or []) if g.is_open and g.opens_on is not None),
        key=lambda g: g.opens_on,  # type: ignore[arg-type,return-value]
    )

    out: dict[uuid.UUID, Scheduled] = {}
    for tid in order:
        slack = (late_finish[tid] - early_finish[tid]).days
        task = by_id[tid]
        # The last gate this task starts ahead of is the one that binds it.
        gate = next(
            (g.id for g in reversed(blocking) if early_start[tid] <= g.opens_on), None
        )
        out[tid] = Scheduled(
            id=tid,
            early_start=early_start[tid],
            early_finish=early_finish[tid],
            late_start=late_start[tid],
            late_finish=late_finish[tid],
            slack_days=slack,
            is_critical=slack <= 0,
            is_late=bool(task.due_date and early_finish[tid] > task.due_date),
            blocked_by_gate=gate,
            predecessors=[d.predecessor_id for d in incoming[tid]],
            successors=[d.successor_id for d in outgoing[tid]],
        )
    return out
