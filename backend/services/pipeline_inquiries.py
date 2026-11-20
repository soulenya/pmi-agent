"""Website inquiries: a contact form's notification emails become leads in the pipeline.

A website's form service (Netlify Forms, for PMI) emails each submission to
someone's inbox. Every few minutes the hub looks in each connected person's
Gmail for mail from the addresses the brand names
(``website_inquiries.senders``), reads the fields out of each one, and files
it: a new lead, or, when an open lead already has that email address, a note
in that lead's history. Gmail is only read.

Anyone can type anything into a public form, so what arrives is treated as
exactly that: text to keep, never instructions. A message is only believed to
be from the form service when Gmail itself verified the sender's signature.

Running it again changes nothing: each submission is known by a fingerprint of
who sent it and what they wrote, whichever mailbox it was found in.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import re
import time
import uuid
from datetime import datetime, timezone
from email.utils import parseaddr
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from brand import get_brand
from models.db.pipeline import PipelineLead, PipelineNote
from models.db.user import User
from services import google_service as gs
from services import pipeline, user_settings

logger = logging.getLogger(__name__)

SOURCE = "website"
AUTHOR = "Website form"
CHECK_EVERY_SECONDS = 300
# The most messages one look at a mailbox will consider, newest first.
MAX_MESSAGES = 500
# The most it will open in one look; the rest wait for the next, so a first run stays inside Gmail's rate limit.
MAX_PER_LOOK = 40
# Per person: the time up to which their mailbox has been read in full, so a
# restart does not read the whole history again.
READ_THROUGH = "pipeline_inquiries.read_through"
# Looked at again each time, in case a message was slow to arrive or the clocks disagree.
_OVERLAP_SECONDS = 86400
# What people type when the form asks for an organization and they have none.
_NO_COMPANY = {"self", "n/a", "na", "none", "no", "-", "individual", "personal", "private"}

# What a form might call each thing. The first matching label wins.
_LABELS: dict[str, tuple[str, ...]] = {
    "name": ("full name", "name", "your name"),
    "company": ("organization", "organisation", "company", "company name"),
    "role": ("role", "title", "job title", "position"),
    "email": ("email", "e-mail", "email address"),
    "phone": ("phone", "phone number", "telephone"),
    "message": ("message", "comments", "comment", "inquiry", "enquiry", "how can we help"),
}
_FIELD_FOR = {label: key for key, labels in _LABELS.items() for label in labels}
_LABEL_LINE = re.compile(r"^\s*([A-Za-z][A-Za-z0-9 /&'\-]{0,40}):[ \t]*(.*)$")
_EMAIL = re.compile(r"[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+")

# Message ids already dealt with, per person, so each look fetches only what is new.
_seen: dict[uuid.UUID, set[str]] = {}
# One look at a time: two at once could both decide the same submission is new.
_lock = asyncio.Lock()


class NotConnected(pipeline.PipelineError):
    """This person has not connected a Google account here."""


def senders() -> list[str]:
    return get_brand().inquiry_senders


def enabled() -> bool:
    return get_brand().feature("pipeline") and bool(senders())


# ── Reading one email ─────────────────────────────────────────────────────────


def _without_footer(lines: list[str]) -> list[str]:
    """Drop the form service's sign-off: a line of dashes and the little that follows it."""
    rules = [i for i, line in enumerate(lines) if line.strip() == "---"]
    if rules and sum(1 for line in lines[rules[-1] + 1:] if line.strip()) <= 3:
        return lines[: rules[-1]]
    return lines


