"""Email from the pipeline: one lead, or many, each getting their own copy.

The message goes out from the Gmail of the person who presses Send, one
message per address, so recipients never see each other. ``{first_name}``,
``{name}`` and ``{company}`` are filled in per lead. Every message sent is
written into that lead's history, which is also the record of who got it if
a send is cut short.

A send to many runs in the background: Gmail meters sending per minute, and
a request that long would not survive the hub's load balancer. The page asks
how it is going.
"""

from __future__ import annotations

import asyncio
import logging
import re
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from email.utils import formataddr
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from models.db.pipeline import PipelineLead, PipelineNote
from models.db.user import User
from services import google_service as gs
from services import pipeline

logger = logging.getLogger(__name__)

# The most people one send will go to. Gmail's own daily limit is higher; this is to catch a mistake.
MAX_RECIPIENTS = 500
# Between messages, so a long list stays inside Gmail's per-minute sending limit.
PAUSE_SECONDS = 1.0
# When Gmail says "too fast": wait this long and try that message again, this many times.
RETRY_WAIT_SECONDS = 60.0
RETRIES = 3
# This many failures in a row means something is wrong with the account, not the address.
STOP_AFTER_FAILURES = 5

_EMAIL = re.compile(r"[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+")
_TOKEN = re.compile(r"\{(first_name|name|company)\}")
# What a token becomes when the lead does not have it.
_FALLBACK = {"first_name": "there", "name": "there", "company": "your organization"}
_HONORIFICS = {"dr", "dr.", "mr", "mr.", "mrs", "mrs.", "ms", "ms.", "prof", "prof.", "sgt", "sgt.", "capt", "capt.", "lt", "lt.", "maj", "maj.", "col", "col.", "cpt", "ssg", "sfc", "msg", "cmdr", "chief"}


class NotConnected(pipeline.PipelineError):
    """This person has not connected a Google account here."""


@dataclass
class Recipient:
    address: str
    name: str
    company: str
    lead_ids: list[uuid.UUID]

    @property
    def to(self) -> str:
        return formataddr((self.name, self.address)) if self.name else self.address

    @property
    def first_name(self) -> str:
        words = [w for w in self.name.replace(",", " ").split() if w.lower() not in _HONORIFICS]
        return words[0] if words else ""


@dataclass
class Job:
    id: str
    user_id: uuid.UUID
    total: int
    sent: int = 0
    failed: list[dict[str, str]] = field(default_factory=list)
    done: bool = False
    stopped: str = ""
    task: asyncio.Task | None = None

    def out(self) -> dict[str, Any]:
        return {"id": self.id, "total": self.total, "sent": self.sent, "failed": self.failed,
                "done": self.done, "stopped": self.stopped}


_jobs: dict[str, Job] = {}


def render(text: str, who: Recipient) -> str:
    """Fill in the tokens for one person."""
    values = {"first_name": who.first_name, "name": who.name, "company": who.company}
    return _TOKEN.sub(lambda m: values[m.group(1)] or _FALLBACK[m.group(1)], text)


async def recipients(db: AsyncSession, lead_ids: list[uuid.UUID]) -> tuple[list[Recipient], list[str]]:
    """Who a send to these leads reaches: one entry per distinct address. Also the leads with no usable address."""
    leads = list(
        (
            await db.execute(select(PipelineLead).where(PipelineLead.id.in_(lead_ids)).order_by(PipelineLead.title))
        ).scalars()
    )
    found: dict[str, Recipient] = {}
    without: list[str] = []
    for lead in leads:
        address = (lead.email or "").strip()
        if not _EMAIL.fullmatch(address):
            without.append(lead.title)
            continue
        who = found.get(address.lower())
        if who is None:
            found[address.lower()] = Recipient(address, (lead.contact_name or "").strip(), (lead.company or "").strip(), [lead.id])
        else:
            # The same person on two leads gets one email, and both leads record it.
            who.lead_ids.append(lead.id)
            who.name = who.name or (lead.contact_name or "").strip()
            who.company = who.company or (lead.company or "").strip()
    return list(found.values()), without


def _check(subject: str, body: str) -> tuple[str, str]:
    subject, body = subject.strip(), body.strip()
    if not subject:
        raise pipeline.PipelineError("The email needs a subject.")
    if not body:
        raise pipeline.PipelineError("The email has nothing in it.")
    return subject, body


def _require_gmail() -> None:
    if gs.get_credentials() is None:
        raise NotConnected("Connect your Google account here first, so the email can be sent from your Gmail.")


async def preview(db: AsyncSession, lead_ids: list[uuid.UUID], subject: str, body: str) -> dict[str, Any]:
    """What a send would do, and the email as the first person would get it. Sends nothing."""
    subject, body = _check(subject, body)
    people, without = await recipients(db, lead_ids)
    used = set(_TOKEN.findall(subject + "\n" + body))
    first = people[0] if people else None
    return {
        "recipients": len(people),
        "leads": sum(len(p.lead_ids) for p in people),
        "without_email": without,
        "too_many": len(people) > MAX_RECIPIENTS,
        "limit": MAX_RECIPIENTS,
        # People for whom a token used in the email has nothing to fill it with.
        "missing": {
            token: sum(1 for p in people if not {"first_name": p.first_name, "name": p.name, "company": p.company}[token])
            for token in sorted(used)
        },
        "fallbacks": {token: _FALLBACK[token] for token in sorted(used)},
        "sample": {"to": first.to, "subject": render(subject, first), "body": render(body, first)} if first else None,
    }


