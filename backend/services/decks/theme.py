"""Deck theme — the visual system extracted from the company's example deck.

Every measurement here was read off the real file rather than eyeballed, so a
generated deck sits on the same grid as a hand-built one. Sizes look odd (7.94,
37.54) because Google Slides scales points on export; keeping the exact values
is what makes generated slides line up with existing ones.

Swapping the theme swaps the whole look: nothing downstream hard-codes a colour
or a font.
"""

from __future__ import annotations

from dataclasses import dataclass, field

EMU_PER_INCH = 914400

# 16:9 at Google Slides' exact canvas, not python-pptx's rounded 13.333in.
CANVAS_W = 12192000
CANVAS_H = 6858000

# How a deck is marked. "open" carries no mark at all, because a deck meant for
# an outside audience should not be stamped confidential by default.
CLASSIFICATIONS: dict[str, str] = {
    "open": "",
    "confidential_internal": "CONFIDENTIAL \u2014 INTERNAL",
    "confidential_proprietary": "CONFIDENTIAL \u2014 PROPRIETARY INFORMATION",
    "confidential_trade_secret": "CONFIDENTIAL \u2014 TRADE SECRET",
}


@dataclass(frozen=True)
class Palette:
    background: str = "000000"
    card: str = "0A0A0A"
    card_alt: str = "111111"
    panel: str = "161616"
    primary: str = "FFFFFF"
    body: str = "C9C9C9"
    caption: str = "6F6F6F"
    dim: str = "4D4D4D"
    accent: str = "FF0000"


@dataclass(frozen=True)
class Fonts:
    display: str = "Archivo"      # headlines and body
    mono: str = "JetBrains Mono"  # eyebrows, indices, page numbers


@dataclass(frozen=True)
class Sizes:
    """Point sizes, as measured in the example."""

    hero: float = 95.29        # cover word, exit year
    headline_xl: float = 44.76
    headline_lg: float = 40.42
    headline: float = 37.54    # the common one
    headline_sm: float = 33.21
    figure_lg: float = 31.76   # tier card values
    figure: float = 24.54
    subtitle: float = 18.77
    name: float = 15.88
    body: float = 13.72
    body_sm: float = 12.27
    detail: float = 11.55
    item: float = 10.83
    detail_sm: float = 10.11
    caption: float = 9.38
    index: float = 9.38        # numbered-list index
    page_no: float = 8.66
    eyebrow: float = 7.94


@dataclass(frozen=True)
class Grid:
    """Inches. The left margin and content width every slide obeys."""

    margin_l: float = 0.56
    margin_r: float = 0.56
    content_w: float = 12.88
    rule_w: float = 11.71       # full-width section divider
    eyebrow_tick_w: float = 0.28
    eyebrow_label_l: float = 0.96
    hairline_h: float = 0.01
    card_inset: float = 0.28

    # Three-across and four-across card rows.
    cols_3: tuple[float, ...] = (0.56, 4.48, 8.40)
    col_3_w: float = 3.88
    cols_4: tuple[float, ...] = (0.56, 3.50, 6.44, 9.37)
    col_4_w: float = 2.90

    # Right-hand column used by split layouts.
    right_l: float = 6.18
    right_w: float = 6.09


@dataclass(frozen=True)
class Chrome:
    """Marks repeated on every slide."""

    confidential_l: float = 0.56
    confidential_t: float = 0.34
    confidential_w: float = 4.00  # fits the longest classification on one line
    confidential_h: float = 0.22
    page_no_l: float = 12.09
    page_no_t: float = 6.72
    page_no_w: float = 0.27
    page_no_h: float = 0.24


@dataclass(frozen=True)
class DeckTheme:
    name: str = "VACTOR"
    palette: Palette = field(default_factory=Palette)
    fonts: Fonts = field(default_factory=Fonts)
    sizes: Sizes = field(default_factory=Sizes)
    grid: Grid = field(default_factory=Grid)
    chrome: Chrome = field(default_factory=Chrome)
    canvas_w: int = CANVAS_W
    canvas_h: int = CANVAS_H
    # Labels only — the set of keys is fixed, since the agent's tool schema
    # offers exactly these four choices.
    classifications: dict[str, str] = field(default_factory=lambda: dict(CLASSIFICATIONS))


DEFAULT_THEME = DeckTheme()
