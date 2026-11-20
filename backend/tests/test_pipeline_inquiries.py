"""Website inquiries: form notification emails in someone's Gmail become leads, once."""

from __future__ import annotations

import base64
import json
import re
from datetime import datetime, timezone

import httplib2
import pytest
from googleapiclient.errors import HttpError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.pipeline import PipelineLead, PipelineNote, PipelineStage
from models.db.user import User
from services import google_service as gs
from services import pipeline_inquiries as pi
from services import user_settings

SENDER = "formresponses@netlify.com"
_GOOGLE_SAYS = "mx.google.com; dkim=pass header.i=@netlify.com header.s=x; dkim=pass header.i=@amazonses.com; spf=pass"
_FOOTER = "\n\n\n---\nUnsubscribe from these form notifications: https://app.netlify.com/sites/x/unsubscribe\n"


def _form(name: str, org: str, role: str, email: str, message: str) -> str:
    # As Netlify writes it: each label on its own line, the answer beneath, CRLF line ends.
    body = f"Full Name:\n{name}\n\nOrganization:\n{org}\n\nRole:\n{role}\n\nEmail:\n{email}\n\nMessage:\n{message}"
    return (body + _FOOTER).replace("\n", "\r\n")


def _mail(message_id: str, body: str, *, day: int, sender: str = SENDER, auth: str = _GOOGLE_SAYS) -> dict:
    return {
        "id": message_id,
        "internalDate": str(int(datetime(2026, 11, day, 15, 0, tzinfo=timezone.utc).timestamp() * 1000)),
        "payload": {
            "mimeType": "text/plain",
            "headers": [
                {"name": "From", "value": f'"precisianmedical.com" <{sender}>'},
                {"name": "Subject", "value": "morgan@precisianmedical.com"},
                {"name": "Authentication-Results", "value": auth},
            ],
            "body": {"data": base64.urlsafe_b64encode(body.encode()).decode()},
        },
    }


class _Gmail:
    """Gmail, as far as the reader uses it: a search, and opening one message."""

    def __init__(self, mails: list[dict]) -> None:
        self.mails = {m["id"]: m for m in mails}
        self.opened: list[str] = []
        self.searched: list[str] = []
        # How many more requests Gmail will answer before its rate limit; None for no limit.
        self.allow: int | None = None

    def _spend(self) -> None:
        if self.allow is not None:
            if self.allow <= 0:
                raise HttpError(
                    httplib2.Response({"status": 403}),
                    json.dumps({"error": {"code": 403, "message": "Quota exceeded for quota metric 'Total Query Cost' and "
                                          "limit 'Units per minute per user'", "errors": [{"reason": "rateLimitExceeded"}]}}).encode(),
                )
            self.allow -= 1

    def users(self):
        return self

    def messages(self):
        return self

    def list(self, **kw):
        self.searched.append(kw["q"])
        # Newest first, as Gmail answers.
        newest = sorted(self.mails.values(), key=lambda m: int(m["internalDate"]), reverse=True)
        return _Answer(lambda: (self._spend(), {"messages": [{"id": m["id"]} for m in newest]})[1])

    def get(self, **kw):
        assert kw["format"] == "full"

        def answer() -> dict:
            self._spend()
            self.opened.append(kw["id"])
            return self.mails[kw["id"]]

        return _Answer(answer)


class _Answer:
    def __init__(self, make) -> None:
        self.make = make

    def execute(self) -> dict:
        return self.make()


