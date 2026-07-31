"""Deck theme sourced from the shared "PMI Templates" Drive folder.

Same construct as file templates: the Drive folder is the source of truth, the
merged markdown is cached in a SystemSetting so decks still build offline, and
nothing is read until a deck is actually being made.

A doc named "Deck Theme" in that folder holds `key: value` lines, grouped
either by dotted prefix or by a `###` heading:

    ### Palette
    accent: FF0000

    ### Sizes
    headline: 37.54

    palette.background: 000000
    classification.confidential_internal: CONFIDENTIAL — INTERNAL

Only keys that already exist are honoured, and every value is range-checked:
a typo in the doc falls back to the built-in value rather than producing a
deck with 900pt type. Unrecognised or rejected lines are reported so the
mistake surfaces instead of being silently absorbed.
"""

from __future__ import annotations

import dataclasses
import logging
import re
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from services.decks.theme import (
    CLASSIFICATIONS,
    DEFAULT_THEME,
    Chrome,
    DeckTheme,
    Fonts,
    Grid,
    Palette,
    Sizes,
)

logger = logging.getLogger(__name__)

# Doc/section names in the templates folder that mean "deck theme". Reserved in
# file_templates so they never show up as a document type.
DECK_THEME_ALIASES = {
    "deck theme",
    "deck style",
    "deck style guide",
    "slide theme",
    "slide style",
    "presentation theme",
    "presentation style",
}

_GROUPS: dict[str, type] = {
    "palette": Palette,
    "fonts": Fonts,
    "sizes": Sizes,
    "grid": Grid,
    "chrome": Chrome,
}

_GROUP_ALIASES = {
    "color": "palette",
    "colors": "palette",
    "colour": "palette",
    "colours": "palette",
    "font": "fonts",
    "typeface": "fonts",
    "typefaces": "fonts",
    "size": "sizes",
    "type scale": "sizes",
    "layout": "grid",
    "classification": "classifications",
    "classifications": "classifications",
}

_HEX = re.compile(r"^#?([0-9A-Fa-f]{6})$")

# Guard rails. Points for type, inches for anything positional (the canvas is
# 13.33 x 7.5in, so nothing sensible sits outside it).
_MAX_PT = 400.0
_MAX_IN = 14.0
_MAX_LABEL = 60  # longer than this and the mark wraps out of its box


def _clean(line: str) -> str:
    """Strip the decoration Google Docs adds — bullets, bold, code ticks."""
    s = line.strip().lstrip("-*\u2022 \t").strip()
    return s.replace("**", "").replace("`", "").strip()


def _split_kv(line: str) -> tuple[str, str] | None:
    m = re.match(r"^([A-Za-z][\w. ]*?)\s*[:=]\s*(.*)$", line)
    if not m:
        return None
    return m.group(1).strip().lower().replace(" ", "_"), m.group(2).strip()


def _as_float(raw: str) -> float | None:
    try:
        v = float(raw.rstrip("\"'").replace("pt", "").replace("in", "").strip())
    except ValueError:
        return None
    return v if v == v and abs(v) != float("inf") else None


def _coerce(group: str, key: str, raw: str, default: Any) -> tuple[Any, str]:
    """Return (value, "") or (None, reason)."""
    if isinstance(default, str):
        if group == "palette":
            m = _HEX.match(raw)
            return (m.group(1).upper(), "") if m else (None, "not a 6-digit hex colour")
        val = raw.strip().strip("\"'")
        return (val, "") if val else (None, "empty")

    if isinstance(default, tuple):
        parts = [p for p in re.split(r"[,\s]+", raw.strip()) if p]
        if len(parts) != len(default):
            return None, f"expected {len(default)} numbers, got {len(parts)}"
        out: list[float] = []
        for p in parts:
            v = _as_float(p)
            if v is None or not 0 <= v <= _MAX_IN:
                return None, f"'{p}' is not an inch measurement between 0 and {_MAX_IN:g}"
            out.append(v)
        return tuple(out), ""

    if isinstance(default, (int, float)):
        v = _as_float(raw)
        if v is None:
            return None, "not a number"
        hi = _MAX_PT if group == "sizes" else _MAX_IN
        lo = 1.0 if group == "sizes" else 0.0
        if not lo <= v <= hi:
            return None, f"{v:g} is outside the sane range {lo:g}–{hi:g}"
        return v, ""

    return None, "unsupported value type"


