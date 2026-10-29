"""A routine's steps: validated once, rendered as the plan Gerry follows."""

from __future__ import annotations

import pytest

from services.scheduler.steps import StepError, describe_steps, normalise_steps, render_steps


def test_plain_strings_become_do_steps_and_branches_are_tidied():
    steps = normalise_steps(
        [
            "  Read last week's   Hatch emails ",
            {
                "condition": "any invoice is over 30 days unpaid",
                "then": ["Draft a reminder", "", "Create a follow-up task"],
                "else": "Note that all invoices are current",
            },
        ]
    )
    assert steps == [
        {"kind": "do", "text": "Read last week's Hatch emails"},
        {
            "kind": "if",
            "condition": "any invoice is over 30 days unpaid",
            "then": ["Draft a reminder", "Create a follow-up task"],
            "otherwise": ["Note that all invoices are current"],
        },
    ]


def test_nothing_is_nothing():
    assert normalise_steps(None) == []
    assert normalise_steps([]) == []
    assert render_steps([]) == ""
    assert render_steps(None) == ""


@pytest.mark.parametrize(
    "bad, message",
    [
        ("not a list", "must be a list"),
        ([{"kind": "do", "text": "   "}], "Step 1 is empty"),
        ([{"kind": "if", "condition": "x"}], "nothing to do either way"),
        ([{"kind": "if", "then": ["a"]}], "condition is empty"),
        ([{"kind": "maybe", "text": "a"}], "kind must be"),
        ([42], "not an object"),
    ],
)
def test_malformed_steps_are_refused_with_a_reason(bad, message):
    with pytest.raises(StepError) as err:
        normalise_steps(bad)
    assert message in str(err.value)


def test_rendering_tells_gerry_to_take_exactly_one_branch_and_say_which():
    text = render_steps(
        [
            {"kind": "do", "text": "Open the budget sheet"},
            {"kind": "if", "condition": "spend is over 80%", "then": ["Email me"], "otherwise": []},
            {"kind": "if", "condition": "a milestone is late", "then": ["Make a task"], "otherwise": ["Note it is on track"]},
        ]
    )
    assert "PROCEDURE" in text and "exactly one branch" in text and "which branch you took" in text
    assert "1. Open the budget sheet" in text
    assert "2. IF spend is over 80%:" in text and "THEN: Email me" in text
    assert "OTHERWISE: nothing — carry on" in text
    assert "3. IF a milestone is late:" in text and "OTHERWISE: Note it is on track" in text


def test_describe_is_one_line_per_step():
    out = describe_steps(
        [{"kind": "do", "text": "A"}, {"kind": "if", "condition": "c", "then": ["x", "y"], "otherwise": []}]
    )
    assert out.splitlines() == ["1. A", "2. if c → x; y | otherwise → carry on"]
    assert describe_steps(None).startswith("(no steps")