def parse(body: str) -> dict[str, Any] | None:
    """The fields of a form submission, or None when the text is not one.

    The form service writes each field as its label on one line and the answer
    beneath it. A label the form uses that is not known here is kept with its
    answer rather than dropped. Once the message has started, a line that only
    looks like a label is part of the message.
    """
    lines = _without_footer((body or "").replace("\r\n", "\n").replace("\r", "\n").split("\n"))
    fields: dict[str, list[str]] = {}
    extras: list[tuple[str, list[str]]] = []
    current: list[str] | None = None
    in_message = False
    for line in lines:
        found = _LABEL_LINE.match(line)
        if found:
            label, rest = found.group(1).strip(), found.group(2).strip()
            key = _FIELD_FOR.get(label.lower())
            if key and key not in fields and not (in_message and rest):
                current = fields[key] = [rest] if rest else []
                in_message = key == "message"
                continue
            if key is None and not rest and not in_message:
                current = []
                extras.append((label, current))
                continue
        if current is not None:
            current.append(line.rstrip())

    def text(key: str) -> str:
        return "\n".join(fields.get(key, [])).strip()

    out = {key: text(key) for key in _LABELS}
    for key in ("name", "company", "role", "email", "phone"):
        out[key] = re.sub(r"\s+", " ", out[key])
    out["extras"] = [(label, "\n".join(value).strip()) for label, value in extras if "\n".join(value).strip()]
    if out["email"] and not _EMAIL.fullmatch(out["email"]):
        out["extras"].append(("Email as typed", out["email"]))
        out["email"] = ""
    # A form submission says who it is from. Anything else from the sender (a reply, a notice) is not one.
    if not (out["name"] or out["email"]) or sum(1 for key in _LABELS if out[key]) < 2:
        return None
    return out


def fingerprint(inquiry: dict[str, Any]) -> str:
    """What makes this submission this submission, whichever mailbox it landed in."""
    message = re.sub(r"\s+", " ", inquiry["message"]).strip().lower()
    return hashlib.sha256("\n".join((inquiry["email"].lower(), inquiry["name"].lower(), message)).encode()).hexdigest()


# ── Reading a mailbox ─────────────────────────────────────────────────────────


def _verified(headers: list[dict], sender: str) -> bool:
    """True when Gmail's own check says the sender's domain signed this message."""
    domain = re.escape(sender.rsplit("@", 1)[1])
    for header in headers:
        value = str(header.get("value") or "")
        # Only the verdict Gmail wrote: a sender can put any other header in a message.
        if str(header.get("name") or "").lower() == "authentication-results" and value.lstrip().lower().startswith("mx.google.com"):
            if re.search(rf"dkim=pass\b[^;]*header\.i=@{domain}(?![\w.\-])", value, re.I):
                return True
    return False


def _rate_limited(exc: Exception) -> bool:
    """Gmail saying "too fast", as opposed to "not allowed"."""
    status = getattr(getattr(exc, "resp", None), "status", None)
    return status == 429 or (status == 403 and any(w in str(exc).lower() for w in ("ratelimit", "rate limit", "quota")))


