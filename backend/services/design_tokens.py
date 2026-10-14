"""Design tokens — the company's look, as a Setting instead of code.

5.18.0 hard-coded Precisian Medical's design system in ``design_system.Tokens``
(Word) and ``decks.theme.DEFAULT_THEME`` (slides). This module keeps those as
the *defaults* and lets an administrator store a different set — logos,
fonts, colours and a few layout rules — under SystemSetting ``design.tokens``.
Nothing stored means PMI's values, byte for byte.

Fonts and logos live under ``<data dir>/brand/`` (next to ``documents/``):
``fonts/<Family>-Regular.ttf`` + ``-Bold.ttf`` for an uploaded face,
``logo-light.png`` / ``logo-dark.png`` for the marks. Bundled OFL faces in
``backend/assets/fonts/`` are offered by name.

Word generation runs in a thread without a session, so the active tokens are
held in a process-level cache: ``refresh(db)`` at startup and after every
change, ``current()`` everywhere else.
"""

from __future__ import annotations

import colorsys
import json
import logging
import re
from dataclasses import asdict, dataclass, field, fields, replace
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from brand import get_brand
from config import settings
from models.db.settings import SystemSetting

logger = logging.getLogger(__name__)

SETTING_KEY = "design.tokens"
ASSETS_FONTS_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"
BRAND_DIR = Path(settings.storage_root).expanduser().parent / "brand"
FONTS_DIR = BRAND_DIR / "fonts"

#: Faces shipped with the app (SIL Open Font License). Family → files.
BUNDLED_FONTS: dict[str, dict[str, str]] = {
    "Archivo": {"Regular": "Archivo-Regular.ttf", "Bold": "Archivo-Bold.ttf"},
    "JetBrains Mono": {"Regular": "JetBrainsMono-Regular.ttf", "Bold": "JetBrainsMono-Bold.ttf"},
}
_FAMILY_CLASS: dict[str, tuple[str, str]] = {
    "Archivo": ("swiss", "variable"),
    "JetBrains Mono": ("modern", "fixed"),
}

BANNER_STYLES = ("dark", "accent", "none")
_HEX = re.compile(r"^[0-9A-Fa-f]{6}$")
_FAMILY_OK = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 \-]{0,48}$")


@dataclass(frozen=True)
class DesignTokens:
    """Everything an administrator can choose. Defaults are PMI's system."""

    # Type
    font_display: str = "Archivo"
    font_mono: str = "JetBrains Mono"

    # Colours on the light / print surface (Word), hex without '#'
    accent: str = "FF0000"
    ink: str = "000000"
    body: str = "333333"
    muted: str = "6F6F6F"
    hairline: str = "E0E0E0"

    # Colours on the dark surface (decks, banners)
    dark_background: str = "000000"
    dark_card: str = "0A0A0A"
    dark_text: str = "FFFFFF"
    dark_body: str = "C9C9C9"

    # The app's own accent (buttons, focus rings). PMI's #E8000D.
    app_accent: str = "E8000D"

    # Layout rules
    title_rule: bool = True           # accent rule under the document title
    section_hairlines: bool = True    # hairline above each H1
    banner_style: str = "dark"        # dark | accent | none
    eyebrow_caps: bool = True         # mono labels in uppercase
    footer_wording: str = ""          # "" → company name
    controlled_exempt: bool = True    # FDA/QMS/regulatory docs keep plain styling

    # Logos (file names under BRAND_DIR, "" when not uploaded)
    logo_light: str = ""
    logo_dark: str = ""

    # Deck name shown on the cover
    deck_name: str = "VACTOR"


_brand = get_brand()
IS_PMI = _brand.slug == "littlegerry"
DEFAULTS = DesignTokens(
    deck_name=str(_brand.product.get("name") or _brand.company_short or ""),
)

_current: DesignTokens = DEFAULTS
_source: str = "defaults"


def current() -> DesignTokens:
    return _current


def source() -> str:
    """"setting" when an administrator has stored tokens, else "defaults"."""
    return _source


def is_default() -> bool:
    return _current == DEFAULTS


# ── Validation / coercion ───────────────────────────────────────────────────

