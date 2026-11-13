"""edit_drive_file mode add_tab on a Google Sheet.

Gerry could set cells and append rows to a granted Sheet but not add a
worksheet, so a request for a multi-tab sheet was refused. Google calls are
stubbed; the grant and dispatch are real.
"""
from __future__ import annotations

import pytest

from services import drive_edit
from services import google_service as gs


@pytest.fixture
def sheet(monkeypatch):
    calls: list[tuple] = []
    monkeypatch.setattr(
        drive_edit, "_meta",
        lambda fid: _coro({"mimeType": drive_edit.SHEET_MIME, "name": "Vendor Tracker"}),
    )
    monkeypatch.setattr(drive_edit, "write_access_missing", lambda: None)
    monkeypatch.setattr(gs, "sheets_add_tab", lambda sid, title, frozen_rows=0: calls.append(("add_tab", title, frozen_rows)))
    monkeypatch.setattr(gs, "sheets_update_range", lambda sid, rng, values: calls.append(("update", rng, values)))
    monkeypatch.setattr(gs, "sheets_bold_header", lambda sid, title: calls.append(("bold", title)))
    monkeypatch.setattr(gs, "sheets_set_dropdown", lambda sid, rng, opts, strict=True: (calls.append(("dropdown", rng, opts, strict)), 12)[1])
    monkeypatch.setattr(gs, "sheets_move_tab", lambda sid, title, pos: (calls.append(("move", title, pos)), ["B", "A", "C"])[1])
    return calls


async def _coro(v):
    return v


@pytest.mark.asyncio
async def test_add_tab_with_rows_creates_fills_and_formats(db_session, test_user, sheet):
    await drive_edit.grant(db_session, test_user.id, "S1", file_name="Vendor Tracker")
    out = await drive_edit.apply_edit(
        db_session, test_user.id, "S1", "add_tab",
        text="Q4 Orders",
        values=[["PO", "Vendor", "Amount"], ["1001", "Northwind", 250]],
    )
    assert sheet == [
        ("add_tab", "Q4 Orders", 1),
        ("update", "'Q4 Orders'!A1", [["PO", "Vendor", "Amount"], ["1001", "Northwind", 250]]),
        ("bold", "Q4 Orders"),
    ]
    assert 'added tab "Q4 Orders" with 2 row(s)' in out


@pytest.mark.asyncio
async def test_add_tab_without_rows_is_empty_and_unfrozen(db_session, test_user, sheet):
    await drive_edit.grant(db_session, test_user.id, "S2")
    out = await drive_edit.apply_edit(db_session, test_user.id, "S2", "add_tab", text="Notes")
    assert sheet == [("add_tab", "Notes", 0)]
    assert 'added empty tab "Notes"' in out


@pytest.mark.asyncio
async def test_add_tab_needs_a_name_and_a_grant(db_session, test_user, sheet):
    with pytest.raises(drive_edit.DriveEditError, match="No edit permission"):
        await drive_edit.apply_edit(db_session, test_user.id, "S3", "add_tab", text="X")
    await drive_edit.grant(db_session, test_user.id, "S3")
    with pytest.raises(drive_edit.DriveEditError, match="needs the new tab's name"):
        await drive_edit.apply_edit(db_session, test_user.id, "S3", "add_tab", text="  ")
    assert sheet == []


@pytest.mark.asyncio
async def test_duplicate_tab_name_is_a_readable_refusal(db_session, test_user, sheet, monkeypatch):
    def _dup(sid, title, frozen_rows=0):
        raise ValueError(f"A tab named '{title}' already exists in this spreadsheet.")

    monkeypatch.setattr(gs, "sheets_add_tab", _dup)
    await drive_edit.grant(db_session, test_user.id, "S4")
    with pytest.raises(drive_edit.DriveEditError, match="already exists"):
        await drive_edit.apply_edit(db_session, test_user.id, "S4", "add_tab", text="Ledger")
    assert sheet == []  # no fill attempted after the refused add


