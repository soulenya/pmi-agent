"""create_xlsx / create_google_form building blocks and the Drive-link chips.

Pure pieces only: the workbook writer, the Forms batchUpdate builder, and the
chip extraction from tool results. The Drive/Forms API calls themselves are
exercised live before a release, not here.
"""
from __future__ import annotations

import openpyxl
import pytest

from services.agent.tools import _xlsx_cell, artifact_links_for, build_xlsx
from services.google_service import forms_build_requests

# ── xlsx ──────────────────────────────────────────────────────────────────────

def test_build_xlsx_header_types_and_formulas(tmp_path):
    out = tmp_path / "t.xlsx"
    counts = build_xlsx(
        [
            {
                "title": "Tracker",
                "columns": ["Item", "Qty", "Unit", "Total"],
                "rows": [["Pump head", 3, "1,250.50", "=B2*C2"], ["Tubing", "12", 4.25, None]],
            },
            {"title": "Tracker", "columns": ["x"], "rows": []},  # duplicate tab name
            {"title": "Bad[name]:with/illegal*chars?and-far-too-long-a-title-for-excel", "columns": ["a"], "rows": [["1"]]},
        ],
        out,
    )
    assert counts == {"sheets": 3, "rows": 3}
    wb = openpyxl.load_workbook(out)
    assert wb.sheetnames[0] == "Tracker" and wb.sheetnames[1] == "Tracker 2"
    assert len(wb.sheetnames[2]) <= 31 and not any(ch in wb.sheetnames[2] for ch in "[]:*?/\\")
    ws = wb["Tracker"]
    assert [c.value for c in ws[1]] == ["Item", "Qty", "Unit", "Total"]
    assert ws["A1"].font.bold and ws.freeze_panes == "A2"
    assert ws["B2"].value == 3 and ws["C2"].value == 1250.5          # numeric string → number
    assert ws["B3"].value == 12 and ws["C3"].value == 4.25
    assert ws["D2"].value == "=B2*C2"                                 # formula kept
    assert ws["D3"].value is None


def test_build_xlsx_rejects_empty_or_malformed(tmp_path):
    with pytest.raises(ValueError):
        build_xlsx([], tmp_path / "a.xlsx")
    with pytest.raises(ValueError):
        build_xlsx([{"title": "S", "columns": [], "rows": []}], tmp_path / "b.xlsx")
    with pytest.raises(ValueError):
        build_xlsx([{"title": "S", "columns": ["a"], "rows": ["not-a-list"]}], tmp_path / "c.xlsx")


def test_xlsx_cell_keeps_text_that_merely_contains_digits():
    assert _xlsx_cell("SOP-011") == "SOP-011"
    assert _xlsx_cell("2026-11-13") == "2026-11-13"
    assert _xlsx_cell(True) is True
    assert _xlsx_cell("-7") == -7


# ── forms ─────────────────────────────────────────────────────────────────────

def test_forms_requests_cover_every_type_in_order():
    reqs = forms_build_requests([
        {"title": "Name", "type": "short_text", "required": True},
        {"title": "Comments", "type": "paragraph"},
        {"title": "Site", "type": "multiple_choice", "options": ["Austin", "Remote"], "other_option": True},
        {"title": "Days", "type": "checkboxes", "options": ["Mon", "Tue"]},
        {"title": "Shirt", "type": "dropdown", "options": ["S", "M"], "other_option": True},
        {"title": "Rate us", "type": "linear_scale", "low": 1, "high": 5, "low_label": "Poor", "high_label": "Great"},
        {"title": "When", "type": "date"},
        {"title": "Time", "type": "time"},
        {"title": "Part 2", "type": "section", "description": "Logistics"},
    ])
    assert [r["createItem"]["location"]["index"] for r in reqs] == list(range(9))
    items = [r["createItem"]["item"] for r in reqs]
    q = [it.get("questionItem", {}).get("question") for it in items]
    assert q[0] == {"required": True, "textQuestion": {"paragraph": False}}
    assert q[1]["textQuestion"] == {"paragraph": True}
    assert q[2]["choiceQuestion"]["type"] == "RADIO"
    assert q[2]["choiceQuestion"]["options"][-1] == {"isOther": True}
    assert q[3]["choiceQuestion"]["type"] == "CHECKBOX"
    assert q[4]["choiceQuestion"]["type"] == "DROP_DOWN"
    assert all("isOther" not in o for o in q[4]["choiceQuestion"]["options"])  # dropdown can't have Other
    assert q[5]["scaleQuestion"] == {"low": 1, "high": 5, "lowLabel": "Poor", "highLabel": "Great"}
    assert q[6]["dateQuestion"] == {"includeYear": True}
    assert q[7] == {"required": False, "timeQuestion": {}}
    assert items[8] == {"title": "Part 2", "description": "Logistics", "pageBreakItem": {}}


@pytest.mark.parametrize("bad", [
    {"title": "", "type": "short_text"},
    {"title": "x", "type": "essay"},
    {"title": "x", "type": "multiple_choice"},
    {"title": "x", "type": "checkboxes", "options": ["", "  "]},
    {"title": "x", "type": "linear_scale", "low": 2, "high": 5},
    {"title": "x", "type": "linear_scale", "low": 1, "high": 11},
    "not an object",
])
def test_forms_requests_reject_what_the_api_would(bad):
    with pytest.raises(ValueError):
        forms_build_requests([bad])


# ── chips ─────────────────────────────────────────────────────────────────────

def test_chips_for_native_google_outputs():
    docx_result = (
        "Word document created and verified (1234 bytes): /api/files/ab12cd34_Memo.docx Styled: PMI design system.\n"
        "Opened as Google Doc: 'Memo' is on Google Drive (id=1AbC). Link: https://docs.google.com/document/d/1AbC/edit"
    )
    chips = artifact_links_for("create_docx", docx_result)
    assert chips == [{"type": "artifact_link", "tool": "create_docx", "url": "https://docs.google.com/document/d/1AbC/edit", "label": "Open in Google Docs"}]

    xlsx_result = "Spreadsheet created and verified (1 sheet, 2 data rows, 99 bytes): /api/files/x_T.xlsx\nOpened as Google Sheet: 'T' is on Google Drive (id=2). Link: https://docs.google.com/spreadsheets/d/2/edit"
    assert artifact_links_for("create_xlsx", xlsx_result)[0]["label"] == "Open in Google Sheets"

    assert artifact_links_for("create_docx", "Word document created and verified (1 bytes): /api/files/a_b.docx") == []

    form_result = (
        "Google Form created and verified ('Survey', 3 questions, id=F1).\n"
        "Edit (for the user): https://docs.google.com/forms/d/F1/edit\n"
        "Share with respondents: https://docs.google.com/forms/d/e/XYZ/viewform"
    )
    labels = [(c["label"], c["url"]) for c in artifact_links_for("create_google_form", form_result)]
    assert labels == [
        ("Open the form", "https://docs.google.com/forms/d/F1/edit"),
        ("Respondent link", "https://docs.google.com/forms/d/e/XYZ/viewform"),
    ]
    assert artifact_links_for("create_google_form", "Form not created — question 1 has no title.") == []