def _coerce(data: dict[str, Any]) -> tuple[DesignTokens, list[str]]:
    """Build tokens from a stored/incoming dict; bad values fall back and are reported."""
    problems: list[str] = []
    values: dict[str, Any] = {}
    for f in fields(DesignTokens):
        if f.name not in data:
            continue
        raw = data[f.name]
        default = getattr(DEFAULTS, f.name)
        if isinstance(default, bool):
            values[f.name] = bool(raw)
        elif f.name in ("accent", "ink", "body", "muted", "hairline", "dark_background",
                        "dark_card", "dark_text", "dark_body", "app_accent"):
            s = str(raw or "").strip().lstrip("#").upper()
            if _HEX.match(s):
                values[f.name] = s
            else:
                problems.append(f"{f.name}: '{raw}' is not a 6-digit hex colour")
        elif f.name in ("font_display", "font_mono"):
            s = str(raw or "").strip()
            if s and _FAMILY_OK.match(s):
                values[f.name] = s
            elif s:
                problems.append(f"{f.name}: '{raw}' is not a font family name")
        elif f.name == "banner_style":
            s = str(raw or "").strip().lower()
            if s in BANNER_STYLES:
                values[f.name] = s
            else:
                problems.append(f"banner_style: '{raw}' must be one of {', '.join(BANNER_STYLES)}")
        else:
            values[f.name] = str(raw or "").strip()[:200]
    return replace(DEFAULTS, **values), problems


def to_dict(tokens: DesignTokens) -> dict[str, Any]:
    return asdict(tokens)


# ── Persistence ─────────────────────────────────────────────────────────────

async def refresh(db: AsyncSession) -> DesignTokens:
    """Load the stored tokens into the process cache. Never raises."""
    global _current, _source
    try:
        row = (await db.execute(select(SystemSetting).where(SystemSetting.key == SETTING_KEY))).scalar_one_or_none()
        if row is not None and isinstance(row.value, dict) and row.value:
            tokens, problems = _coerce(row.value)
            for p in problems:
                logger.warning("design.tokens: %s", p)
            _current, _source = tokens, "setting"
        else:
            _current, _source = DEFAULTS, "defaults"
    except Exception:  # noqa: BLE001 — a bad setting must not take documents down
        logger.exception("design.tokens could not be loaded; using defaults")
        _current, _source = DEFAULTS, "defaults"
    return _current


async def save(db: AsyncSession, data: dict[str, Any], user_id=None) -> tuple[DesignTokens, list[str]]:
    """Validate, store and activate. Returns (tokens, problems)."""
    tokens, problems = _coerce(data)
    payload = to_dict(tokens)
    row = (await db.execute(select(SystemSetting).where(SystemSetting.key == SETTING_KEY))).scalar_one_or_none()
    if row is None:
        db.add(SystemSetting(key=SETTING_KEY, value=payload, updated_by=user_id))
    else:
        row.value = payload
        row.updated_by = user_id
    await db.flush()
    global _current, _source
    _current, _source = tokens, "setting"
    return tokens, problems


async def reset(db: AsyncSession) -> None:
    """Back to the built-in design system."""
    row = (await db.execute(select(SystemSetting).where(SystemSetting.key == SETTING_KEY))).scalar_one_or_none()
    if row is not None:
        await db.delete(row)
        await db.flush()
    global _current, _source
    _current, _source = DEFAULTS, "defaults"


# ── Fonts ───────────────────────────────────────────────────────────────────

def uploaded_fonts() -> dict[str, dict[str, Path]]:
    """Families under BRAND_DIR/fonts with both faces present."""
    out: dict[str, dict[str, Path]] = {}
    if not FONTS_DIR.is_dir():
        return out
    for reg in FONTS_DIR.glob("*-Regular.*"):
        family = reg.name.rsplit("-Regular", 1)[0].replace("_", " ")
        bold = next(FONTS_DIR.glob(f"{reg.name.rsplit('-Regular', 1)[0]}-Bold.*"), None)
        if bold is not None:
            out[family] = {"Regular": reg, "Bold": bold}
    return out


def font_files(family: str) -> dict[str, Path] | None:
    """Regular + Bold files for a family: bundled first, then uploaded."""
    bundled = BUNDLED_FONTS.get(family)
    if bundled:
        paths = {face: ASSETS_FONTS_DIR / name for face, name in bundled.items()}
        if all(p.is_file() for p in paths.values()):
            return paths
    return uploaded_fonts().get(family)


def font_class(family: str) -> tuple[str, str]:
    if family in _FAMILY_CLASS:
        return _FAMILY_CLASS[family]
    return ("modern", "fixed") if "mono" in family.lower() else ("swiss", "variable")