def _read_mailbox_sync(wanted: list[str], skip: set[str], since: int = 0) -> dict[str, Any]:
    """The form submissions in the mailbox bound to this context. Only reads.

    ``since`` (seconds since 1970) leaves out mail older than that. Gmail's
    rate limit ends a look early rather than failing it: what was read is
    kept and ``more`` says there is more for the next look.
    """
    from googleapiclient.errors import HttpError

    svc = gs._build("gmail", "v1")
    query = "from:(" + " OR ".join(wanted) + ")" + (f" after:{since}" if since > 0 else "")
    ids: list[str] = []
    page = None
    inquiries: list[dict[str, Any]] = []
    not_a_form = unverified = 0
    fetched: list[str] = []
    more = False
    while len(ids) < MAX_MESSAGES:
        try:
            resp = svc.users().messages().list(userId="me", q=query, maxResults=100, pageToken=page).execute()
        except HttpError as exc:
            if not _rate_limited(exc):
                raise
            more = True
            break
        ids += [m["id"] for m in resp.get("messages", [])]
        page = resp.get("nextPageToken")
        if not page:
            break
    for message_id in ids[:MAX_MESSAGES]:
        if message_id in skip:
            continue
        if len(fetched) >= MAX_PER_LOOK:
            more = True
            break
        try:
            msg = svc.users().messages().get(userId="me", id=message_id, format="full").execute()
        except HttpError as exc:
            if _rate_limited(exc):
                more = True
                break
            if exc.resp.status == 404:
                continue  # deleted since it was listed
            raise
        fetched.append(message_id)
        payload = msg.get("payload") or {}
        headers = payload.get("headers") or []
        sender = parseaddr(gs._headers_of(payload).get("From", ""))[1].lower()
        if sender not in wanted or not _verified(headers, sender):
            unverified += 1
            continue
        plain, html = gs._extract_bodies(payload)
        inquiry = parse(plain or pipeline.html_to_text(html))
        if inquiry is None:
            not_a_form += 1
            continue
        try:
            inquiry["received"] = datetime.fromtimestamp(int(msg["internalDate"]) / 1000, tz=timezone.utc)
        except (KeyError, TypeError, ValueError):
            inquiry["received"] = datetime.now(timezone.utc)
        inquiries.append(inquiry)
    return {"inquiries": inquiries, "fetched": fetched, "not_a_form": not_a_form, "unverified": unverified, "more": more}


# ── Filing ────────────────────────────────────────────────────────────────────


def _details(inquiry: dict[str, Any]) -> str:
    parts = [inquiry["message"]] if inquiry["message"] else []
    parts += [f"{label}: {value}" for label, value in inquiry["extras"]]
    return "\n\n".join(parts)


def _note_body(inquiry: dict[str, Any]) -> str:
    who = ", ".join(p for p in (inquiry["name"], inquiry["role"], inquiry["company"]) if p)
    head = "Website inquiry" + (f" from {who}" if who else "") + (f" ({inquiry['phone']})" if inquiry["phone"] else "")
    return "\n\n".join(p for p in (head + ":", _details(inquiry)) if p)