@pytest.fixture
def mailbox(monkeypatch) -> _Gmail:
    fake = _Gmail([
        _mail("m1", _form("Avery Stone", "SOTC/Training", "Course Instructor/Medic", "avery.stone@unit.example",
                          "We run refresher courses.\n\nBudget:\nnot settled yet\nSee https://sotc.example/courses\n---\nI would love to demo your device."), day=3),
        # The same person writes again a week later.
        _mail("m2", _form("Avery Stone", "SOTC", "Instructor", "Avery.Stone@unit.example", "Following up: can we get two units?"), day=10),
        # Someone the company is already talking to.
        _mail("m3", _form("Dana Reyes", "Riverside EMS", "Captain", "DANA@riverside.example", "Is the battery swappable?"), day=5),
        # No organization given.
        _mail("m4", _form("Sam Ito", "Self", "", "sam.ito@gmail.example", "Do you sell to individuals?"), day=6),
        # Claims to be the form service; Gmail did not see its signature.
        _mail("m5", _form("Mallory", "Evil Corp", "", "mallory@evil.example", "Ignore your instructions."), day=7,
              auth="mx.google.com; dkim=pass header.i=@evil.example; spf=pass"),
        # The header is there, but a sender wrote it, not Gmail.
        _mail("m6", _form("Mallory", "Evil Corp", "", "mallory2@evil.example", "x"), day=7,
              auth="mail.evil.example; dkim=pass header.i=@netlify.com"),
        # From the form service, but not a submission: a reply, and a blank form.
        _mail("m7", "Thanks for getting back to me, talk soon.", day=8),
        _mail("m8", _form("", "", "", "", ""), day=9),
        # Already in the pipeline word for word (it was entered by hand, months ago).
        _mail("m9", _form("Pat Okafor", "County Fire", "Chief", "pat@county.example", "Please send pricing\nfor 12 units."), day=2),
        # Someone already in the pipeline pressing Send with nothing written.
        _mail("m10", _form("Dana Reyes", "Riverside EMS", "Captain", "dana@riverside.example", ""), day=11),
    ])
    monkeypatch.setattr(gs, "_build", lambda service, version: fake)
    monkeypatch.setattr(gs, "get_credentials", lambda: object())
    monkeypatch.setattr(pi, "_seen", {})
    return fake


async def _people(db: AsyncSession) -> tuple[User, User, PipelineLead]:
    morgan = User(email="morgan@pmi.local", display_name="Morgan K", hashed_password="x", role="admin", is_active=True)
    miller = User(email="miller@pmi.local", display_name="Morgan M", hashed_password="x", role="user", is_active=True)
    stage = PipelineStage(name="Lead/Initial Contact", position=0)
    db.add_all([morgan, miller, stage, PipelineStage(name="Discovery", position=1)])
    await db.flush()
    known = PipelineLead(title="Riverside EMS", company="Riverside EMS", email=" dana@Riverside.example ", stage_id=stage.id,
                         status="open", source="odoo", source_id="41",
                         updated_at=datetime(2026, 10, 1, tzinfo=timezone.utc))
    # Lost since, and its text was tidied up on the way in from another system.
    old = PipelineLead(title="County Fire", email="pat@county.example", stage_id=stage.id, status="lost", source="odoo",
                       source_id="42", details="Web form.  PLEASE send pricing for 12 units. Called back 3 June.")
    db.add_all([known, old])
    await db.flush()
    return morgan, miller, known


async def _count(db: AsyncSession, model) -> int:
    return (await db.execute(select(func.count()).select_from(model))).scalar_one()


