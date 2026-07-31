"""Slide archetypes — named by visual structure, not by business purpose.

The example deck is a fundraising deck, but the same shapes serve a product
briefing or a demo. So `tier_cards` describes three cards with a big figure
each; whether those figures are market sizes or throughput numbers is the
caller's business.

Each archetype declares the fields it renders. The catalog is what the agent
tool advertises, so keep the descriptions plain — they are read by the model.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Archetype:
    name: str
    summary: str
    fields: dict[str, str]


# Common to nearly every slide; documented once rather than on all 13.
_COMMON = {
    "eyebrow": "Short ALL-CAPS label above the headline (e.g. OVERVIEW).",
    "headline": "The headline, in white.",
    "headline_accent": "Optional second clause shown in the accent colour, "
                       "appended to the headline. The signature look.",
}

ARCHETYPES: tuple[Archetype, ...] = (
    Archetype(
        "cover",
        "Opening slide: kicker, one huge word or short title, a two-tone "
        "subtitle, a footnote, optional image on the right.",
        {
            "kicker": "Small mono label above the title (usually the company).",
            "headline": "The hero word or short title.",
            "subtitle": "One line under the title.",
            "subtitle_accent": "Optional second clause of the subtitle, accented.",
            "footnote": "Small grey line at the bottom (occasion, date, audience).",
            "image": "Optional path or URL for the right-hand image.",
        },
    ),
    Archetype(
        "section_break",
        "Divider between sections: eyebrow and a large headline, nothing else.",
        _COMMON,
    ),
    Archetype(
        "statement_media",
        "One strong statement and a supporting caption on the left; a "
        "full-height media panel down the right.",
        {**_COMMON,
         "caption": "Supporting sentence under the statement.",
         "media_label": "Placeholder text shown in the panel (default IMAGE).",
         "image": "Optional image to fill the panel."},
    ),
    Archetype(
        "bullets",
        "Headline with a simple list beneath it.",
        {**_COMMON, "caption": "Optional line under the headline.",
         "items": "List of strings."},
    ),
    Archetype(
        "points_with_metrics",
        "Headline on the left; numbered points separated by hairlines on the "
        "right; large metric callouts along the bottom.",
        {**_COMMON,
         "items": "List of point strings; numbered 01, 02, 03 automatically.",
         "metrics": "List of {value, label}. The first is accented."},
    ),
    Archetype(
        "numbered_cards",
        "Headline and caption on the left; stacked numbered cards on the right.",
        {**_COMMON, "caption": "Supporting line under the headline.",
         "items": "List of card strings; numbered automatically."},
    ),
    Archetype(
        "profile_cards",
        "Three cards of label / name / one-line detail, then a labelled row of "
        "names underneath. Built for people, works for partners or products.",
        {**_COMMON,
         "cards": "List of {label, name, detail}. Three fits the row.",
         "footer_label": "ALL-CAPS label for the bottom row.",
         "footer_items": "List of strings, or {name, detail} for a two-tone entry."},
    ),
    Archetype(
        "tier_cards",
        "Three cards, each a label, a big figure, a rule and a list of items. "
        "Market tiers in the example; equally deployment phases or plans.",
        {**_COMMON,
         "caption": "Optional accented line under the headline.",
         "cards": "List of {label, value, items[]}. The first is accented."},
    ),
    Archetype(
        "metric_cards",
        "A row of up to four compact metric cards, then a labelled row of chips.",
        {**_COMMON,
         "cards": "List of {label, value, caption}. The first is accented.",
         "chips_label": "ALL-CAPS label for the chip row.",
         "chips": "List of short strings."},
    ),
    Archetype(
        "media_feature",
        "Headline across the top, a media block on the left, body copy and "
        "small cards on the right.",
        {**_COMMON, "caption": "Body copy beside the media.",
         "cards": "Optional list of {label, value}.",
         "media_label": "Placeholder text for the media block.",
         "image": "Optional image for the media block."},
    ),
    Archetype(
        "split_detail",
        "Two large panels side by side, each with a label and its own items.",
        {**_COMMON, "caption": "Line under the headline.",
         "panels": "List of two {label, items[]}."},
    ),
    Archetype(
        "comparison_grid",
        "A matrix comparing options across criteria. First column is the "
        "criterion, remaining columns the options.",
        {**_COMMON, "caption": "Optional line under the headline.",
         "columns": "Column headers; the first is the criterion column.",
         "rows": "List of {label, cells[]} — cells align to columns after the first."},
    ),
    Archetype(
        "milestone_track",
        "A staged progression: each stage a label, a status and a detail line.",
        {**_COMMON, "caption": "Optional line under the headline.",
         "stages": "List of {label, status, detail}. Mark reached stages with "
                   "done: true to accent them."},
    ),
    Archetype(
        "hero_number",
        "One giant number or word, an accented line beneath it, a small caption.",
        {"eyebrow": _COMMON["eyebrow"],
         "headline": "The giant figure or word.",
         "line": "Accented line under the figure.",
         "caption": "Small grey explanatory line."},
    ),
)

BY_NAME = {a.name: a for a in ARCHETYPES}


def catalog() -> str:
    """Human/model-readable list of archetypes and their fields."""
    out = []
    for a in ARCHETYPES:
        fields = ", ".join(sorted(a.fields))
        out.append(f"- {a.name}: {a.summary}\n  fields: {fields}")
    return "\n".join(out)
