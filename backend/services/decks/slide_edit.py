"""Add a text box to an existing Google Slides deck, in the house style.

The agent chooses a ROLE ("footnote", "callout", …), never a font or a colour —
those come from the deck theme, the same one the builder uses. That is what
keeps an edited slide looking like a built one; a model asked for a hex code
will eventually invent one.

Placement is checked against what is already on the slide, because Slides will
happily stack a new box on top of existing text and report success.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from services.decks.theme import DeckTheme

# Enough clearance that two boxes read as separate, not as a collision.
_MIN_GAP_IN = 0.04


class SlideEditError(Exception):
    """A placement or role problem the caller should fix, reported verbatim."""


@dataclass(frozen=True)
class Role:
    summary: str
    size_attr: str
    colour_attr: str
    mono: bool = False
    bold: bool = False
    align: str = "START"
    upper: bool = False


# Named by what the text DOES, so the theme decides how it looks.
ROLES: dict[str, Role] = {
    "footnote": Role(
        "Source line or citation, small and quiet. Bottom of the slide.",
        "caption", "caption", mono=True,
    ),
    "caption": Role(
        "Explanatory line under a headline, figure or image.",
        "body_sm", "caption",
    ),
    "body": Role(
        "Ordinary body copy.",
        "body", "body",
    ),
    "detail": Role(
        "Secondary detail, smaller than body.",
        "detail", "body",
    ),
    "callout": Role(
        "Short emphasised line that should draw the eye. Accent colour.",
        "body", "accent", bold=True,
    ),
    "label": Role(
        "All-caps monospace tag, like the eyebrow labels on built slides.",
        "eyebrow", "dim", mono=True, upper=True,
    ),
    "figure": Role(
        "A number or short metric meant to be read at a glance.",
        "figure", "primary", bold=True,
    ),
    "heading": Role(
        "A sub-heading introducing a block of content.",
        "subtitle", "primary", bold=True,
    ),
}


def catalog() -> str:
    width = max(len(n) for n in ROLES)
    return "\n".join(f"  {n.ljust(width)}  {r.summary}" for n, r in ROLES.items())


def resolve_role(theme: DeckTheme, role: str) -> dict:
    """Font, size and colour for a role — from the theme, never from the model."""
    # "call-out", "Call Out" and "callout" are the same request.
    key = re.sub(r"[^a-z0-9]", "", role.lower())
    spec = ROLES.get(key)
    if spec is None:
        raise SlideEditError(
            f'"{role}" is not a text role. Use one of: {", ".join(ROLES)}.'
        )
    return {
        "font": theme.fonts.mono if spec.mono else theme.fonts.display,
        "size_pt": getattr(theme.sizes, spec.size_attr),
        "colour": getattr(theme.palette, spec.colour_attr),
        "bold": spec.bold,
        "align": spec.align,
        "upper": spec.upper,
    }


def _overlaps(a: dict, b: dict) -> bool:
    ax2, ay2 = a["left"] + a["width"], a["top"] + a["height"]
    bx2, by2 = b["left"] + b["width"], b["top"] + b["height"]
    return (
        a["left"] < bx2 - _MIN_GAP_IN
        and ax2 > b["left"] + _MIN_GAP_IN
        and a["top"] < by2 - _MIN_GAP_IN
        and ay2 > b["top"] + _MIN_GAP_IN
    )


def check_placement(
    box: dict, elements: list[dict], canvas_w: float, canvas_h: float
) -> None:
    """Reject a box that leaves the slide or lands on existing content."""
    if box["width"] <= 0 or box["height"] <= 0:
        raise SlideEditError("width and height must be greater than zero.")
    if box["left"] < 0 or box["top"] < 0:
        raise SlideEditError("left and top must be on the slide (0 or more).")
    right, bottom = box["left"] + box["width"], box["top"] + box["height"]
    if right > canvas_w + 0.01 or bottom > canvas_h + 0.01:
        raise SlideEditError(
            f"That box runs off the slide — it would end at "
            f"{right:.2f}in x {bottom:.2f}in on a {canvas_w:.2f}in x "
            f"{canvas_h:.2f}in canvas."
        )

    hits = [
        e for e in elements
        if all(k in e for k in ("left", "top", "width", "height")) and _overlaps(box, e)
    ]
    if hits:
        listing = "; ".join(
            f'{h["object_id"]} at {h["left"]:.2f},{h["top"]:.2f} '
            f'{h["width"]:.2f}x{h["height"]:.2f}'
            + (f' ("{h["text"][:40]}")' if h.get("text") else "")
            for h in hits[:4]
        )
        raise SlideEditError(
            f"That position overlaps {len(hits)} existing item(s): {listing}. "
            "Pick a clear area — read the slide's geometry first and place the box "
            "in the gap, or rewrite the existing shape instead of adding one."
        )


def suggest_footnote_box(
    elements: list[dict], canvas_w: float, canvas_h: float, theme: DeckTheme
) -> dict:
    """A bottom-of-slide strip on the theme's left margin, above everything
    already down there. Used when the agent asks for a footnote without saying
    where — the common case, and the one it gets wrong by guessing."""
    g = theme.grid
    left = g.margin_l
    width = canvas_w - g.margin_l - g.margin_r
    height = 0.22
    # Sit above the lowest existing element in that strip, not on top of it.
    floor = canvas_h - 0.30
    for e in elements:
        if not all(k in e for k in ("left", "top", "width", "height")):
            continue
        if e["top"] + e["height"] < canvas_h * 0.6:
            continue  # not in the bottom band
        if e["left"] > left + width or e["left"] + e["width"] < left:
            continue  # not horizontally in the way
        floor = min(floor, e["top"] - _MIN_GAP_IN)
    return {
        "left": left,
        "top": round(max(0.0, floor - height), 2),
        "width": round(width, 2),
        "height": height,
    }