def parse_theme(body: str, base: DeckTheme | None = None) -> tuple[DeckTheme, list[str]]:
    """Apply `key: value` overrides from the Drive doc to the built-in theme."""
    base = base or DEFAULT_THEME
    overrides: dict[str, dict[str, Any]] = {g: {} for g in _GROUPS}
    labels: dict[str, str] = {}
    top: dict[str, Any] = {}
    problems: list[str] = []
    current = ""

    for rawline in body.splitlines():
        line = rawline.strip()
        heading = re.match(r"^#{3,}\s*(.+?)\s*$", line)
        if heading:
            h = heading.group(1).strip().lower().rstrip(":")
            current = _GROUP_ALIASES.get(h, h)
            if current not in _GROUPS and current != "classifications":
                problems.append(f"unknown group heading '{heading.group(1)}'")
                current = ""
            continue

        line = _clean(line)
        if not line or line.startswith("#") or line.startswith("//"):
            continue
        kv = _split_kv(line)
        if kv is None:
            continue  # prose in the doc is fine; only key: value lines count
        key, raw = kv

        group = current
        if "." in key:
            head, _, tail = key.partition(".")
            group = _GROUP_ALIASES.get(head, head)
            key = tail

        if key == "name":  # no group owns a 'name', so it is always the theme's
            if raw.strip():
                top["name"] = raw.strip()[:64]
            continue

        if group == "classifications":
            if key == "open":
                problems.append(
                    "'open' cannot be given a label — an open deck is deliberately unmarked"
                )
                continue
            if key not in CLASSIFICATIONS:
                problems.append(
                    f"'{key}' is not a classification level "
                    f"({', '.join(k for k in CLASSIFICATIONS if k != 'open')})"
                )
                continue
            label = raw.strip().strip("\"'")
            if not label:
                problems.append(f"classification '{key}' cannot be blank")
            elif len(label) > _MAX_LABEL:
                problems.append(f"classification '{key}' is over {_MAX_LABEL} characters")
            else:
                labels[key] = label
            continue

        if group not in _GROUPS:
            if raw:  # a bare 'Something:' line is prose, not a failed setting
                problems.append(f"'{key}' has no group — write it as e.g. 'sizes.{key}'")
            continue

        default = getattr(getattr(base, group), key, None)
        if default is None:
            valid = ", ".join(f.name for f in dataclasses.fields(_GROUPS[group]))
            problems.append(f"'{group}.{key}' is not a setting. {group} takes: {valid}")
            continue

        value, why = _coerce(group, key, raw, default)
        if why:
            problems.append(f"'{group}.{key}' ignored — {why}")
        else:
            overrides[group][key] = value

    parts = {g: dataclasses.replace(getattr(base, g), **o) for g, o in overrides.items() if o}
    if labels:
        top["classifications"] = {**base.classifications, **labels}
    if not parts and not top:
        return base, problems
    return dataclasses.replace(base, **parts, **top), problems


def extract_section(md: str) -> str:
    """Pull the deck-theme section out of the merged templates markdown."""
    current, keep, lines = "", False, []
    for line in md.splitlines():
        m = re.match(r"^##\s+(.+?)\s*$", line)
        if m:
            current = re.sub(r"[^a-z0-9]+", " ", m.group(1).lower()).strip()
            # Match file_templates' naive singular so both agree on a heading.
            keep = current in DECK_THEME_ALIASES or current.rstrip("s") in DECK_THEME_ALIASES
            continue
        if keep:
            lines.append(line)
    return "\n".join(lines).strip()


async def get_deck_theme(db: AsyncSession) -> tuple[DeckTheme, list[str]]:
    """The house deck theme: Drive when reachable, cache when not, built-in
    when neither. Never raises — a deck must still build if Drive is down."""
    try:
        from services.file_templates import get_templates_markdown

        md = await get_templates_markdown(db)
    except Exception as exc:  # noqa: BLE001 — Drive/network errors expected
        logger.warning("Deck theme: templates folder unreadable (%s); using built-in.", exc)
        return DEFAULT_THEME, []
    body = extract_section(md or "")
    if not body:
        return DEFAULT_THEME, []
    try:
        theme, problems = parse_theme(body)
    except Exception as exc:  # noqa: BLE001 — a malformed doc must not break decks
        logger.warning("Deck theme: '%s' could not be parsed (%s); using built-in.", body[:60], exc)
        return DEFAULT_THEME, []
    for p in problems:
        logger.warning("Deck theme doc: %s", p)
    return theme, problems