async def send_test(db: AsyncSession, user: User, lead_ids: list[uuid.UUID], subject: str, body: str) -> dict[str, Any]:
    """Send the email, as the first person would get it, to the sender's own address only."""
    _require_gmail()
    subject, body = _check(subject, body)
    people, _ = await recipients(db, lead_ids)
    me = await asyncio.to_thread(gs.gmail_profile_email)
    if not me:
        raise NotConnected("Your Gmail address could not be read. Reconnect your Google account.")
    like = people[0] if people else Recipient(me, user.display_name or "", "", [])
    await asyncio.to_thread(gs.gmail_send, to=me, subject="[Test] " + render(subject, like), body=render(body, like))
    return {"sent_to": me, "as_for": like.to}


@asynccontextmanager
async def _session():
    """A database session for the background send. Tests replace this."""
    from database import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        yield db


def _too_fast(exc: Exception) -> bool:
    status = getattr(getattr(exc, "resp", None), "status", None)
    return status == 429 or (status == 403 and any(w in str(exc).lower() for w in ("ratelimit", "rate limit", "quota")))


def _why(exc: Exception) -> str:
    reason = getattr(exc, "reason", None) or str(exc)
    return str(reason).strip()[:200] or "Gmail refused it."


async def _run(job: Job, user_name: str, people: list[Recipient], subject: str, body: str) -> None:
    in_a_row = 0
    try:
        if settings.hub_mode:
            # The request that started this is over; make sure the sender's Google sign-in is still loaded.
            from services import google_user_creds

            async with _session() as db:
                await google_user_creds.load_into_cache(db, job.user_id)
        for n, who in enumerate(people):
            if n:
                await asyncio.sleep(PAUSE_SECONDS)
            text = render(body, who)
            heading = render(subject, who)
            error: Exception | None = None
            for attempt in range(RETRIES + 1):
                try:
                    await asyncio.to_thread(gs.gmail_send, to=who.to, subject=heading, body=text)
                    error = None
                    break
                except Exception as exc:  # noqa: BLE001 - Gmail's errors, a withdrawn grant, the network
                    error = exc
                    if not _too_fast(exc) or attempt == RETRIES:
                        break
                    await asyncio.sleep(RETRY_WAIT_SECONDS)
            if error is not None:
                job.failed.append({"to": who.address, "reason": _why(error)})
                in_a_row += 1
                if in_a_row >= STOP_AFTER_FAILURES:
                    job.stopped = f"Stopped after {in_a_row} failures in a row. Nothing more was sent."
                    break
                continue
            in_a_row = 0
            job.sent += 1
            # Recorded as each one goes, so the history is right even if the rest never do.
            try:
                async with _session() as db:
                    now = datetime.now(timezone.utc)
                    for lead_id in who.lead_ids:
                        lead = await db.get(PipelineLead, lead_id)
                        if lead is None:
                            continue
                        db.add(PipelineNote(lead_id=lead.id, kind="email", author_id=job.user_id, author_name=user_name,
                                            body=f"Email sent to {who.address}: {heading}\n\n{text}", occurred_at=now,
                                            source_id=f"mail:{job.id}"))
                        lead.updated_at = now
                    await db.commit()
            except Exception:  # noqa: BLE001 - the email has gone; a missing history entry must not stop the rest
                logger.exception("Pipeline email %s: sent to %s but could not record it", job.id, who.address)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Pipeline email %s failed", job.id)
        job.stopped = f"Stopped: {_why(exc)}"
    finally:
        job.done = True
        logger.info("Pipeline email %s: %s of %s sent, %s failed", job.id, job.sent, job.total, len(job.failed))


async def start(db: AsyncSession, user: User, lead_ids: list[uuid.UUID], subject: str, body: str) -> Job:
    """Begin sending. Returns at once; ``status`` says how it is going."""
    _require_gmail()
    subject, body = _check(subject, body)
    if any(j.user_id == user.id and not j.done for j in _jobs.values()):
        raise pipeline.PipelineError("An email you started is still being sent. Wait for it to finish.")
    people, _ = await recipients(db, lead_ids)
    if not people:
        raise pipeline.PipelineError("None of those leads has an email address.")
    if len(people) > MAX_RECIPIENTS:
        raise pipeline.PipelineError(f"That is {len(people)} people. One send goes to at most {MAX_RECIPIENTS}.")
    job = Job(id=uuid.uuid4().hex, user_id=user.id, total=len(people))
    _jobs[job.id] = job
    # Keep only the latest few: this is progress for the page, not a record. The record is each lead's history.
    for old in [k for k, j in _jobs.items() if j.done][:-20]:
        _jobs.pop(old, None)
    job.task = asyncio.create_task(_run(job, user.display_name or user.email, people, subject, body))
    return job


async def status(db: AsyncSession, user: User, job_id: str) -> dict[str, Any]:
    job = _jobs.get(job_id)
    if job is not None:
        if job.user_id != user.id:
            raise pipeline.PipelineError("That send was started by someone else.")
        return job.out()
    # The server restarted since: what the leads' histories say went out is all that is known.
    sent = len(set(
        (await db.execute(
            select(PipelineNote.body).where(PipelineNote.source_id == f"mail:{job_id}", PipelineNote.author_id == user.id)
        )).scalars()
    ))
    return {"id": job_id, "total": None, "sent": sent, "failed": [], "done": True,
            "stopped": "The server restarted while this was being sent. Each lead's history shows whether it got the email."}


async def setup(db: AsyncSession, user: User) -> dict[str, Any]:
    """Whose Gmail an email would go from, and their signature to start the message with."""
    if gs.get_credentials() is None:
        return {"connected": False, "from": "", "signature": ""}
    address = await asyncio.to_thread(gs.gmail_profile_email)
    try:
        signature = pipeline.html_to_text(await asyncio.to_thread(gs.gmail_get_signature))
    except Exception:  # noqa: BLE001 - a signature is a nicety
        signature = ""
    return {"connected": bool(address), "from": address, "signature": signature}
