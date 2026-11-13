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
