"""Render an archetype onto a live Google Slides slide.

The fourteen layouts live in pptx_builder and stay there. Rather than write them
a second time against the Slides API — two implementations that would drift
apart on the first change — this records what a renderer draws and replays it as
Slides requests.

The recording objects below imitate just enough of python-pptx for the
renderers to run unchanged: three creation calls (add_shape, add_textbox,
add_picture) and the attribute chains the writer sets on the results. If a
renderer ever reaches for something new, it fails loudly here instead of
silently dropping part of a slide.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from services.decks.pptx_builder import _SlideWriter, _RENDERERS
from services.decks.theme import EMU_PER_INCH, DeckTheme

logger = logging.getLogger(__name__)

# python-pptx alignment enum -> Slides alignment.
_ALIGN = {1: "START", 2: "CENTER", 3: "END", 4: "JUSTIFIED"}


@dataclass
class Run:
    text: str = ""
    font_name: str = ""
    size_pt: float = 0.0
    bold: bool = False
    colour: str = ""


@dataclass
class DrawnText:
    left: float
    top: float
    width: float
    height: float
    runs: list[Run] = field(default_factory=list)
    align: str = "START"
    line_spacing_pt: float = 0.0


@dataclass
class DrawnRect:
    left: float
    top: float
    width: float
    height: float
    fill: str = ""


@dataclass
class DrawnPicture:
    left: float
    top: float
    width: float
    height: float
    path: str = ""


class _Colour:
    def __init__(self):
        self.rgb = None

    def value(self) -> str:
        return str(self.rgb) if self.rgb is not None else ""


class _Fill:
    def __init__(self):
        self.fore_color = _Colour()
        self._mode = ""

    def solid(self):
        self._mode = "solid"

    def background(self):
        self._mode = "none"


class _Line:
    def __init__(self):
        self.fill = _Fill()


class _Shadow:
    inherit = True


class _Font:
    def __init__(self):
        self.name = ""
        self.size = None
        self.bold = False
        self.color = _Colour()


class _Run:
    def __init__(self):
        self.text = ""
        self.font = _Font()


class _Paragraph:
    def __init__(self):
        self.alignment = None
        self.line_spacing = None
        self.runs: list[_Run] = []

    def add_run(self) -> _Run:
        run = _Run()
        self.runs.append(run)
        return run


class _TextFrame:
    def __init__(self):
        self.word_wrap = True
        self.auto_size = None
        self.margin_left = self.margin_right = 0
        self.margin_top = self.margin_bottom = 0
        self.vertical_anchor = None
        self.paragraphs = [_Paragraph()]


class _Shape:
    """A recorded shape. `kind` decides how it is replayed."""

    def __init__(self, kind: str, left, top, width, height):
        self.kind = kind
        self.box = (left, top, width, height)
        self.fill = _Fill()
        self.line = _Line()
        self.shadow = _Shadow()
        self.text_frame = _TextFrame()


class _Shapes:
    def __init__(self):
        self.items: list[_Shape | DrawnPicture] = []

    def add_shape(self, _auto_shape_type, left, top, width, height) -> _Shape:
        shape = _Shape("rect", left, top, width, height)
        self.items.append(shape)
        return shape

    def add_textbox(self, left, top, width, height) -> _Shape:
        shape = _Shape("text", left, top, width, height)
        self.items.append(shape)
        return shape

    def add_picture(self, path, left, top, width=None, height=None):
        pic = DrawnPicture(left, top, width or 0, height or 0, str(path))
        self.items.append(pic)
        return pic


class _Background:
    def __init__(self):
        self.fill = _Fill()


class _RecordingSlide:
    def __init__(self):
        self.shapes = _Shapes()
        self.background = _Background()


def _emu_to_in(v) -> float:
    return float(int(v)) / EMU_PER_INCH


def record(archetype: str, data: dict[str, Any], theme: DeckTheme,
           *, page_no: int | None, classification: str) -> list[Any]:
    """Run a real renderer against a recording slide. Returns draw operations."""
    renderer = _RENDERERS.get(archetype)
    if renderer is None:
        raise KeyError(archetype)

    slide = _RecordingSlide()
    writer = _SlideWriter(slide, theme)
    writer.chrome(page_no, classification)
    renderer(writer, data)

    ops: list[Any] = []
    for item in slide.shapes.items:
        if isinstance(item, DrawnPicture):
            ops.append(DrawnPicture(
                _emu_to_in(item.left), _emu_to_in(item.top),
                _emu_to_in(item.width), _emu_to_in(item.height), item.path,
            ))
            continue
        left, top, width, height = (_emu_to_in(v) for v in item.box)
        if item.kind == "rect":
            ops.append(DrawnRect(left, top, width, height,
                                 item.fill.fore_color.value()))
            continue
        para = item.text_frame.paragraphs[0]
        runs = [
            Run(r.text, r.font.name,
                round(r.font.size.pt, 2) if r.font.size is not None else 0.0,
                bool(r.font.bold), r.font.color.value())
            for r in para.runs if r.text
        ]
        if not runs:
            continue
        ops.append(DrawnText(
            left, top, width, height, runs,
            _ALIGN.get(int(para.alignment) if para.alignment is not None else 1, "START"),
            round(para.line_spacing.pt, 2) if para.line_spacing is not None else 0.0,
        ))
    return ops


def _rgb(hex_colour: str) -> dict:
    h = (hex_colour or "000000").lstrip("#")
    return {"rgbColor": {
        "red": int(h[0:2], 16) / 255,
        "green": int(h[2:4], 16) / 255,
        "blue": int(h[4:6], 16) / 255,
    }}


def _emu(v: float) -> int:
    return int(round(v * EMU_PER_INCH))


# The page id is unknown until createSlide runs, so requests carry a token that
# google_service swaps for the real id.
PAGE_TOKEN = "__LG_PAGE__"


def _element_properties(page_id: str, op) -> dict:
    return {
        "pageObjectId": page_id,
        "size": {
            "width": {"magnitude": _emu(op.width), "unit": "EMU"},
            "height": {"magnitude": _emu(op.height), "unit": "EMU"},
        },
        "transform": {
            "scaleX": 1, "scaleY": 1,
            "translateX": _emu(op.left), "translateY": _emu(op.top),
            "unit": "EMU",
        },
    }


def to_requests(ops: list[Any], page_id: str, prefix: str) -> list[dict]:
    """Translate recorded draw operations into Slides batchUpdate requests.

    Shapes are emitted in recording order, which is the order the renderer drew
    them — cards before the text that sits on them.
    """
    requests: list[dict] = []
    for i, op in enumerate(ops):
        object_id = f"{prefix}{i:03d}"
        if isinstance(op, DrawnPicture):
            # Only a fetchable URL can be placed; a local path cannot.
            if op.path.lower().startswith(("http://", "https://")):
                requests.append({"createImage": {
                    "objectId": object_id,
                    "url": op.path,
                    "elementProperties": _element_properties(page_id, op),
                }})
            continue
        if isinstance(op, DrawnRect):
            requests.append({"createShape": {
                "objectId": object_id,
                "shapeType": "RECTANGLE",
                "elementProperties": _element_properties(page_id, op),
            }})
            requests.append({"updateShapeProperties": {
                "objectId": object_id,
                "shapeProperties": {
                    "shapeBackgroundFill": {"solidFill": {"color": _rgb(op.fill)}},
                    "outline": {"propertyState": "NOT_RENDERED"},
                },
                "fields": "shapeBackgroundFill.solidFill.color,outline.propertyState",
            }})
            continue

        requests.append({"createShape": {
            "objectId": object_id,
            "shapeType": "TEXT_BOX",
            "elementProperties": _element_properties(page_id, op),
        }})
        # One insertText for the whole paragraph, then style each run by range —
        # inserting run by run would renumber the offsets underneath us.
        body = "".join(r.text for r in op.runs)
        requests.append({"insertText": {
            "objectId": object_id, "insertionIndex": 0, "text": body,
        }})
        start = 0
        for run in op.runs:
            end = start + len(run.text)
            requests.append({"updateTextStyle": {
                "objectId": object_id,
                "textRange": {"type": "FIXED_RANGE", "startIndex": start, "endIndex": end},
                "style": {
                    "fontFamily": run.font_name,
                    "bold": run.bold,
                    "fontSize": {"magnitude": run.size_pt, "unit": "PT"},
                    "foregroundColor": {"opaqueColor": _rgb(run.colour)},
                },
                "fields": "fontFamily,bold,fontSize,foregroundColor",
            }})
            start = end
        style: dict[str, Any] = {"alignment": op.align}
        fields = ["alignment"]
        if op.line_spacing_pt and op.runs:
            # Slides takes lineSpacing as a percentage of the font size, while
            # the .pptx path must write absolute points. Convert rather than
            # copying the number across.
            largest = max(r.size_pt for r in op.runs) or op.runs[0].size_pt
            if largest:
                style["lineSpacing"] = round(op.line_spacing_pt / largest * 100, 1)
                fields.append("lineSpacing")
        requests.append({"updateParagraphStyle": {
            "objectId": object_id,
            "textRange": {"type": "ALL"},
            "style": style,
            "fields": ",".join(fields),
        }})
        requests.append({"updateShapeProperties": {
            "objectId": object_id,
            "shapeProperties": {"autofit": {"autofitType": "NONE"}},
            "fields": "autofit.autofitType",
        }})
    return requests
