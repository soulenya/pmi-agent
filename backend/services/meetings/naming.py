"""Naming a recorded meeting after who it was with.

A meeting note used to be titled "Microsoft Teams meeting — Oct 02, 2026 10:00 AM",
which says nothing about the meeting. The title is now built from the calendar
event the precheck found (its title and who was invited, split by company
domain) and, when the calendar has nothing or only "Meeting"/"Call", from a
short extraction over the transcript. Shape:

    PMI/Hatch High Level Review (External) — Oct 2, 2026
    PMI Weekly Ops Sync (Internal) — Oct 2, 2026
    Microsoft Teams meeting — Oct 02, 2026 10:00 AM      (nothing to go on)
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime

from config import settings
from services.email_contacts import _GENERIC_DOMAINS, domain_of

logger = logging.getLogger(__name__)

# Calendar titles that name nothing; the transcript decides the topic instead.
_GENERIC_TITLES = {
    "meeting", "call", "sync", "catch up", "catch-up", "catchup", "chat", "check in",
    "check-in", "checkin", "discussion", "zoom", "teams", "google meet", "meet",
    "quick call", "quick chat", "intro", "intro call", "touch base", "touchbase", "1:1",
    "one on one", "busy", "hold", "blocked",
}


@dataclass
class MeetingFacts:
    """What the precheck learned from the calendar, kept until the note is written."""

    event_title: str = ""
    external_emails: list[str] = field(default_factory=list)
    internal_emails: list[str] = field(default_factory=list)
    # True once a calendar event was matched at all (even with no attendees).
    from_calendar: bool = False

    def to_json(self) -> dict:
        return {
            "event_title": self.event_title,
            "external_emails": self.external_emails,
            "internal_emails": self.internal_emails,
            "from_calendar": self.from_calendar,
        }

    @classmethod
    def from_json(cls, raw: object) -> MeetingFacts:
        if not isinstance(raw, dict):
            return cls()
        return cls(
            event_title=str(raw.get("event_title") or ""),
            external_emails=[str(e) for e in raw.get("external_emails") or []],
            internal_emails=[str(e) for e in raw.get("internal_emails") or []],
            from_calendar=bool(raw.get("from_calendar")),
        )


def org_label(email: str) -> str:
    """'hatch.co' → 'Hatch'; 'precisian-medical-instruments.com' → 'Precisian Medical
    Instruments'; a personal address → the person's name ('Jane Doe')."""
    domain = domain_of(email)
    local = (email or "").split("@")[0]
    if not domain or domain in _GENERIC_DOMAINS:
        parts = [re.sub(r"\d+$", "", p) for p in re.split(r"[._\-]+", local)]
        return " ".join(p.capitalize() for p in parts if p)[:40]
    label = domain.split(".")[0]
    return " ".join(p.capitalize() for p in re.split(r"[-_]+", label) if p)[:40]


def other_parties(externals: list[str]) -> str:
    """Distinct external organisations, in invite order, joined with '/'."""
    seen: list[str] = []
    for e in externals:
        name = org_label(e)
        if name and name not in seen:
            seen.append(name)
    return "/".join(seen[:3])


def is_generic_title(title: str) -> bool:
    t = re.sub(r"\s+", " ", (title or "").strip().lower())
    t = re.sub(r"^(re|fw|fwd):\s*", "", t)
    return not t or t in _GENERIC_TITLES or len(t) < 3


async def _llm_facts(db, transcript: str) -> dict:
    """{topic, other_party, external} from the transcript. Empty dict on any failure.
    The model is told to answer null rather than guess; nulls are dropped."""
    try:
        from services.llm.router import get_llm_client

        client = await get_llm_client(db, task="meetings")
        source = (transcript or "")[:6000]
        if len(source.strip()) < 80:
            return {}
        chunk = await client.chat(
            [
                {
                    "role": "system",
                    "content": (
                        "You name meeting recordings. Answer ONLY with JSON. Never invent "
                        "a company, person or topic that the transcript does not state; "
                        "use null when unsure."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        'JSON: {"topic": "..." | null (3-6 words naming what the meeting '
                        "was about, Title Case, no trailing period, e.g. 'High Level "
                        "Design Review'), "
                        '"other_party": "..." | null (the OTHER organisation on the call, '
                        f"i.e. not {settings.company_short_name}; a company name if one is "
                        "said, else a person's name; null if everyone is from "
                        f"{settings.company_short_name} or nobody is identified), "
                        '"external": true | false | null (true when someone outside '
                        f"{settings.company_short_name} took part)}}\n\nTranscript:\n" + source
                    ),
                },
            ],
            temperature=0.1,
        )
        raw = chunk.content or ""
        s, e = raw.find("{"), raw.rfind("}")
        data = json.loads(raw[s : e + 1]) if s != -1 and e > s else {}
        return {k: v for k, v in data.items() if v is not None} if isinstance(data, dict) else {}
    except Exception:  # noqa: BLE001 — naming is best-effort
        logger.info("Meeting title extraction failed", exc_info=True)
        return {}


def _clean_topic(text: str) -> str:
    text = re.sub(r"\s+", " ", str(text or "")).strip().strip(".;:,")
    text = re.sub(r"^(re|fw|fwd):\s*", "", text, flags=re.I)
    text = re.sub(r"\s*\((external|internal)\)\s*$", "", text, flags=re.I)
    return text[:80]


def _strip_parties(topic: str, names: list[str]) -> str:
    """'PMI/Hatch High Level Review' → 'High Level Review' when PMI and Hatch are
    the parties already going in front of the title. Also 'PMI x Hatch', 'Hatch - PMI:'."""
    known = [re.escape(n) for n in names if n]
    if not known:
        return topic
    name = "(?:" + "|".join(known) + ")"
    sep = r"\s*(?:/|x|&|-|–|—|:|<>|,|and|with|\+)\s*"
    pattern = rf"^(?:{name}(?:{sep}{name})*)(?:{sep}|\s+)"
    stripped = re.sub(pattern, "", topic, count=1, flags=re.I).strip()
    return stripped or topic


async def build_meeting_title(
    db,
    *,
    transcript: str,
    platform: str,
    recorded_at: datetime,
    facts: MeetingFacts | None,
) -> str:
    """The note's title. Calendar facts first, transcript second, platform last."""
    facts = facts or MeetingFacts()
    us = (settings.company_short_name or "").strip()
    date = recorded_at.astimezone().strftime("%b %d, %Y").replace(" 0", " ")

    topic = "" if is_generic_title(facts.event_title) else _clean_topic(facts.event_title)
    them = other_parties(facts.external_emails)
    external: bool | None
    if facts.external_emails:
        external = True
    elif facts.from_calendar and facts.internal_emails:
        external = False
    else:
        external = None

    if not topic or (external is None and not them):
        guessed = await _llm_facts(db, transcript)
        if not topic and isinstance(guessed.get("topic"), str):
            topic = _clean_topic(guessed["topic"])
        if not them and isinstance(guessed.get("other_party"), str):
            them = _clean_topic(guessed["other_party"])[:40]
            if them and us and them.lower() == us.lower():
                them = ""
        if external is None and isinstance(guessed.get("external"), bool):
            external = guessed["external"]
        if them and external is None:
            external = True

    if not topic:
        if platform == "Manual":
            return f"Recorded meeting — {recorded_at.astimezone().strftime('%b %d, %Y %I:%M %p')}"
        return f"{platform} meeting — {recorded_at.astimezone().strftime('%b %d, %Y %I:%M %p')}"

    topic = _strip_parties(topic, [us, *them.split("/")])

    if them:
        who = f"{us}/{them}" if us else them
        return f"{who} {topic} (External) — {date}"
    if external is False:
        who = f"{us} " if us else ""
        return f"{who}{topic} (Internal) — {date}"
    who = f"{us} " if us else ""
    return f"{who}{topic} — {date}"