def _squash(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip().lower()


async def _already_recorded(db: AsyncSession, leads: list[PipelineLead], inquiry: dict[str, Any]) -> bool:
    """True when this person's lead already holds what they wrote, or they wrote nothing."""
    message = _squash(inquiry["message"])
    if not message:
        return True  # a bare "contact me" from someone already in the pipeline adds nothing
    if any(message in _squash(lead.details) for lead in leads):
        return True
    bodies = await db.execute(select(PipelineNote.body).where(PipelineNote.lead_id.in_([lead.id for lead in leads])))
    return any(message in _squash(body) for body in bodies.scalars())


async def intake(db: AsyncSession, owner: User, inquiries: list[dict[str, Any]], *, dry_run: bool = False) -> dict[str, Any]:
    """File each submission that is not here yet. ``dry_run`` only counts. Caller commits."""
    report: dict[str, Any] = {"new_leads": 0, "added_to_existing": 0, "already_here": 0, "titles": []}
    if not inquiries:
        return report
    prints = {fingerprint(i) for i in inquiries}
    here = {
        *(await db.execute(
            select(PipelineLead.source_id).where(PipelineLead.source == SOURCE, PipelineLead.source_id.in_(prints))
        )).scalars(),
        *(await db.execute(select(PipelineNote.source_id).where(PipelineNote.source_id.in_(prints)))).scalars(),
    }
    first_stage = None
    # Addresses given a lead earlier in this same batch (a dry run writes nothing to find them by).
    just_added: set[str] = set()
    for inquiry in sorted(inquiries, key=lambda i: i["received"]):
        mark = fingerprint(inquiry)
        if mark in here:
            report["already_here"] += 1
            continue
        here.add(mark)
        received = inquiry["received"]
        address = inquiry["email"].lower()
        known: list[PipelineLead] = []
        if address:
            known = list(
                (
                    await db.execute(
                        select(PipelineLead)
                        .where(func.lower(func.trim(PipelineLead.email)) == address)
                        .order_by(PipelineLead.updated_at.desc())
                    )
                ).scalars()
            )
        if known and await _already_recorded(db, known, inquiry):
            # Entered by hand, or brought over from another system, before this ever looked.
            report["already_here"] += 1
            continue
        if address in just_added and not _squash(inquiry["message"]):
            report["already_here"] += 1  # what a real run finds through the lead it has just made
            continue
        existing = next((lead for lead in known if lead.status == "open"), None)
        if existing is not None or address in just_added:
            # Someone the company is already talking to wrote in: it belongs in that lead's history.
            report["added_to_existing"] += 1
            if dry_run or existing is None:
                continue
            db.add(PipelineNote(lead_id=existing.id, kind="note", body=_note_body(inquiry), author_name=AUTHOR,
                                occurred_at=received, source_id=mark))
            if existing.updated_at is None or existing.updated_at < received:
                existing.updated_at = received
            await db.flush()
            continue
        title = (
            (inquiry["company"] if inquiry["company"].lower() not in _NO_COMPANY else "") or inquiry["name"] or inquiry["email"]
        )
        report["new_leads"] += 1
        if len(report["titles"]) < 25:
            report["titles"].append(title[:120])
        if address:
            just_added.add(address)
        if dry_run:
            continue
        if first_stage is None:
            first_stage = (await pipeline._ensure_stages(db))[0]
        lead = PipelineLead(
            id=uuid.uuid4(), title=title[:500], company=inquiry["company"][:300], contact_name=inquiry["name"][:300],
            contact_title=inquiry["role"][:300], email=inquiry["email"][:320], phone=inquiry["phone"][:100],
            details=_details(inquiry), stage_id=first_stage.id, status="open",
            owner_id=owner.id, owner_name=owner.display_name or owner.email, created_by=owner.id,
            source=SOURCE, source_id=mark, created_at=received, updated_at=received,
        )
        db.add(lead)
        await db.flush()
        db.add(PipelineNote(lead_id=lead.id, kind="event", body="Came in through the website form.",
                            author_name=AUTHOR, occurred_at=received))
    await db.flush()
    return report


async def check_mailbox(db: AsyncSession, user: User, *, dry_run: bool = False) -> dict[str, Any]:
    """Look in this person's Gmail (already bound to this context) and file what is new.

    Commits what it files; ``dry_run`` only counts and writes nothing.
    """
    if not enabled():
        raise pipeline.PipelineError("Website inquiries are not set up for this company.")
    if gs.get_credentials() is None:
        raise NotConnected("Connect your Google account here first, so your inbox can be read.")
    async with _lock:
        started = int(time.time())
        # A dry run looks at the mailbox afresh; a real look carries on from where the last one finished.
        skip = set() if dry_run else _seen.get(user.id, set())
        read_through = 0 if dry_run else int(await user_settings.get(db, user.id, READ_THROUGH, 0))
        since = max(0, read_through - _OVERLAP_SECONDS) if read_through else 0
        # to_thread, not an executor: it carries whose mailbox this is into the thread.
        found = await asyncio.to_thread(_read_mailbox_sync, senders(), skip, since)
        report = await intake(db, user, found["inquiries"], dry_run=dry_run)
        if not dry_run:
            if not found["more"]:
                await user_settings.set_value(db, user.id, READ_THROUGH, started)
            await db.commit()
            # Only once it is saved: a failure above leaves them to be read again.
            _seen.setdefault(user.id, set()).update(found["fetched"])
    return {
        "dry_run": dry_run,
        "senders": senders(),
        "read": len(found["fetched"]),
        "not_a_form": found["not_a_form"],
        "unverified": found["unverified"],
        # Gmail's rate limit or the per-look cap stopped it early; the next look carries on.
        "more_to_read": found["more"],
        **report,
    }
