"""The steps of a routine: do this; if that, then this, otherwise that.

A routine used to be one instruction. It can now be a short procedure — a
list of steps, each either something to do or a branch on a condition Gerry
checks with real tool calls at run time. The steps are stored as plain data
on the task and rendered into the run's instruction here, so the agent gets
one numbered plan and the UI and the agent tools share one shape:

    {"kind": "do", "text": "Read last week's emails from the Hatch team"}
    {"kind": "if", "condition": "any invoice is over 30 days unpaid",
     "then": ["Draft a reminder email to the vendor", "Create a task to follow up"],
     "otherwise": ["Note that all invoices are current"]}

Conditions and actions are prose on purpose: Gerry decides them the way she
does in conversation, by looking, and says in her output which branch she
took and why.
"""

from __future__ import annotations

from typing import Any

MAX_STEPS = 20
MAX_BRANCH_ACTIONS = 10
MAX_TEXT = 1_000


class StepError(ValueError):
    """A step the UI or the agent handed over is not well formed."""


def _text(value: Any, what: str) -> str:
    text = " ".join(str(value or "").split())
    if not text:
        raise StepError(f"{what} is empty.")
    return text[:MAX_TEXT]


def _texts(value: Any, what: str) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        raise StepError(f"{what} must be a list of actions.")
    out = [_text(v, what) for v in value if str(v or "").strip()]
    return out[:MAX_BRANCH_ACTIONS]


def normalise_steps(raw: Any) -> list[dict[str, Any]]:
    """Validate and tidy steps. Returns [] for nothing; raises StepError when malformed."""
    if raw is None or raw == "" or raw == []:
        return []
    if not isinstance(raw, list):
        raise StepError("steps must be a list.")
    out: list[dict[str, Any]] = []
    for i, step in enumerate(raw[:MAX_STEPS], start=1):
        if isinstance(step, str):
            out.append({"kind": "do", "text": _text(step, f"Step {i}")})
            continue
        if not isinstance(step, dict):
            raise StepError(f"Step {i} is not an object.")
        kind = str(step.get("kind") or ("if" if "condition" in step else "do")).lower()
        if kind == "do":
            out.append({"kind": "do", "text": _text(step.get("text") or step.get("action"), f"Step {i}")})
        elif kind == "if":
            then = _texts(step.get("then"), f"Step {i} 'then'")
            otherwise = _texts(step.get("otherwise") or step.get("else"), f"Step {i} 'otherwise'")
            if not then and not otherwise:
                raise StepError(f"Step {i} has a condition but nothing to do either way.")
            out.append(
                {
                    "kind": "if",
                    "condition": _text(step.get("condition"), f"Step {i} condition"),
                    "then": then,
                    "otherwise": otherwise,
                }
            )
        else:
            raise StepError(f"Step {i}: kind must be 'do' or 'if'.")
    return out


def render_steps(steps: list[dict[str, Any]] | None) -> str:
    """The steps as the plan Gerry follows, or "" when there are none."""
    steps = steps or []
    if not steps:
        return ""
    lines = [
        "",
        "PROCEDURE — follow these steps in order. A step that says IF is a decision: "
        "check the condition with real tool calls, take exactly one branch, and in "
        "your output say which branch you took and what you saw that decided it. "
        "Do every action in the branch you took and none from the other.",
    ]
    for i, step in enumerate(steps, start=1):
        if step.get("kind") == "if":
            lines.append(f"{i}. IF {step['condition']}:")
            for a in step.get("then") or []:
                lines.append(f"     THEN: {a}")
            if step.get("otherwise"):
                for a in step["otherwise"]:
                    lines.append(f"     OTHERWISE: {a}")
            else:
                lines.append("     OTHERWISE: nothing — carry on to the next step.")
        else:
            lines.append(f"{i}. {step['text']}")
    return "\n".join(lines)


def describe_steps(steps: list[dict[str, Any]] | None) -> str:
    """One line per step, for lists and confirmations."""
    steps = steps or []
    if not steps:
        return "(no steps — the instruction alone)"
    parts = []
    for i, step in enumerate(steps, start=1):
        if step.get("kind") == "if":
            then = "; ".join(step.get("then") or []) or "—"
            other = "; ".join(step.get("otherwise") or []) or "carry on"
            parts.append(f"{i}. if {step['condition']} → {then} | otherwise → {other}")
        else:
            parts.append(f"{i}. {step['text']}")
    return "\n".join(parts)