def available_fonts() -> list[dict[str, Any]]:
    seen: list[dict[str, Any]] = []
    for family in BUNDLED_FONTS:
        seen.append({"family": family, "source": "bundled", "available": font_files(family) is not None})
    for family in sorted(uploaded_fonts()):
        if family not in BUNDLED_FONTS:
            seen.append({"family": family, "source": "uploaded", "available": True})
    return seen


def save_font(family: str, face: str, data: bytes, ext: str) -> Path:
    family = family.strip()
    if not _FAMILY_OK.match(family):
        raise ValueError("Font family names may use letters, digits, spaces and hyphens only.")
    if face not in ("Regular", "Bold"):
        raise ValueError("Face must be Regular or Bold.")
    ext = ext.lower().lstrip(".")
    if ext not in ("ttf", "otf"):
        raise ValueError("Upload a .ttf or .otf file.")
    # TrueType / OpenType magic: 00 01 00 00, 'true', 'OTTO'
    if data[:4] not in (b"\x00\x01\x00\x00", b"true", b"OTTO"):
        raise ValueError("That file is not a TrueType/OpenType font.")
    FONTS_DIR.mkdir(parents=True, exist_ok=True)
    stem = family.replace(" ", "_")
    for stale in FONTS_DIR.glob(f"{stem}-{face}.*"):
        stale.unlink()
    path = FONTS_DIR / f"{stem}-{face}.{ext}"
    path.write_bytes(data)
    return path


# ── Logos ───────────────────────────────────────────────────────────────────

_PNG = b"\x89PNG\r\n\x1a\n"


def save_logo(kind: str, data: bytes) -> str:
    if kind not in ("light", "dark"):
        raise ValueError("Logo kind must be light or dark.")
    if not data.startswith(_PNG):
        raise ValueError("Logos must be PNG files (transparent background recommended).")
    if len(data) > 2 * 1024 * 1024:
        raise ValueError("Logo files are capped at 2 MB.")
    BRAND_DIR.mkdir(parents=True, exist_ok=True)
    name = f"logo-{kind}.png"
    (BRAND_DIR / name).write_bytes(data)
    return name


def logo_path(kind: str) -> Path | None:
    """The mark for a light or dark ground: uploaded file, else PMI's for the light ground."""
    t = current()
    name = t.logo_light if kind == "light" else t.logo_dark
    if name:
        p = BRAND_DIR / Path(name).name
        if p.is_file():
            return p
    if kind == "light" and IS_PMI:
        pmi = Path(__file__).resolve().parent.parent / "assets" / "spaceman-black.png"
        return pmi if pmi.is_file() else None
    return None


# ── Derived views ───────────────────────────────────────────────────────────

def hex_to_hsl_css(hex6: str) -> str:
    """'E8000D' → '357 100% 45%' (the form index.css uses)."""
    r, g, b = (int(hex6[i : i + 2], 16) / 255 for i in (0, 2, 4))
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    return f"{round(h * 360)} {round(s * 100)}% {round(l * 100)}%"


def contrast_ratio(fg: str, bg: str) -> float:
    def lum(hex6: str) -> float:
        def ch(c: int) -> float:
            v = c / 255
            return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
        r, g, b = (int(hex6[i : i + 2], 16) for i in (0, 2, 4))
        return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
    a, b = lum(fg), lum(bg)
    hi, lo = max(a, b), min(a, b)
    return round((hi + 0.05) / (lo + 0.05), 2)


def deck_theme():
    """A DeckTheme carrying these tokens (identical to DEFAULT_THEME for PMI)."""
    from services.decks.theme import DEFAULT_THEME, Fonts, Palette

    t = current()
    return replace(
        DEFAULT_THEME,
        name=t.deck_name or DEFAULT_THEME.name,
        palette=replace(
            DEFAULT_THEME.palette,
            background=t.dark_background,
            card=t.dark_card,
            primary=t.dark_text,
            body=t.dark_body,
            caption=t.muted,
            accent=t.accent,
        ),
        fonts=Fonts(display=t.font_display, mono=t.font_mono),
    )


def public_view() -> dict[str, Any]:
    """What the frontend needs before and after sign-in (no file paths)."""
    t = current()
    return {
        "source": source(),
        "app_accent": t.app_accent,
        "app_accent_hsl": hex_to_hsl_css(t.app_accent),
        "font_display": t.font_display,
        "font_mono": t.font_mono,
        "logo_light": bool(logo_path("light")),
        "logo_dark": bool(logo_path("dark")),
    }
