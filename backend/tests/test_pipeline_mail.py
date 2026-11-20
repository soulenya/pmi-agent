"""Email from the pipeline: each lead gets their own copy from the sender's Gmail, and it is recorded."""

from __future__ import annotations

from contextlib import asynccontextmanager

import httplib2
import pytest
from googleapiclient.errors import HttpError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.pipeline import PipelineLead, PipelineNote, PipelineStage
from models.db.user import User
from services import google_service as gs
from services import pipeline
from services import pipeline_mail as mail

SUBJECT = "A demo for {company}"
BODY = "Hi {first_name},\n\nWe will be near {company} next month.\n\nMorgan"


class _Gmail:
    def __init__(self) -> None:
        self.sent: list[dict] = []
        self.refuse: set[str] = set()
        self.too_fast_once: set[str] = set()

    def send(self, **kw) -> dict:
        address = kw["to"].split("<")[-1].strip(">")
        if address in self.too_fast_once:
            self.too_fast_once.discard(address)
            raise HttpError(httplib2.Response({"status": 429}), b'{"error": {"message": "Rate limit exceeded"}}')
        if address in self.refuse:
            raise RuntimeError("Invalid To header")
        self.sent.append(kw)
        return {"message_id": f"m{len(self.sent)}", "status": "sent"}


@pytest.fixture
def gmail(monkeypatch, db_session: AsyncSession) -> _Gmail:
    fake = _Gmail()

    @asynccontextmanager
    async def same_session():
        yield db_session

    monkeypatch.setattr(gs, "gmail_send", fake.send)
    monkeypatch.setattr(gs, "get_credentials", lambda: object())
    monkeypatch.setattr(gs, "gmail_profile_email", lambda: "morgan@pmi.local")
    monkeypatch.setattr(mail, "_session", same_session)
    monkeypatch.setattr(mail, "_jobs", {})
    monkeypatch.setattr(mail, "PAUSE_SECONDS", 0)
    monkeypatch.setattr(mail, "RETRY_WAIT_SECONDS", 0)
    return fake


async def _leads(db: AsyncSession) -> tuple[User, dict[str, PipelineLead]]:
    morgan = User(email="morgan@pmi.local", display_name="Morgan K", hashed_password="x", role="user", is_active=True)
    stage = PipelineStage(name="New", position=0)
    db.add_all([morgan, stage])
    await db.flush()
    rows = {
        "jo": PipelineLead(title="Test Rescue Squad", company="Test Rescue Squad", contact_name="Jo Park", email="jo@rescue.example"),
        # The same person on a second lead: one email, recorded on both.
        "jo2": PipelineLead(title="Rescue Squad, spring course", company="Test Rescue Squad", contact_name="Dr Jo Park", email="JO@rescue.example "),
        "harbor": PipelineLead(title="Harbor Fire", company="", contact_name="", email="info@harborfire.example"),
        "lee": PipelineLead(title="County EMS", company="County EMS", contact_name="Lee Tran", email="lee@county.example"),
        "none": PipelineLead(title="Walk-in at the trade show", email=""),
        "bad": PipelineLead(title="Typed it wrong", email="n/a"),
    }
    for lead in rows.values():
        lead.stage_id = stage.id
    db.add_all(rows.values())
    await db.flush()
    return morgan, rows