# ── set_dropdown / move_tab ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_set_dropdown_passes_options_and_strictness(db_session, test_user, sheet):
    await drive_edit.grant(db_session, test_user.id, "S5")
    out = await drive_edit.apply_edit(
        db_session, test_user.id, "S5", "set_dropdown",
        cell_range="'Tasks'!D2:D13", values=[["Open", "Blocked", "Done"]],
    )
    assert sheet == [("dropdown", "'Tasks'!D2:D13", ["Open", "Blocked", "Done"], True)]
    assert "dropdown (Open, Blocked, Done) on 12 cell(s)" in out

    sheet.clear()
    await drive_edit.apply_edit(
        db_session, test_user.id, "S5", "set_dropdown",
        cell_range="Tasks!D:D", values=[["Yes"], ["No"]], all_occurrences=True,  # column-wise options, non-strict
    )
    assert sheet == [("dropdown", "Tasks!D:D", ["Yes", "No"], False)]


@pytest.mark.asyncio
async def test_set_dropdown_needs_range_and_options(db_session, test_user, sheet):
    await drive_edit.grant(db_session, test_user.id, "S6")
    with pytest.raises(drive_edit.DriveEditError, match="needs cell_range"):
        await drive_edit.apply_edit(db_session, test_user.id, "S6", "set_dropdown", values=[["a"]])
    with pytest.raises(drive_edit.DriveEditError, match="needs the options"):
        await drive_edit.apply_edit(db_session, test_user.id, "S6", "set_dropdown", cell_range="T!A1:A2")
    assert sheet == []


@pytest.mark.asyncio
async def test_move_tab_reports_new_order(db_session, test_user, sheet):
    await drive_edit.grant(db_session, test_user.id, "S7")
    out = await drive_edit.apply_edit(db_session, test_user.id, "S7", "move_tab", text="B", position=1)
    assert sheet == [("move", "B", 1)]
    assert 'moved tab "B" to position 1; tabs are now: B, A, C' in out
    with pytest.raises(drive_edit.DriveEditError, match="needs the tab name"):
        await drive_edit.apply_edit(db_session, test_user.id, "S7", "move_tab", text="B")


def test_parse_a1_range():
    assert gs.parse_a1_range("'My Tab'!B2:B100") == ("My Tab", 1, 2, 1, 100)
    assert gs.parse_a1_range("Tasks!D:D") == ("Tasks", 3, 4, None, None)
    assert gs.parse_a1_range("T!AA1:AB1") == ("T", 26, 28, 0, 1)
    assert gs.parse_a1_range("T!C5:A2") == ("T", 0, 3, 1, 5)  # reversed corners normalised
    for bad in ("B2:B100", "T!B2:B", "T!2:5", ""):
        with pytest.raises(ValueError):
            gs.parse_a1_range(bad)


def test_move_tab_index_math(monkeypatch):
    """The Sheets API indexes the destination before removal; moving right needs +1."""
    sent: list[dict] = []

    class _Svc:
        def spreadsheets(self):
            return self
        def get(self, **kw):
            return self
        def batchUpdate(self, **kw):  # noqa: N802 — mirrors the Google client
            sent.append(kw["body"]["requests"][0]["updateSheetProperties"]["properties"])
            return self
        def execute(self):
            return {"sheets": [{"properties": {"title": t, "sheetId": i, "index": i}} for i, t in enumerate("ABC")]}

    monkeypatch.setattr(gs, "_build", lambda *a: _Svc())
    assert gs.sheets_move_tab("x", "A", 3) == ["B", "C", "A"] and sent[-1]["index"] == 3   # right: +1
    assert gs.sheets_move_tab("x", "C", 1) == ["C", "A", "B"] and sent[-1]["index"] == 0   # left: as-is
    assert gs.sheets_move_tab("x", "b", 2) == ["A", "B", "C"] and sent[-1]["index"] == 1   # no-op, case-insensitive
    with pytest.raises(ValueError, match="tabs are: A, B, C"):
        gs.sheets_move_tab("x", "Z", 1)
    with pytest.raises(ValueError, match="between 1 and 3"):
        gs.sheets_move_tab("x", "A", 4)
