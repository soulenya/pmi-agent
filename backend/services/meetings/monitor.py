"""
Background meeting monitor.

A single process-wide loop that:
  1. Polls :func:`detect_active_meeting` on an interval.
  2. Debounces a detected call, then (if auto-record is enabled) starts capturing
     audio via :class:`MeetingRecorder`.
  3. When the call ends (after a grace period), transcribes the audio with
     Google STT v2, summarizes it, and persists a :class:`MeetingNote`.

The current status is exposed via :meth:`MeetingMonitor.snapshot` for the
``/meetings/recorder/status`` endpoint; the on/off toggle is persisted in the
``meetings.autorecord`` SystemSetting so it survives restarts.
"""

from __future__ import annotations

import asyncio
import json
import logging
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import func, select

from config import settings
from models.db.meeting import MeetingNote
from models.db.settings import SystemSetting
from models.db.user import User
from services.meetings.detector import detect_active_meeting
from services.meetings.recorder import MeetingRecorder, is_capture_supported
from services.voice import gcs_stt

logger = logging.getLogger(__name__)

_AUTORECORD_KEY = "meetings.autorecord"


async def _owner_user(db) -> User | None:
    """Resolve the local instance's primary user (configured admin, else first)."""
    email = (settings.admin_email or "").strip().lower()
    if email:
        row = (
            await db.execute(select(User).where(func.lower(User.email) == email))
        ).scalar_one_or_none()
        if row:
            return row
    row = (
        await db.execute(
            select(User).where(User.role == "admin").order_by(User.created_at)
        )
    ).scalars().first()
    if row:
        return row
    return (
        await db.execute(select(User).order_by(User.created_at))
    ).scalars().first()


