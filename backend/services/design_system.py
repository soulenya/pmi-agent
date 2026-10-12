"""Precisian Medical design system — the look Gerry gives the files she makes.

Source: "Precisian Medical Instruments — Design System" (readme.md,
tokens/colors.css, tokens/typography.css). Decks already carry it through
``services.decks.theme``; this module brings Word output into line.

Two document styles exist:

- ``brand`` — the design system. Archivo for display and body, JetBrains Mono
  for everything machine-adjacent (eyebrows, indices, header/footer, table
  labels), black and white with the one red ``#FF0000``, rows separated by
  hairlines rather than boxes. Fonts are embedded so the file renders the
  same on a machine that does not have them installed.
- ``controlled`` — the plain controlled-document styling kept for anything
  FDA, QMS, risk-management or regulatory. These are governed by their own
  templates and the design system is deliberately not applied to them.

:func:`resolve_doc_style` picks between the two: an explicit request wins;
otherwise the filename, title and banner text are checked against the
controlled-document vocabulary.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from pathlib import Path

BRAND = "brand"
CONTROLLED = "controlled"
DOC_STYLES = (BRAND, CONTROLLED)

ASSETS_DIR = Path(__file__).resolve().parent.parent / "assets"
FONTS_DIR = ASSETS_DIR / "fonts"


@dataclass(frozen=True)
class Tokens:
    """Colours (hex, no #) and type for a document on the light/print surface."""

    font_display: str = "Archivo"
    font_mono: str = "JetBrains Mono"

    black: str = "000000"
    white: str = "FFFFFF"
    red: str = "FF0000"          # --red-500, never tinted
    ink_500: str = "333333"      # --text-body-inverse: body text on white
    ink_300: str = "6F6F6F"      # --text-muted
    ink_200: str = "9B9B9B"
    hairline: str = "E0E0E0"     # --border-hairline-inverse (12% black on white)

    body_pt: float = 10.5
    title_pt: float = 26.0
    h1_pt: float = 16.0
    h2_pt: float = 13.0
    h3_pt: float = 11.0
    mono_pt: float = 8.0         # eyebrows, indices, table labels
    chrome_pt: float = 7.5       # page header / footer

    # Character spacing in twentieths of a point: -0.035em on display type,
    # 0.16em on mono labels (the system's tracking tokens).
    display_tracking_twips: int = -18
    mono_tracking_twips: int = 24


TOKENS = Tokens()


# Vocabulary of controlled documents. Matched against filename, title and
# banner text — never against the body, where a weekly update legitimately
# says "regulatory" or "risk".
_CONTROLLED_RE = re.compile(
    r"""
    \b(
        fda | qms | qsr | mdsap | mdr | ivdr | udi | ifu | cer | ncr | capa | sop |
        dhf | dmr | dhr | fmea | dfmea | pfmea | hazard \s+ analysis |
        iso \s* 1348[5] | iso \s* 14971 | iec \s* 6060[1] | iec \s* 62304 | iso \s* 10993 |
        iso \s* 1007[9] | 21 \s* cfr | part \s+ 820 | part \s+ 11 |
        510 \s* \(? \s* k \s* \)? | pma | de \s+ novo | ide \b | q-?sub |
        regulatory | notified \s+ body | ce \s+ mark(ing)? |
        risk \s+ (management|analysis|assessment|control|plan|report|file|matrix) |
        design \s+ (control|history|verification|validation|review|input|output|transfer|plan) |
        quality \s+ (manual|system|plan|policy|procedure|agreement|record) |
        technical \s+ (file|documentation) | essential \s+ principles | gspr |
        declaration \s+ of \s+ conformity | complaint \s+ handling | nonconform\w* |
        clinical \s+ evaluation | biocompatib\w* | usability \s+ engineering |
        (verification|validation|test) \s+ (protocol|report|plan) |
        work \s+ instruction | standard \s+ operating \s+ procedure |
        audit \s+ (plan|report|checklist|finding) | supplier \s+ (control|qualification) |
        device \s+ master | design \s+ history | labell?ing \s+ (spec|procedure|review)
    )\b
    """,
    re.IGNORECASE | re.VERBOSE,
)


def is_controlled(*texts: str) -> bool:
    """True when any of the given names/titles reads as a controlled document."""
    return any(_CONTROLLED_RE.search(t or "") for t in texts)


def resolve_doc_style(requested: str | None, *texts: str) -> str:
    """Explicit ``brand``/``controlled`` wins; otherwise detect from the names."""
    want = (requested or "").strip().lower()
    if want in DOC_STYLES:
        return want
    return CONTROLLED if is_controlled(*texts) else BRAND


# ── Font embedding ──────────────────────────────────────────────────────────

_FONT_FILES: dict[str, dict[str, str]] = {
    "Archivo": {"Regular": "Archivo-Regular.ttf", "Bold": "Archivo-Bold.ttf"},
    "JetBrains Mono": {"Regular": "JetBrainsMono-Regular.ttf", "Bold": "JetBrainsMono-Bold.ttf"},
}
_FONT_FAMILY_CLASS = {"Archivo": ("swiss", "variable"), "JetBrains Mono": ("modern", "fixed")}

_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
_ODTTF_CT = "application/vnd.openxmlformats-officedocument.obfuscatedFont"


def _obfuscate(data: bytes, font_key: str) -> bytes:
    """ECMA-376 font obfuscation: XOR the first 32 bytes with the GUID bytes
    in reverse order. Word de-obfuscates with the same key from ``w:fontKey``."""
    key = bytes.fromhex(font_key.strip("{}").replace("-", ""))
    out = bytearray(data)
    for i in range(min(32, len(out))):
        out[i] ^= key[15 - (i % 16)]
    return bytes(out)


def embed_fonts(document, families: tuple[str, ...] = ("Archivo", "JetBrains Mono")) -> list[str]:
    """Embed the given families (Regular + Bold) into a python-docx Document.

    Returns the families actually embedded; a family whose files are missing
    on this install is skipped so the document is still produced (Word then
    substitutes). Idempotent per document: fonts already present in the font
    table are not added twice.
    """
    from docx.opc.constants import RELATIONSHIP_TYPE as RT
    from docx.opc.packuri import PackURI
    from docx.opc.part import Part
    from docx.oxml.ns import qn
    from lxml import etree

    font_table = document.part.part_related_by(RT.FONT_TABLE)
    root = etree.fromstring(font_table.blob)
    existing = {el.get(f"{{{_W}}}name") for el in root.findall(f"{{{_W}}}font")}

    embedded: list[str] = []
    counter = sum(1 for _ in font_table.rels) + 1
    for family in families:
        files = _FONT_FILES.get(family)
        if not files:
            continue
        paths = {face: FONTS_DIR / name for face, name in files.items()}
        if not all(p.is_file() for p in paths.values()):
            continue
        if family in existing:
            font_el = next(
                el for el in root.findall(f"{{{_W}}}font") if el.get(f"{{{_W}}}name") == family
            )
            if font_el.find(f"{{{_W}}}embedRegular") is not None:
                embedded.append(family)
                continue
        else:
            font_el = etree.SubElement(root, f"{{{_W}}}font")
            font_el.set(f"{{{_W}}}name", family)
            fam, pitch = _FONT_FAMILY_CLASS.get(family, ("auto", "variable"))
            etree.SubElement(font_el, f"{{{_W}}}family").set(f"{{{_W}}}val", fam)
            etree.SubElement(font_el, f"{{{_W}}}pitch").set(f"{{{_W}}}val", pitch)
        for face in ("Regular", "Bold"):
            font_key = "{" + str(uuid.uuid4()).upper() + "}"
            blob = _obfuscate(paths[face].read_bytes(), font_key)
            part = Part(
                PackURI(f"/word/fonts/font{counter}.odttf"),
                _ODTTF_CT,
                blob,
                font_table.package,
            )
            counter += 1
            rid = font_table.relate_to(part, RT.FONT)
            embed_el = etree.SubElement(font_el, f"{{{_W}}}embed{face}")
            embed_el.set(f"{{{_R}}}id", rid)
            embed_el.set(f"{{{_W}}}fontKey", font_key)
        embedded.append(family)

    if embedded:
        font_table._blob = etree.tostring(
            root, xml_declaration=True, encoding="UTF-8", standalone=True
        )
        settings = document.settings.element
        if settings.find(qn("w:embedTrueTypeFonts")) is None:
            flag = etree.SubElement(settings, qn("w:embedTrueTypeFonts"))
            # Schema order puts embedTrueTypeFonts right after w:zoom.
            zoom = settings.find(qn("w:zoom"))
            if zoom is not None:
                zoom.addnext(flag)
            else:
                settings.insert(0, flag)
    return embedded
