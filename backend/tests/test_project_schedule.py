"""Critical-path arithmetic. No database — the scheduler is a pure function."""

from __future__ import annotations

import uuid
from datetime import date

import pytest

from services.projects.schedule import (
    CycleError,
    DependencyIn,
    TaskIn,
    schedule,
    topological_order,
    would_create_cycle,
)

TODAY = date(2026, 9, 1)


def _task(start: date | None, end: date | None, **kw) -> TaskIn:
    return TaskIn(
        id=uuid.uuid4(),
        start_date=start,
        end_date=end,
        due_date=kw.pop("due", None),
        **kw,
    )


def test_empty_project_schedules_nothing():
    assert schedule([], [], today=TODAY) == {}


def test_single_task_uses_its_own_dates():
    t = _task(date(2026, 9, 1), date(2026, 9, 5))
    out = schedule([t], [], today=TODAY)[t.id]
    assert out.early_start == date(2026, 9, 1)
    assert out.early_finish == date(2026, 9, 5)
    assert out.slack_days == 0
    assert out.is_critical


def test_task_with_no_dates_falls_back_to_today():
    t = _task(None, None)
    out = schedule([t], [], today=TODAY)[t.id]
    assert out.early_start == TODAY
    assert out.early_finish == TODAY


def test_finish_to_start_pushes_the_successor():
    a = _task(date(2026, 9, 1), date(2026, 9, 5))
    b = _task(date(2026, 9, 2), date(2026, 9, 4))  # wants to start too early
    deps = [DependencyIn(a.id, b.id, "FS")]
    out = schedule([a, b], deps, today=TODAY)
    assert out[b.id].early_start == date(2026, 9, 6)
    assert out[b.id].early_finish == date(2026, 9, 8)  # duration preserved


def test_lag_days_delay_the_successor():
    a = _task(date(2026, 9, 1), date(2026, 9, 1))
    b = _task(date(2026, 9, 1), date(2026, 9, 1))
    out = schedule([a, b], [DependencyIn(a.id, b.id, "FS", lag_days=3)], today=TODAY)
    assert out[b.id].early_start == date(2026, 9, 5)


def test_start_to_start_aligns_the_starts():
    a = _task(date(2026, 9, 10), date(2026, 9, 20))
    b = _task(date(2026, 9, 1), date(2026, 9, 3))
    out = schedule([a, b], [DependencyIn(a.id, b.id, "SS")], today=TODAY)
    assert out[b.id].early_start == date(2026, 9, 10)


def test_milestone_is_a_single_day():
    m = _task(date(2026, 9, 9), None, is_milestone=True)
    out = schedule([m], [], today=TODAY)[m.id]
    assert out.early_start == out.early_finish == date(2026, 9, 9)


def test_slack_marks_the_non_critical_branch():
    #   a ──> c
    #   b ──┘        b is short, so it can float.
    a = _task(date(2026, 9, 1), date(2026, 9, 10))
    b = _task(date(2026, 9, 1), date(2026, 9, 2))
    c = _task(date(2026, 9, 11), date(2026, 9, 12))
    deps = [DependencyIn(a.id, c.id, "FS"), DependencyIn(b.id, c.id, "FS")]
    out = schedule([a, b, c], deps, today=TODAY)
    assert out[a.id].is_critical
    assert out[c.id].is_critical
    assert out[b.id].slack_days == 8
    assert not out[b.id].is_critical


def test_late_flag_compares_against_the_due_date():
    a = _task(date(2026, 9, 1), date(2026, 9, 10), due=date(2026, 9, 5))
    out = schedule([a], [], today=TODAY)[a.id]
    assert out.is_late


def test_chain_of_three_accumulates():
    a = _task(date(2026, 9, 1), date(2026, 9, 1))
    b = _task(date(2026, 9, 1), date(2026, 9, 1))
    c = _task(date(2026, 9, 1), date(2026, 9, 1))
    deps = [DependencyIn(a.id, b.id, "FS"), DependencyIn(b.id, c.id, "FS")]
    out = schedule([a, b, c], deps, today=TODAY)
    assert out[c.id].early_start == date(2026, 9, 3)


def test_cycle_is_refused_rather_than_looping_forever():
    a, b = _task(None, None), _task(None, None)
    deps = [DependencyIn(a.id, b.id), DependencyIn(b.id, a.id)]
    with pytest.raises(CycleError):
        topological_order([a.id, b.id], deps)
    with pytest.raises(CycleError):
        schedule([a, b], deps, today=TODAY)


def test_would_create_cycle_catches_the_indirect_case():
    a, b, c = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    deps = [DependencyIn(a, b), DependencyIn(b, c)]
    assert would_create_cycle(deps, c, a)      # closes a -> b -> c -> a
    assert not would_create_cycle(deps, a, c)  # a -> c is just a shortcut
    assert would_create_cycle(deps, a, a)      # self-reference


def test_dependencies_pointing_outside_the_project_are_ignored():
    a = _task(date(2026, 9, 1), date(2026, 9, 1))
    stranger = uuid.uuid4()
    out = schedule([a], [DependencyIn(stranger, a.id)], today=TODAY)
    assert out[a.id].early_start == date(2026, 9, 1)
