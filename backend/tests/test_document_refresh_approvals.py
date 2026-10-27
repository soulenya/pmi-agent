"""A changed Drive source becomes an approval, not just a bell notification.

The owner sees it in the Approvals tab (and so on Today), decides once, and
whichever surface they decide on — the card or the Documents page — leaves
the other with nothing left to offer.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.approval import ApprovalIntent
from models.db.document import Document
from models.db.notification import Notification
from models.db.user import User
from services.auth.service import hash_password
from services.documents import sync

BASELINE = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)


async def _user(db: AsyncSession) -> User:
    user = User(
        email=f"kb-{uuid.uuid4().hex[:8]}@pmi.local",
        display_name="KB owner",
        hashed_password=hash_password("TestPassword1!"),
        role="user",
        is_active=True,
    )
    db.add(user)
    await db.flush()
    return user


async def _linked_doc(db: AsyncSession, owner: User) -> Document:
    doc = Document(
        title="Supplier agreement",
        source_type="google_drive",
        source_id=f"drive-{uuid.uuid4().hex[:10]}",
        source_name="Supplier agreement.docx",
        source_modified_at=BASELINE,
        sync_status="current",
        status="ready",
        created_by=owner.id,
    )
    db.add(doc)
    await db.flush()
    return doc


def _meta(doc: Document, *, modified: datetime, name: str | None = None) -> dict:
    return {
        "id": doc.source_id,
        "name": name or doc.source_name,
        "mimeType": "application/vnd.google-apps.document",
        "modified": modified.isoformat().replace("+00:00", "Z"),
        "modified_by": "Lindsey",
        "trashed": False,
        "url": f"https://docs.google.com/document/d/{doc.source_id}/edit",
        "parents": [],
    }


async def _pending(db: AsyncSession, doc: Document) -> list[ApprovalIntent]:
    return list(
        (
            await db.execute(
                select(ApprovalIntent).where(
                    ApprovalIntent.intent_type == "refresh_document",
                    ApprovalIntent.status == "pending",
                    ApprovalIntent.intent_payload["document_id"].astext == str(doc.id),
                )
            )
        ).scalars()
    )


@pytest.fixture
def drive(monkeypatch):
    """Stand-in for Drive: tests set `drive.meta` per file id."""
    state = {"meta": {}}
    monkeypatch.setattr(sync.gs, "get_credentials", lambda: object())
    monkeypatch.setattr(sync.gs, "drive_get_metadata", lambda fid: state["meta"].get(fid))
    return state


@pytest.mark.asyncio
async def test_modified_source_raises_one_approval_with_the_change_in_it(
    db_session: AsyncSession, drive
):
    owner = await _user(db_session)
    doc = await _linked_doc(db_session, owner)
    drive["meta"][doc.source_id] = _meta(doc, modified=BASELINE + timedelta(days=1))

    summary = await sync.check_document_updates(db_session, owner.id)

    assert summary["changed"] == 1
    item = summary["items"][0]
    assert item["notify"] is True and item["approval_id"]

    pending = await _pending(db_session, doc)
    assert len(pending) == 1
    intent = pending[0]
    assert intent.user_id == owner.id
    assert intent.intent_title == "Update Supplier agreement from Google Drive"
    assert intent.intent_payload["sync_status"] == "modified"
    assert intent.intent_payload["modified_by"] == "Lindsey"
    assert intent.intent_payload["source_url"].startswith("https://docs.google.com/")

    # The approval surfaces in the bell too, pointing at itself.
    notif = (
        await db_session.execute(
            select(Notification).where(
                Notification.entity_type == "approval_intent",
                Notification.entity_id == intent.id,
            )
        )
    ).scalar_one()
    assert notif.type == "approval_required"
    assert notif.user_id == owner.id


@pytest.mark.asyncio
async def test_repeat_scans_do_not_stack_approvals(db_session: AsyncSession, drive):
    owner = await _user(db_session)
    doc = await _linked_doc(db_session, owner)
    drive["meta"][doc.source_id] = _meta(doc, modified=BASELINE + timedelta(days=1))

    await sync.check_document_updates(db_session, owner.id)
    second = await sync.check_document_updates(db_session, owner.id)
    third = await sync.check_document_updates(db_session, owner.id)

    assert second["items"][0]["notify"] is False
    assert third["items"][0]["notify"] is False
    assert len(await _pending(db_session, doc)) == 1


@pytest.mark.asyncio
async def test_dismissing_on_the_documents_page_closes_the_approval(
    db_session: AsyncSession, drive
):
    owner = await _user(db_session)
    doc = await _linked_doc(db_session, owner)
    later = BASELINE + timedelta(days=1)
    drive["meta"][doc.source_id] = _meta(doc, modified=later)
    await sync.check_document_updates(db_session, owner.id)
    intent = (await _pending(db_session, doc))[0]

    doc = await sync.dismiss_document_update(db_session, doc.id, resolved_by=owner.id)

    assert doc.sync_status == "current"
    assert doc.source_modified_at == later  # re-baselined
    await db_session.refresh(intent)
    assert intent.status == "rejected"
    assert intent.resolved_by == owner.id
    assert await _pending(db_session, doc) == []

    notif = (
        await db_session.execute(
            select(Notification).where(Notification.entity_id == intent.id)
        )
    ).scalar_one()
    assert notif.is_read is True

    # Nothing changed since the re-baseline, so the next scan is quiet.
    again = await sync.check_document_updates(db_session, owner.id)
    assert again["changed"] == 0
    assert await _pending(db_session, doc) == []


@pytest.mark.asyncio
async def test_a_second_change_after_dismissal_asks_again(db_session: AsyncSession, drive):
    owner = await _user(db_session)
    doc = await _linked_doc(db_session, owner)
    drive["meta"][doc.source_id] = _meta(doc, modified=BASELINE + timedelta(days=1))
    await sync.check_document_updates(db_session, owner.id)
    await sync.dismiss_document_update(db_session, doc.id, resolved_by=owner.id)

    drive["meta"][doc.source_id] = _meta(doc, modified=BASELINE + timedelta(days=2))
    summary = await sync.check_document_updates(db_session, owner.id)

    assert summary["items"][0]["notify"] is True
    assert len(await _pending(db_session, doc)) == 1


@pytest.mark.asyncio
async def test_removed_source_still_asks_and_says_so(db_session: AsyncSession, drive):
    owner = await _user(db_session)
    doc = await _linked_doc(db_session, owner)
    drive["meta"][doc.source_id] = None  # 404 from Drive

    await sync.check_document_updates(db_session, owner.id)

    intent = (await _pending(db_session, doc))[0]
    assert intent.intent_payload["sync_status"] == "deleted"
    assert "removed" in (intent.intent_description or "")


@pytest.mark.asyncio
async def test_settle_is_a_no_op_without_an_open_approval(db_session: AsyncSession):
    assert await sync.settle_refresh_approvals(db_session, uuid.uuid4(), approved=True) == 0