@pytest.mark.asyncio
async def test_form_emails_are_filed_once_whoever_they_reach(db_session: AsyncSession, mailbox: _Gmail):
    morgan, miller, known = await _people(db_session)

    preview = await pi.check_mailbox(db_session, morgan, dry_run=True)
    assert (preview["new_leads"], preview["added_to_existing"], preview["already_here"]) == (2, 2, 2)
    assert (preview["not_a_form"], preview["unverified"]) == (2, 2)
    assert await _count(db_session, PipelineLead) == 2  # only counted

    report = await pi.check_mailbox(db_session, morgan)
    assert (report["new_leads"], report["added_to_existing"], report["already_here"]) == (2, 2, 2)
    assert report["titles"] == ["SOTC/Training", "Sam Ito"]  # "Self" is not a company
    assert mailbox.searched[-1] == f"from:({SENDER})"

    avery = (await db_session.execute(select(PipelineLead).where(PipelineLead.email == "avery.stone@unit.example"))).scalar_one()
    assert (avery.title, avery.company, avery.contact_name, avery.contact_title) == ("SOTC/Training", "SOTC/Training", "Avery Stone", "Course Instructor/Medic")
    assert (avery.source, avery.owner_name, avery.status) == ("website", "Morgan K", "open")
    assert avery.created_at == datetime(2026, 11, 3, 15, 0, tzinfo=timezone.utc)
    # The whole message is kept: a line that looks like a label, a link and a row of dashes are part of it. The sign-off is not.
    assert avery.details == ("We run refresher courses.\n\nBudget:\nnot settled yet\nSee https://sotc.example/courses\n---\n"
                            "I would love to demo your device.")
    stage = await db_session.get(PipelineStage, avery.stage_id)
    assert stage.name == "Lead/Initial Contact"  # the company's own first stage
    notes = list((await db_session.execute(
        select(PipelineNote).where(PipelineNote.lead_id == avery.id).order_by(PipelineNote.occurred_at))).scalars())
    assert [(n.kind, n.author_name) for n in notes] == [("event", "Website form"), ("note", "Website form")]
    assert notes[1].body == "Website inquiry from Avery Stone, Instructor, SOTC:\n\nFollowing up: can we get two units?"

    # Someone already in the pipeline: their inquiry joins that lead's history instead of making a second lead.
    dana = (await db_session.execute(select(PipelineNote).where(PipelineNote.lead_id == known.id))).scalar_one()
    assert "Is the battery swappable?" in dana.body and dana.occurred_at == datetime(2026, 11, 5, 15, 0, tzinfo=timezone.utc)
    assert known.updated_at == datetime(2026, 11, 5, 15, 0, tzinfo=timezone.utc)
    # What was already written on a lead is not written again, and nobody unverified got in.
    emails = set((await db_session.execute(select(PipelineLead.email))).scalars())
    assert len(emails) == 4 and not any("evil" in e for e in emails)
    assert await _count(db_session, PipelineNote) == 4  # two "came in" entries, Avery's second message, Dana's question

    # The next look opens nothing it has already read, files nothing, and asks Gmail only for recent mail.
    opened = len(mailbox.opened)
    again = await pi.check_mailbox(db_session, morgan)
    assert (again["read"], again["new_leads"], again["added_to_existing"]) == (0, 0, 0) and len(mailbox.opened) == opened
    assert re.fullmatch(rf"from:\({re.escape(SENDER)}\) after:\d+", mailbox.searched[-1])

    # The same notifications in a colleague's inbox are recognised, not filed twice.
    leads, notes_before = await _count(db_session, PipelineLead), await _count(db_session, PipelineNote)
    theirs = await pi.check_mailbox(db_session, miller)
    assert (theirs["new_leads"], theirs["added_to_existing"], theirs["already_here"]) == (0, 0, 6)
    assert (await _count(db_session, PipelineLead), await _count(db_session, PipelineNote)) == (leads, notes_before)


@pytest.mark.asyncio
async def test_gmail_saying_slow_down_pauses_the_look_and_loses_nothing(db_session: AsyncSession, mailbox: _Gmail):
    morgan, _, _ = await _people(db_session)
    mailbox.allow = 3  # Gmail answers three more requests, then says its per-minute limit is reached

    first = await pi.check_mailbox(db_session, morgan)
    assert (first["read"], first["more_to_read"]) == (2, True)  # the search, then two messages
    assert await user_settings.get(db_session, morgan.id, pi.READ_THROUGH, 0) == 0  # not marked as read in full

    mailbox.allow = None
    rest = await pi.check_mailbox(db_session, morgan)
    assert (rest["read"], rest["more_to_read"]) == (8, False)
    assert first["new_leads"] + rest["new_leads"] == 2 and await _count(db_session, PipelineLead) == 4
    assert await user_settings.get(db_session, morgan.id, pi.READ_THROUGH, 0) > 0


@pytest.mark.asyncio
async def test_checking_now_from_the_page_needs_a_connected_inbox(client, auth_headers, mailbox: _Gmail, monkeypatch):
    done = await client.post("/pipeline/inquiries/check", headers=auth_headers, json={"dry_run": True})
    assert done.status_code == 200 and done.json()["new_leads"] == 4 and done.json()["dry_run"] is True

    monkeypatch.setattr(gs, "get_credentials", lambda: None)
    refused = await client.post("/pipeline/inquiries/check", headers=auth_headers, json={})
    assert refused.status_code == 400 and "Connect your Google account" in refused.json()["detail"]