class MeetingMonitor:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._recorder = MeetingRecorder()
        self._enabled = settings.meeting_autorecord_default
        self._get_db = None

        # Detection timing (monotonic seconds)
        self._detected_since: float | None = None
        self._gone_since: float | None = None
        self._current_platform: str | None = None
        self._prompted = False
        # True while a user-initiated (manual) recording is in progress, which
        # suspends the auto detect/finalize logic so only an explicit stop ends it.
        self._manual = False

        self._status: dict = {
            "enabled": self._enabled,
            "supported": is_capture_supported(),
            "configured": False,
            "state": "idle",           # idle | meeting_detected | recording | processing
            "platform": None,
            "started_at": None,
            "last_meeting_id": None,
            "last_error": None,
            "pending": 0,              # recordings on disk awaiting transcription
        }

    # ── Public API ────────────────────────────────────────────────────────────

    def snapshot(self) -> dict:
        with self._lock:
            return dict(self._status)

    def set_enabled(self, enabled: bool) -> None:
        """Update the in-memory toggle immediately (DB is the source of truth)."""
        self._enabled = enabled
        self._update(enabled=enabled)

    async def start_manual(self) -> dict:
        """Begin a user-initiated recording immediately (ignores auto-detection)."""
        if self._recorder.recording:
            # Already capturing (auto or manual) — adopt it as manual so the
            # grace timer can't auto-stop it; only an explicit stop will end it.
            self._manual = True
            return self.snapshot()
        if not is_capture_supported():
            self._update(last_error="This computer can't capture audio without a virtual audio device.")
            return self.snapshot()
        started = await asyncio.to_thread(
            self._recorder.start, settings.meeting_max_record_seconds
        )
        if not started:
            self._update(last_error="Couldn't start recording — no audio capture device was available.")
            return self.snapshot()
        self._manual = True
        self._current_platform = "Manual"
        self._detected_since = None
        self._gone_since = None
        self._update(
            state="recording",
            platform="Manual",
            started_at=datetime.now(timezone.utc).isoformat(),
            last_error=None,
        )
        logger.info("Manual recording started")
        return self.snapshot()

    async def stop_manual(self) -> dict:
        """Stop the current recording and transcribe/summarize it in the background."""
        self._manual = False
        if not self._recorder.recording:
            self._reset_detection()
            return self.snapshot()
        self._update(state="processing")
        # Transcription can take a while; finalize off the request path so the
        # button responds instantly and status polling reflects progress.
        asyncio.create_task(self._finalize_and_reset())
        return self.snapshot()

    async def _finalize_and_reset(self) -> None:
        try:
            await self._finalize_recording()
        finally:
            self._reset_detection()

    # ── Status helpers ────────────────────────────────────────────────────────

    def _update(self, **fields) -> None:
        with self._lock:
            self._status.update(fields)

    def _reset_detection(self) -> None:
        self._detected_since = None
        self._gone_since = None
        self._current_platform = None
        self._prompted = False
        self._update(state="idle", platform=None, started_at=None)

    async def _load_enabled(self) -> None:
        if self._get_db is None:
            return
        try:
            async for db in self._get_db():
                row = (
                    await db.execute(
                        select(SystemSetting).where(SystemSetting.key == _AUTORECORD_KEY)
                    )
                ).scalar_one_or_none()
                if row is not None and isinstance(row.value, bool):
                    self._enabled = row.value
                break
        except Exception:                       # noqa: BLE001
            logger.debug("Could not read autorecord setting", exc_info=True)
        self._update(enabled=self._enabled, configured=gcs_stt.is_configured())

    # ── Main loop ─────────────────────────────────────────────────────────────

    async def run(self, get_db) -> None:
        """Entry point started as a background task from the app lifespan."""
        self._get_db = get_db
        self._update(supported=is_capture_supported(), configured=gcs_stt.is_configured())
        # Resume any recording that was interrupted mid-transcription by a prior
        # restart/crash before entering the detection loop.
        try:
            await self.recover_pending()
        except Exception:                       # noqa: BLE001
            logger.exception("Pending-recording recovery failed")
        interval = max(2, settings.meeting_detect_interval_seconds)
        logger.info("Meeting monitor started (interval=%ds)", interval)
        try:
            while True:
                await asyncio.sleep(interval)
                try:
                    await self._tick()
                except Exception:               # noqa: BLE001
                    logger.exception("Meeting monitor tick error")
        except asyncio.CancelledError:
            if self._recorder.recording:
                try:
                    await asyncio.to_thread(self._recorder.stop)
                except Exception:               # noqa: BLE001
                    pass
            raise

    async def _tick(self) -> None:
        await self._load_enabled()
        # A manual recording owns the recorder; skip all auto detect/finalize.
        if self._manual:
            return
        platform = await asyncio.to_thread(detect_active_meeting)
        now = time.monotonic()

        if platform is not None:
            self._gone_since = None
            if self._detected_since is None:
                self._detected_since = now
                self._current_platform = platform
                logger.info("Meeting detected: %s", platform)

            debounce = max(0, settings.meeting_detect_debounce_seconds)
            ready = (now - self._detected_since) >= debounce

            if self._recorder.recording:
                return  # already capturing this meeting

            if ready and self._enabled and is_capture_supported():
                started = await asyncio.to_thread(
                    self._recorder.start, settings.meeting_max_record_seconds
                )
                if started:
                    self._update(
                        state="recording",
                        platform=platform,
                        started_at=datetime.now(timezone.utc).isoformat(),
                        last_error=None,
                    )
                else:
                    # No capture device / unsupported — surface as detected-only.
                    self._update(state="meeting_detected", platform=platform)
            elif ready:
                # Feature off (or capture unsupported): flag for the UI prompt.
                self._update(state="meeting_detected", platform=platform)
                self._prompted = True
        else:
            if self._detected_since is None:
                return
            if self._gone_since is None:
                self._gone_since = now
            grace = max(0, settings.meeting_end_grace_seconds)
            if (now - self._gone_since) >= grace:
                if self._recorder.recording:
                    await self._finalize_recording()
                else:
                    logger.info("Meeting ended (%s) — nothing recorded", self._current_platform)
                self._reset_detection()

    # ── Finalization ──────────────────────────────────────────────────────────

    def _pending_dir(self) -> Path:
        """Directory holding recordings persisted to disk awaiting transcription."""
        d = Path(settings.storage_root).expanduser().parent / "pending_recordings"
        d.mkdir(parents=True, exist_ok=True)
        return d

    def _write_pending(self, wav: bytes, platform: str, recorded_at: str) -> str:
        """Persist a recording (+ metadata) to disk so a crash can resume it."""
        pid = uuid.uuid4().hex
        d = self._pending_dir()
        (d / f"{pid}.wav").write_bytes(wav)
        (d / f"{pid}.json").write_text(
            json.dumps({"platform": platform, "recorded_at": recorded_at}),
            encoding="utf-8",
        )
        return pid

    def _discard_pending(self, pid: str) -> None:
        d = self._pending_dir()
        for ext in (".wav", ".json"):
            try:
                (d / f"{pid}{ext}").unlink()
            except OSError:
                pass

    def _pending_count(self) -> int:
        try:
            return len(list(self._pending_dir().glob("*.wav")))
        except OSError:
            return 0

    async def _finalize_recording(self) -> None:
        platform = self._current_platform or "Meeting"
        self._update(state="processing")
        wav = await asyncio.to_thread(self._recorder.stop)
        if not wav:
            self._update(state="idle", started_at=None)
            return

        recorded_at = datetime.now(timezone.utc)
        # Persist the audio to disk *before* transcribing so an app restart or
        # crash mid-transcription can resume it on next startup (recover_pending).
        pid: str | None = None
        try:
            pid = await asyncio.to_thread(
                self._write_pending, wav, platform, recorded_at.isoformat()
            )
        except Exception:                       # noqa: BLE001
            logger.exception("Could not persist pending recording to disk")

        await self._transcribe_and_save(wav, platform, recorded_at, pid)

    async def _transcribe_and_save(
        self,
        wav: bytes,
        platform: str,
        recorded_at: datetime,
        pid: str | None,
    ) -> bool:
        """Transcribe *wav* and persist a MeetingNote. On success, drop the
        on-disk pending copy. Returns True when a note was created."""
        try:
            if not gcs_stt.is_configured():
                logger.warning("Meeting recorded but STT v2 is not configured")
                self._update(
                    state="idle",
                    started_at=None,
                    last_error="Recording captured but transcription (Google STT v2) is not configured.",
                )
                return False  # keep the on-disk copy for a later retry

            transcript = await gcs_stt.transcribe_long(wav, "meeting.wav", "audio/wav")
            transcript = (transcript or "").strip() or "(No speech detected.)"

            async for db in self._get_db():
                user = await _owner_user(db)
                if user is None:
                    logger.warning("No user to attribute meeting note to")
                    break

                manual = platform == "Manual"
                stamp = recorded_at.astimezone().strftime("%b %d, %Y %I:%M %p")
                title = (
                    f"Recorded meeting — {stamp}"
                    if manual
                    else f"{platform} meeting — {stamp}"
                )
                tags = ["manual-recording"] if manual else ["auto-captured", platform.lower()]
                meeting = MeetingNote(
                    id=uuid.uuid4(),
                    title=title,
                    raw_transcript=transcript,
                    meeting_date=recorded_at,
                    attendees=[],
                    tags=tags,
                    generated_task_ids=[],
                    created_by=user.id,
                )

                # Summarize (best-effort; lazy import avoids an import cycle).
                try:
                    from routers.meetings import _llm_summarize

                    sections = await _llm_summarize(title, transcript, db)
                    meeting.summary = sections.get("summary")
                    meeting.decisions = sections.get("decisions")
                    meeting.action_items = sections.get("action_items")
                    meeting.next_steps = sections.get("next_steps")
                except Exception as exc:        # noqa: BLE001
                    logger.warning("Auto-summary failed: %s", exc)

                db.add(meeting)
                await db.commit()
                await db.refresh(meeting)
                self._update(
                    state="idle",
                    started_at=None,
                    last_meeting_id=str(meeting.id),
                    last_error=None,
                )
                logger.info("Meeting note created: %s", meeting.id)
                if pid:
                    await asyncio.to_thread(self._discard_pending, pid)
                self._update(pending=self._pending_count())
                return True
        except Exception as exc:                # noqa: BLE001
            logger.exception("Meeting finalization failed")
            self._update(state="idle", started_at=None, last_error=str(exc))
        return False

    async def recover_pending(self) -> int:
        """Resume recordings persisted to disk but never transcribed (e.g. the
        app quit mid-transcription). Returns the number of notes recovered."""
        try:
            wavs = sorted(self._pending_dir().glob("*.wav"))
        except OSError:
            return 0
        self._update(pending=len(wavs))
        if not wavs:
            return 0
        if not gcs_stt.is_configured():
            logger.info(
                "%d interrupted recording(s) on disk, but STT isn't configured "
                "yet — leaving them to recover later",
                len(wavs),
            )
            return 0

        logger.info("Recovering %d interrupted recording(s)…", len(wavs))
        recovered = 0
        for wav_path in wavs:
            pid = wav_path.stem
            platform = "Meeting"
            recorded_at = datetime.now(timezone.utc)
            meta_path = wav_path.with_suffix(".json")
            try:
                if meta_path.is_file():
                    meta = json.loads(meta_path.read_text(encoding="utf-8"))
                    platform = meta.get("platform") or platform
                    if meta.get("recorded_at"):
                        recorded_at = datetime.fromisoformat(meta["recorded_at"])
            except Exception:                   # noqa: BLE001
                logger.debug("Bad pending metadata for %s", pid, exc_info=True)
            try:
                wav = await asyncio.to_thread(wav_path.read_bytes)
            except OSError:
                continue
            self._update(state="processing", platform=f"{platform} (recovering)")
            if await self._transcribe_and_save(wav, platform, recorded_at, pid):
                recovered += 1

        self._update(state="idle", platform=None, pending=self._pending_count())
        if recovered:
            logger.info("Recovered %d interrupted recording(s)", recovered)
        return recovered


# Process-wide singleton — imported by the app lifespan and the meetings router.
meeting_monitor = MeetingMonitor()
