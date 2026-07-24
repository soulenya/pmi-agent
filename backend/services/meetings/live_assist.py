"""Live meeting assist — real-time transcript + rule-gated help cards.

Layered ON TOP of the existing MeetingMonitor recording flow (which is
unchanged): when a meeting is detected, the UI shows a consent pop-down;
if the user accepts, this session drains ~15 s audio chunks from the
already-running recorder, transcribes each via the short-clip Google STT
path, and (per the accepted options) runs a periodic assist pass that
produces cards — jargon definitions and suggested answers.

DISCLOSURE POSTURE IS ENFORCED BY CONSTRUCTION:
  * answers mode "nda"    → the assist prompt includes company context.
  * answers mode "public" → the assist model receives NO company data at
    all and is instructed to use public knowledge only.
  * Neither mode gives the assist model tools — cards are whispered
    suggestions to the user; nothing is spoken, sent, or written anywhere.

The full-quality end-of-meeting transcription is reassembled from the saved
chunks plus the recorder tail, so the authoritative MeetingNote is identical
to the non-live path.
"""

from __future__ import annotations

import asyncio
import io
import json
import logging
import re
import uuid
import wave
from datetime import datetime, timezone
from pathlib import Path

from config import settings

logger = logging.getLogger(__name__)

CHUNK_SECONDS = 15
ASSIST_INTERVAL_SECONDS = 30
_ASSIST_WINDOW_CHARS = 2_400   # transcript tail given to the assist model
_MAX_CARDS = 200

ASSIST_DEFAULTS_KEY = "meetings.assist_defaults"

_JARGON_SYSTEM = (
    "You are Little Gerry, quietly helping a user FOLLOW a live business "
    "meeting. You see a rolling transcript (imperfect speech-to-text). "
    "Never invent facts; skip anything you are not sure of."
)

_ANSWERS_NDA_NOTE = (
    "The user IS under NDA with the other party. You may use the company "
    "context below to suggest answers, and should say which fact you used."
)

_ANSWERS_PUBLIC_NOTE = (
    "The user is NOT under NDA with the other party. You have deliberately "
    "been given NO company information. Suggest answers from public/general "
    "knowledge ONLY, and never speculate about the user's company specifics."
)


def _assist_instructions(jargon: bool, answers: str) -> str:
    parts = [
        "From the NEW portion of the transcript, produce at most 3 helper "
        'cards. Respond ONLY with JSON: {"cards": [{"kind": "jargon"|"answer", '
        '"title": "...", "body": "..."}]}. Return {"cards": []} when nothing '
        "genuinely helps — silence is better than noise."
    ]
    if jargon:
        parts.append(
            'kind "jargon": an acronym, buzzword, or industry term used IN '
            "CONTEXT that a listener might not know — title = the term, "
            "body = a one-sentence plain-English definition AS USED HERE. "
            "Skip terms already defined earlier (list provided)."
        )
    if answers != "off":
        parts.append(
            'kind "answer": when a question is posed to the user or left '
            "hanging in the discussion — title = the question (short), "
            "body = a 1-3 sentence suggested answer. "
            + (_ANSWERS_NDA_NOTE if answers == "nda" else _ANSWERS_PUBLIC_NOTE)
        )
    return "\n".join(parts)


