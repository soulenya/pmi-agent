"""Charts: spec validation, PNG rendering, and inline embedding in create_docx.

Gerry had no way to draw a chart and fell back to block characters. The
renderer is exercised for real (matplotlib Agg, no display needed); the docx
test checks the image part actually lands in the package.
"""
from __future__ import annotations

import uuid
import zipfile

import pytest

from services import charts

COLUMN = {
    "type": "column", "title": "Burn vs plan", "unit": "$",
    "categories": ["Jul", "Aug", "Sep"],
    "series": [{"name": "Plan", "values": [120, 125, 130]}, {"name": "Actual", "values": ["118", "1,400", 127.5]}],
}


def test_validate_normalises_numbers_and_defaults():
    s = charts.validate_spec(COLUMN)
    assert s["series"][1]["values"] == [118.0, 1400.0, 127.5]
    assert s["show_values"] is True and s["y_min"] is None
    assert charts.validate_spec({**COLUMN, "type": "line"})["show_values"] is False


@pytest.mark.parametrize("bad, msg", [
    ({**COLUMN, "type": "radar"}, "not one of"),
    ({**COLUMN, "series": []}, "needs 'series'"),
    ({**COLUMN, "categories": []}, "needs 'categories'"),
    ({**COLUMN, "series": [{"name": "A", "values": [1, 2]}]}, "2 values but there are 3 categories"),
    ({**COLUMN, "series": [{"name": "A", "values": [1, "x", 3]}]}, "is not a number"),
    ({**COLUMN, "type": "pie"}, "exactly one series"),
    ({"type": "pie", "categories": ["a"], "series": [{"name": "s", "values": [-1]}]}, "cannot be negative"),
    ({"type": "scatter", "series": [{"name": "s", "values": [1]}]}, "needs 'points'"),
    ({"type": "scatter", "series": [{"name": "s", "points": [[1]]}]}, "must be \\[x, y\\]"),
    ("nope", "must be an object"),
])
def test_validate_rejects_with_actionable_message(bad, msg):
    with pytest.raises(ValueError, match=msg):
        charts.validate_spec(bad)


@pytest.mark.parametrize("ctype", charts.CHART_TYPES)
def test_every_type_renders_a_png(ctype):
    if ctype == "scatter":
        spec = {"type": ctype, "title": "t", "series": [{"name": "a", "points": [[1, 2], [3, 4]]}]}
    elif ctype == "pie":
        spec = {"type": ctype, "title": "t", "categories": ["a", "b"], "series": [{"name": "s", "values": [3, 1]}]}
    else:
        spec = {**COLUMN, "type": ctype, "subtitle": "sub", "x_label": "x", "y_label": "y", "source": "src"}
    png = charts.render_png(charts.validate_spec(spec), width_in=4, height_in=2.5, dpi=72)
    assert png[:8] == b"\x89PNG\r\n\x1a\n" and len(png) > 2000


def test_fmt_units():
    assert charts._fmt(1500, "$") == "$1,500"
    assert charts._fmt(12.5, "%") == "12.5%"
    assert charts._fmt(7, "kPa") == "7 kPa"
    assert charts._fmt(3, "") == "3"


@pytest.mark.asyncio
async def test_create_docx_embeds_chart_block_and_flags_bad_one(db_session, test_user, monkeypatch):
    from services.agent import tools
    from services.agent.tools import ToolContext

    async def _noop(*a, **k):
        return None

    monkeypatch.setattr("services.workroom_context.auto_pin_if_room", _noop)
    monkeypatch.setattr("services.workroom_context.log_room_event", _noop)
    ctx = ToolContext(db=db_session, user_id=test_user.id, conversation_id=uuid.uuid4(), embedding_service=None)
    content = (
        "# Results\n\nIntro paragraph.\n\n```chart\n"
        '{"type": "column", "title": "Burn", "categories": ["Jul", "Aug"], '
        '"series": [{"name": "Plan", "values": [1, 2]}]}\n```\n\nAfter.\n\n'
        "```chart\n{not json\n```\n"
    )
    out = await tools.execute_create_docx(ctx, {"filename": "chart-test.docx", "title": "T", "content": content})
    assert "Word document created and verified" in out
    assert "Charts embedded: 1." in out and "1 chart block(s) could NOT be rendered" in out
    safe = out.split("/api/files/")[1].split()[0]
    path = tools._GENERATED_FILES_DIR / safe
    with zipfile.ZipFile(path) as z:
        media = [n for n in z.namelist() if n.startswith("word/media/") and n.endswith(".png")]
        doc_xml = z.read("word/document.xml").decode("utf-8")
    assert len(media) == 1
    assert "[chart not rendered:" in doc_xml and "After." in doc_xml
    path.unlink()