@pytest.mark.asyncio
async def test_everyone_gets_their_own_copy_and_each_lead_records_it(db_session: AsyncSession, gmail: _Gmail):
    morgan, rows = await _leads(db_session)
    ids = [lead.id for lead in rows.values()]

    look = await mail.preview(db_session, ids, SUBJECT, BODY)
    assert (look["recipients"], look["leads"], look["without_email"]) == (3, 4, ["Typed it wrong", "Walk-in at the trade show"])
    # Harbor Fire has no contact and no company on file: the preview says what they will read instead.
    assert look["missing"] == {"company": 1, "first_name": 1} and look["fallbacks"]["first_name"] == "there"
    assert look["sample"] == {"to": "Lee Tran <lee@county.example>", "subject": "A demo for County EMS",
                              "body": "Hi Lee,\n\nWe will be near County EMS next month.\n\nMorgan"}
    assert gmail.sent == []  # looking sends nothing

    job = await mail.start(db_session, morgan, ids, SUBJECT, BODY)
    with pytest.raises(pipeline.PipelineError, match="still being sent"):
        await mail.start(db_session, morgan, ids, SUBJECT, BODY)
    await job.task
    assert (await mail.status(db_session, morgan, job.id)) == {
        "id": job.id, "total": 3, "sent": 3, "failed": [], "done": True, "stopped": ""}

    # Three separate messages: nobody is copied on anybody else's.
    assert sorted(m["to"] for m in gmail.sent) == [
        "Dr Jo Park <JO@rescue.example>", "Lee Tran <lee@county.example>", "info@harborfire.example"]
    assert all(set(m) == {"to", "subject", "body"} for m in gmail.sent)
    by_to = {m["to"]: m for m in gmail.sent}
    # "Dr" is not a first name.
    assert by_to["Dr Jo Park <JO@rescue.example>"]["body"].startswith("Hi Jo,\n\nWe will be near Test Rescue Squad")
    assert by_to["info@harborfire.example"]["body"].startswith("Hi there,\n\nWe will be near your organization")

    notes = list((await db_session.execute(select(PipelineNote))).scalars())
    assert sorted(n.lead_id for n in notes) == sorted(rows[k].id for k in ("jo", "jo2", "harbor", "lee"))
    assert {(n.kind, n.author_name) for n in notes} == {("email", "Morgan K")}
    lee = next(n for n in notes if n.lead_id == rows["lee"].id)
    assert lee.body == "Email sent to lee@county.example: A demo for County EMS\n\nHi Lee,\n\nWe will be near County EMS next month.\n\nMorgan"


@pytest.mark.asyncio
async def test_a_refused_address_is_reported_and_the_rest_still_go(db_session: AsyncSession, gmail: _Gmail, monkeypatch):
    morgan, rows = await _leads(db_session)
    ids = [rows[k].id for k in ("jo", "harbor", "lee")]
    gmail.refuse = {"info@harborfire.example"}
    gmail.too_fast_once = {"lee@county.example"}  # Gmail says slow down once; it is tried again

    job = await mail.start(db_session, morgan, ids, SUBJECT, BODY)
    await job.task
    assert (job.sent, job.failed, job.stopped) == (2, [{"to": "info@harborfire.example", "reason": "Invalid To header"}], "")
    noted = set((await db_session.execute(select(PipelineNote.lead_id))).scalars())
    assert noted == {rows["jo"].id, rows["lee"].id}  # nothing is recorded for the one that did not go

    # When nothing is getting through, it stops rather than working down the whole list.
    monkeypatch.setattr(mail, "STOP_AFTER_FAILURES", 2)
    gmail.refuse = {"jo@rescue.example", "info@harborfire.example", "lee@county.example"}
    stuck = await mail.start(db_session, morgan, ids, SUBJECT, BODY)
    await stuck.task
    assert stuck.sent == 0 and len(stuck.failed) == 2 and stuck.stopped.startswith("Stopped after 2 failures in a row")


@pytest.mark.asyncio
async def test_a_test_goes_only_to_the_sender_and_sending_needs_gmail(client, auth_headers, db_session: AsyncSession, gmail: _Gmail, monkeypatch):
    _, rows = await _leads(db_session)
    body = {"lead_ids": [str(rows["lee"].id), str(rows["jo"].id)], "subject": SUBJECT, "body": BODY}

    tried = await client.post("/pipeline/email/test", headers=auth_headers, json=body)
    assert tried.status_code == 200 and tried.json()["sent_to"] == "morgan@pmi.local"
    assert [(m["to"], m["subject"]) for m in gmail.sent] == [("morgan@pmi.local", "[Test] A demo for County EMS")]
    assert (await db_session.execute(select(PipelineNote))).scalars().all() == []

    assert (await client.post("/pipeline/email/send", headers=auth_headers, json={**body, "subject": " "})).status_code == 400
    started = await client.post("/pipeline/email/send", headers=auth_headers, json=body)
    assert started.status_code == 202 and started.json()["total"] == 2
    await mail._jobs[started.json()["id"]].task
    progress = await client.get(f"/pipeline/email/jobs/{started.json()['id']}", headers=auth_headers)
    assert (progress.json()["sent"], progress.json()["done"]) == (2, True) and len(gmail.sent) == 3

    monkeypatch.setattr(gs, "get_credentials", lambda: None)
    assert (await client.get("/pipeline/email/setup", headers=auth_headers)).json()["connected"] is False
    refused = await client.post("/pipeline/email/send", headers=auth_headers, json=body)
    assert refused.status_code == 400 and "Connect your Google account" in refused.json()["detail"] and len(gmail.sent) == 3