class LiveMeetingSession:
    """One meeting's live-assist state. Owned by the MeetingMonitor singleton."""

    def __init__(self, platform: str) -> None:
        self.platform = platform
        self.consent: str = "pending"        # pending | accepted | declined | ended
        self.options: dict = {"transcript": False, "jargon": False, "answers": "off", "thankyou": False}
        self.started_at = datetime.now(timezone.utc)
        self.party: str = ""
        self.party_email: str = ""
        self.nda_hint: str = ""
        self.segments: list[dict] = []       # {seq, at, text}
        self.cards: list[dict] = []          # {seq, kind, title, body, at, route?}
        self.chunk_dir: Path | None = None
        self.chunk_paths: list[Path] = []
        self.seen_terms: set[str] = set()
        self.assist_cursor: int = 0          # transcript char offset already analyzed
        self.last_error: str | None = None
        self._seq = 0
        self._tasks: list[asyncio.Task] = []

    # ── state for the UI poll ────────────────────────────────────────────

    def snapshot(self, after_segment: int = -1, after_card: int = -1) -> dict:
        return {
            "active": self.consent in ("pending", "accepted", "ended"),
            "consent": self.consent,
            "options": dict(self.options),
            "platform": self.platform,
            "started_at": self.started_at.isoformat(),
            "party": self.party,
            "nda_hint": self.nda_hint,
            "segments": [s for s in self.segments if s["seq"] > after_segment],
            "cards": [c for c in self.cards if c["seq"] > after_card],
            "last_error": self.last_error,
        }

    def _next_seq(self) -> int:
        self._seq += 1
        return self._seq

    def add_card(self, kind: str, title: str, body: str, route: str | None = None) -> None:
        if len(self.cards) >= _MAX_CARDS:
            return
        self.cards.append(
            {
                "seq": self._next_seq(),
                "kind": kind,
                "title": title[:200],
                "body": body[:1000],
                "route": route,
                "at": datetime.now(timezone.utc).isoformat(),
            }
        )

    def transcript_text(self) -> str:
        return "\n".join(s["text"] for s in self.segments)

    # ── lifecycle ────────────────────────────────────────────────────────

    def accept(self, options: dict, recorder, get_db) -> None:
        self.consent = "accepted"
        self.options.update(
            transcript=bool(options.get("transcript", True)),
            jargon=bool(options.get("jargon", False)),
            answers=str(options.get("answers", "off")),
            thankyou=bool(options.get("thankyou", False)),
        )
        if self.options["answers"] not in ("off", "nda", "public"):
            self.options["answers"] = "off"
        d = Path(settings.storage_root).expanduser().parent / "live_chunks" / uuid.uuid4().hex
        d.mkdir(parents=True, exist_ok=True)
        self.chunk_dir = d
        self._tasks.append(asyncio.create_task(self._chunk_loop(recorder)))
        if self.options["jargon"] or self.options["answers"] != "off":
            self._tasks.append(asyncio.create_task(self._assist_loop(get_db)))

    def decline(self) -> None:
        self.consent = "declined"
        self.stop_tasks()

    def end(self) -> None:
        """Meeting over — stop loops, keep state for the wrap-up card."""
        self.consent = "ended"
        self.stop_tasks()

    def stop_tasks(self) -> None:
        for t in self._tasks:
            t.cancel()
        self._tasks = []

    # ── audio chunk loop ─────────────────────────────────────────────────

    async def _chunk_loop(self, recorder) -> None:
        from services.voice import google_speech

        try:
            while self.consent == "accepted":
                await asyncio.sleep(CHUNK_SECONDS)
                if not recorder.recording:
                    continue  # monitor may still be starting/finalizing
                try:
                    wav = await asyncio.to_thread(recorder.drain_chunk)
                except Exception:  # noqa: BLE001
                    logger.exception("Live chunk drain failed")
                    continue
                if not wav:
                    continue
                if self.chunk_dir is not None:
                    try:
                        p = self.chunk_dir / f"{len(self.chunk_paths):05d}.wav"
                        await asyncio.to_thread(p.write_bytes, wav)
                        self.chunk_paths.append(p)
                    except OSError:
                        logger.exception("Could not persist live chunk")
                # Accepting mid-meeting makes the first drain carry EVERYTHING
                # recorded so far — too long for the ≤60 s live STT path. Keep
                # it for the final full-quality pass; start live text from now.
                approx_seconds = max(0, len(wav) - 44) / 32_000
                if approx_seconds > 55:
                    self.segments.append(
                        {
                            "seq": self._next_seq(),
                            "at": datetime.now(timezone.utc).isoformat(),
                            "text": "(joined mid-meeting — the live transcript starts here; the full recording is still captured for the final note)",
                        }
                    )
                    continue
                if not google_speech.is_configured():
                    self.last_error = "Live transcription needs the Google Cloud voice key (Settings → Voice)."
                    continue
                try:
                    text = await google_speech.transcribe(wav, "audio/wav")
                except Exception as exc:  # noqa: BLE001
                    logger.warning("Live chunk STT failed: %s", exc)
                    continue
                text = (text or "").strip()
                if text:
                    self.segments.append(
                        {
                            "seq": self._next_seq(),
                            "at": datetime.now(timezone.utc).isoformat(),
                            "text": text,
                        }
                    )
        except asyncio.CancelledError:
            pass

    # ── assist loop ──────────────────────────────────────────────────────

    async def _assist_loop(self, get_db) -> None:
        try:
            while self.consent == "accepted":
                await asyncio.sleep(ASSIST_INTERVAL_SECONDS)
                try:
                    await self._assist_pass(get_db)
                except Exception:  # noqa: BLE001
                    logger.exception("Live assist pass failed")
        except asyncio.CancelledError:
            pass

    async def _assist_pass(self, get_db) -> None:
        full = self.transcript_text()
        if len(full) <= self.assist_cursor + 80:
            return  # not enough new speech to bother the model
        new_text = full[self.assist_cursor:]
        context_tail = full[-_ASSIST_WINDOW_CHARS:]
        self.assist_cursor = len(full)

        answers = self.options["answers"]
        company_block = ""
        async for db in get_db():
            try:
                from services.llm.router import get_llm_client

                client = await get_llm_client(db, task="daily_assistant")
            except Exception as exc:  # noqa: BLE001
                logger.info("Live assist: LLM unavailable (%s)", exc)
                return
            # HARD disclosure gate: company context ONLY in NDA mode.
            if answers == "nda":
                try:
                    from services.company_context import get_company_context

                    company_block = await get_company_context(db)
                except Exception:  # noqa: BLE001
                    company_block = ""
            break

        prompt = (
            _assist_instructions(self.options["jargon"], answers)
            + (f"\nTerms already defined: {', '.join(sorted(self.seen_terms))}" if self.seen_terms else "")
            + (f"\n\nCOMPANY CONTEXT (NDA in place):\n{company_block[:4000]}" if company_block else "")
            + f"\n\nEarlier transcript (context):\n{context_tail[: _ASSIST_WINDOW_CHARS - len(new_text)]}"
            + f"\n\nNEW transcript to analyze:\n{new_text[-_ASSIST_WINDOW_CHARS:]}"
        )
        try:
            chunk = await client.chat(
                [
                    {"role": "system", "content": _JARGON_SYSTEM},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.1,
            )
        except Exception as exc:  # noqa: BLE001
            logger.info("Live assist LLM call failed: %s", exc)
            return
        for card in _extract_cards(chunk.content):
            kind = card.get("kind")
            title = str(card.get("title", "")).strip()
            body = str(card.get("body", "")).strip()
            if not title or not body:
                continue
            if kind == "jargon":
                key = re.sub(r"\W+", "", title).lower()
                if not self.options["jargon"] or key in self.seen_terms:
                    continue
                self.seen_terms.add(key)
                self.add_card("jargon", title, body)
            elif kind == "answer" and answers != "off":
                if answers == "public":
                    body += "  (public-knowledge answer — no company data used)"
                self.add_card("answer", title, body)

    # ── full-audio reassembly for the final transcription pass ──────────

    def assemble_full_wav(self, tail_wav: bytes | None) -> bytes | None:
        """Concatenate the drained chunks + the recorder tail into one WAV."""
        parts: list[bytes] = []
        for p in self.chunk_paths:
            try:
                parts.append(p.read_bytes())
            except OSError:
                continue
        if tail_wav:
            parts.append(tail_wav)
        if not parts:
            return None
        if len(parts) == 1:
            return parts[0]
        frames = []
        params = None
        for blob in parts:
            try:
                with wave.open(io.BytesIO(blob), "rb") as wf:
                    if params is None:
                        params = wf.getparams()
                    frames.append(wf.readframes(wf.getnframes()))
            except Exception:  # noqa: BLE001
                continue
        if params is None or not frames:
            return tail_wav
        out = io.BytesIO()
        with wave.open(out, "wb") as wf:
            wf.setparams(params)
            for f in frames:
                wf.writeframes(f)
        return out.getvalue()

    def cleanup_chunks(self) -> None:
        for p in self.chunk_paths:
            try:
                p.unlink()
            except OSError:
                pass
        if self.chunk_dir is not None:
            try:
                self.chunk_dir.rmdir()
            except OSError:
                pass


def _extract_cards(text: str) -> list[dict]:
    if not text:
        return []
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        return []
    try:
        data = json.loads(text[start : end + 1])
    except Exception:  # noqa: BLE001
        return []
    cards = data.get("cards")
    return [c for c in cards if isinstance(c, dict)] if isinstance(cards, list) else []


# ── best-effort meeting pre-checks (party guess + NDA hint) ──────────────


async def precheck(get_db) -> tuple[str, str, str]:
    """(party display name, party email, NDA hint line) — all best-effort."""
    party, email, hint = "", "", ""
    try:
        from services import google_service as gs

        if gs.get_credentials():
            events = await asyncio.to_thread(lambda: gs.calendar_events(0, 1))
            now = datetime.now(timezone.utc)
            me = ""
            for e in events:
                try:
                    start = datetime.fromisoformat(str(e["start"]).replace("Z", "+00:00"))
                except (ValueError, KeyError):
                    continue
                delta = abs((start - now).total_seconds())
                if delta <= 45 * 60 and e.get("attendees"):
                    others = [a for a in e["attendees"] if isinstance(a, str) and a and a != me]
                    if others:
                        email = others[0] if "@" in others[0] else ""
                        party = others[0].split("@")[0].replace(".", " ").title() if email else others[0]
                        break
    except Exception:  # noqa: BLE001
        logger.debug("Live precheck: calendar lookup failed", exc_info=True)

    # NDA hint: cheap title search over the KB for an NDA naming the party.
    try:
        token = ""
        if email and "@" in email:
            token = email.split("@")[1].split(".")[0]
        elif party:
            token = party.split()[0]
        if token and len(token) >= 3:
            from sqlalchemy import and_, select

            from models.db.document import Document

            async for db in get_db():
                row = (
                    await db.execute(
                        select(Document.title).where(
                            and_(
                                Document.title.ilike("%nda%"),
                                Document.title.ilike(f"%{token}%"),
                                Document.deleted_at.is_(None),
                            )
                        ).limit(1)
                    )
                ).scalar_one_or_none()
                if row:
                    hint = f'NDA possibly on file: "{row}"'
                break
    except Exception:  # noqa: BLE001
        logger.debug("Live precheck: NDA lookup failed", exc_info=True)
    if not hint:
        hint = "No NDA found in the Knowledge Base — confirm before enabling NDA answers."
    return party, email, hint
