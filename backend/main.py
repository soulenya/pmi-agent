"""
PMI Agent — FastAPI application factory.
Binds to 127.0.0.1 only. CORS restricted to Tauri + localhost origins.
"""

from __future__ import annotations

import asyncio
import json
import logging
import logging.handlers
import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from config import settings
from database import engine, get_db
from routers import audit, auth, documents, health, search, users
from routers.conversations import approvals_router, notifications_router, router as conversations_router
from routers.tasks import projects_router, router as tasks_router
from routers.project_space import router as project_space_router
from routers.regulatory import capa_router, router as regulatory_router
from routers.regulatory_files import router as regulatory_files_router
from routers.regulatory_templates import router as regulatory_templates_router
from routers.briefings import router as briefings_router
from routers.browser import router as browser_router
from routers.research import router as research_router
from routers.settings import router as settings_router
from routers.meetings import router as meetings_router
from routers.emails import router as emails_router
from routers.update import router as update_router
from routers.google_integration import router as google_router
from routers.conversation_backup import router as backups_router
from routers.data_transfer import router as data_transfer_router
from routers.odoo_integration import router as odoo_router
from routers.files import router as files_router
from routers.feedback import router as feedback_router
from routers.workrooms import router as workrooms_router
from routers.budgets import router as budgets_router
from routers.assistant import router as assistant_router
from routers.extractions import router as extractions_router
from routers.scheduled_tasks import router as scheduled_tasks_router
from routers.voice import router as voice_router
from routers.writing_voice import router as writing_voice_router
from routers.push import router as push_router
from sqlalchemy import text

logger = logging.getLogger(__name__)

# ── Persistent file logging ───────────────────────────────────────────────────

def _configure_logging() -> None:
    log_dir = Path(__file__).parent / "logs"
    log_dir.mkdir(exist_ok=True)
    log_file = log_dir / "app.log"

    fmt = logging.Formatter(
        "%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # Rotate at 5 MB, keep 5 backups (~25 MB max)
    file_handler = logging.handlers.RotatingFileHandler(
        log_file, maxBytes=5 * 1024 * 1024, backupCount=5, encoding="utf-8"
    )
    file_handler.setFormatter(fmt)
    file_handler.setLevel(logging.WARNING)

    # Also send INFO+ to the console window (existing uvicorn behaviour)
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(fmt)
    console_handler.setLevel(logging.INFO)

    root = logging.getLogger()
    root.setLevel(logging.INFO)
    # Avoid adding duplicate handlers on reload
    if not any(isinstance(h, logging.handlers.RotatingFileHandler) for h in root.handlers):
        root.addHandler(file_handler)
    if not any(isinstance(h, logging.StreamHandler) and not isinstance(h, logging.handlers.RotatingFileHandler) for h in root.handlers):
        root.addHandler(console_handler)

    logger.info("Logging to %s", log_file)

_configure_logging()

limiter = Limiter(key_func=get_remote_address)


# ── WebSocket connection manager ──────────────────────────────────────────────

class ConnectionManager:
    """In-memory WebSocket registry for real-time notification push, keyed by user_id string."""

    def __init__(self) -> None:
        self._conns: dict[str, list[WebSocket]] = {}

    async def connect(self, user_id: str, ws: WebSocket) -> None:
        self._conns.setdefault(user_id, []).append(ws)

    def disconnect(self, user_id: str, ws: WebSocket) -> None:
        bucket = self._conns.get(user_id, [])
        if ws in bucket:
            bucket.remove(ws)

    async def push(self, user_id: str, data: dict[str, Any]) -> None:
        """Send a JSON frame to all active connections for user_id, dropping dead sockets."""
        dead: list[WebSocket] = []
        for ws in list(self._conns.get(user_id, [])):
            try:
                await ws.send_text(json.dumps(data))
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(user_id, ws)


# Module-level singleton — imported by the WS endpoint and notification generator
notification_manager = ConnectionManager()


# ── Background notification loop ──────────────────────────────────────────────

async def _notification_loop() -> None:
    """Generate overdue-task and expiring-approval notifications every 60 seconds."""
    from services.notifications.generator import generate_notifications

    while True:
        await asyncio.sleep(60)
        try:
            async for db in get_db():
                new_notifs = await generate_notifications(db)
                for notif in new_notifs:
                    await notification_manager.push(
                        str(notif.user_id),
                        {
                            "type": "notification",
                            "id": str(notif.id),
                            "title": notif.title,
                            "notif_type": notif.type,
                        },
                    )
        except Exception:
            logger.exception("Notification loop error")


# ── Running background work as a named user ──────────────────────────────────
# Every background job used to run as the single install owner. On the hub each
# person is a named user with their own Google grant, so the jobs that touch
# Google run once per person, bound to that person.

async def _google_users(db) -> list:
    """Users who have connected Google, in a stable order."""
    from models.db.user import User
    from services import google_user_creds
    from sqlalchemy import select

    ids = await google_user_creds.users_with_credentials(db)
    if not ids:
        return []
    rows = await db.execute(
        select(User).where(User.id.in_(ids), User.is_active.is_(True)).order_by(User.created_at)
    )
    return list(rows.scalars())


async def _as_google_user(user_id, coro) -> None:
    """Await *coro* with *user_id* bound, so get_credentials() resolves to them."""
    from services import google_user_creds

    token = google_user_creds.bind_user(user_id)
    try:
        async for db in get_db():
            await google_user_creds.load_into_cache(db, user_id)
        await coro
    finally:
        google_user_creds.reset_user(token)


# ── Background Drive update-check loop ────────────────────────────────────────

# Local clock times (24h) at which to scan Drive-linked documents for updates.
DRIVE_CHECK_HOURS = (6, 12, 18)


def _seconds_until_next_check(now: datetime) -> float:
    """Seconds from ``now`` until the next scheduled DRIVE_CHECK_HOURS time."""
    candidates = []
    for day_offset in (0, 1):
        base = (now + timedelta(days=day_offset)).replace(
            minute=0, second=0, microsecond=0
        )
        for hour in DRIVE_CHECK_HOURS:
            candidate = base.replace(hour=hour)
            if candidate > now:
                candidates.append(candidate)
    nxt = min(candidates)
    return max(1.0, (nxt - now).total_seconds())


async def _drive_sync_loop() -> None:
    """Scan Drive-linked documents for updates at 06:00, 12:00, and 18:00 local time."""
    from services.documents.sync import check_document_updates

    async def _check(owner_id=None) -> None:
        async for db in get_db():
            summary = await check_document_updates(db, owner_id)
            for item in summary.get("items", []):
                if item.get("notify") and item.get("user_id"):
                    await notification_manager.push(
                        item["user_id"],
                        {
                            "type": "notification",
                            "entity_id": item["id"],
                            "title": f"Document update available: {item['title']}",
                            "notif_type": "system_alert",
                        },
                    )
            logger.info(
                "Drive update check complete: %s document(s) flagged",
                summary.get("changed", 0),
            )

    while True:
        delay = _seconds_until_next_check(datetime.now())
        await asyncio.sleep(delay)
        try:
            if not settings.hub_mode:
                await _check()
                continue
            # Each person's linked files are readable only with their own grant.
            async for db in get_db():
                users = await _google_users(db)
            for user in users:
                await _as_google_user(user.id, _check(user.id))
        except Exception:
            logger.exception("Drive sync loop error")


# ── Background daily-assistant scan loop ──────────────────────────────────────

async def _push_scan_notifications(notifications) -> None:
    for n in notifications:
        await notification_manager.push(
            n["user_id"],
            {
                "type": "notification",
                "entity_id": n["id"],
                "title": n["title"],
                "notif_type": "reminder",
            },
        )


async def _run_assistant_scan_for(user=None, include_shared: bool = False) -> None:
    """Run one person's daily scan and push their notifications."""
    from services.assistant import daily_scan
    from services.embeddings.service import get_embedding_service_for_db

    async for db in get_db():
        embedding_svc = await get_embedding_service_for_db(db)
        summary = await daily_scan.run_daily_scan(
            db, embedding_svc, user=user, include_shared=include_shared
        )
        await _push_scan_notifications(summary.get("notifications", []))
        logger.info(
            "Assistant scan%s: %s suggestion(s), %s import(s)%s",
            f" for {user.email}" if user is not None else "",
            summary.get("created", 0),
            summary.get("imported", 0),
            f" (skipped: {summary['skipped']})" if summary.get("skipped") else "",
        )


async def _run_assistant_scan() -> None:
    """Desktop path: one user, one Google grant, one scan including the
    company-wide half."""
    await _run_assistant_scan_for(None, include_shared=True)


def _seconds_until_hour(now: datetime, hour: int) -> float:
    """Seconds from ``now`` until the next occurrence of ``hour`` (local)."""
    target = now.replace(hour=max(0, min(23, hour)), minute=0, second=0, microsecond=0)
    if target <= now:
        target = target + timedelta(days=1)
    return max(1.0, (target - now).total_seconds())


def _ran_today(stamp) -> bool:
    """True when an ISO timestamp falls on today's date in its own timezone."""
    if not stamp:
        return False
    try:
        last = datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))
    except Exception:
        return False
    return last.date() == datetime.now(last.tzinfo).date()


async def _hub_assistant_scan_loop() -> None:
    """Per-person daily scans on the hub.

    People keep different hours, so instead of waking once at one configured
    time this ticks hourly and runs whoever is due: their own enabled flag,
    their own hour, their own last-run stamp. The company-wide half — budget
    nudges and workroom digests — still runs once, at the install's hour.
    """
    from services.assistant import daily_scan
    from services import user_settings

    while True:
        try:
            due: list = []
            shared_due = False
            async for db in get_db():
                now_hour = datetime.now().hour
                shared_hour = int(
                    await daily_scan.get_setting(
                        db, daily_scan.SETTING_HOUR, daily_scan.DEFAULT_HOUR
                    )
                )
                shared_enabled = await daily_scan.get_setting(
                    db, daily_scan.SETTING_ENABLED, daily_scan.DEFAULT_ENABLED
                )
                shared_stamp = await daily_scan.get_setting(
                    db, "assistant_scan.shared_last_run", None
                )
                shared_due = (
                    shared_enabled
                    and now_hour >= shared_hour
                    and not _ran_today(shared_stamp)
                )

                for user in await _google_users(db):
                    enabled = await daily_scan.get_user_setting(
                        db, user, daily_scan.SETTING_ENABLED, daily_scan.DEFAULT_ENABLED
                    )
                    hour = int(
                        await daily_scan.get_user_setting(
                            db, user, daily_scan.SETTING_HOUR, daily_scan.DEFAULT_HOUR
                        )
                    )
                    stamp = await user_settings.get(
                        db, user.id, daily_scan.SETTING_LAST_RUN, None
                    )
                    if enabled and now_hour >= hour and not _ran_today(stamp):
                        due.append(user)

            if shared_due:
                async for db in get_db():
                    shared = await daily_scan.run_shared_daily(db)
                    await daily_scan.set_setting(
                        db, "assistant_scan.shared_last_run", daily_scan._now_iso()
                    )
                    await db.commit()
                    await _push_scan_notifications(shared.get("notifications", []))

            for user in due:
                await _as_google_user(user.id, _run_assistant_scan_for(user))
        except Exception:
            logger.exception("Assistant scan loop error")

        # Tick at the top of the next hour.
        now = datetime.now()
        await asyncio.sleep(max(60.0, 3600 - (now.minute * 60 + now.second)))


async def _assistant_scan_loop() -> None:
    """Run the assistant scan once a day at the configured local hour (default 07:00).

    Also performs a catch-up run on startup if today's scan has not happened yet.
    """
    from services.assistant import daily_scan

    if settings.hub_mode:
        await _hub_assistant_scan_loop()
        return

    # Startup catch-up: run now if enabled and we haven't scanned yet today.
    try:
        async for db in get_db():
            enabled = await daily_scan.get_setting(
                db, daily_scan.SETTING_ENABLED, daily_scan.DEFAULT_ENABLED
            )
            last_run = await daily_scan.get_setting(db, daily_scan.SETTING_LAST_RUN, None)
        ran_today = False
        if last_run:
            try:
                last_dt = datetime.fromisoformat(str(last_run).replace("Z", "+00:00"))
                ran_today = last_dt.date() == datetime.now(last_dt.tzinfo).date()
            except Exception:
                ran_today = False
        if enabled and not ran_today:
            await _run_assistant_scan()
    except Exception:
        logger.exception("Assistant scan startup catch-up error")

    while True:
        try:
            async for db in get_db():
                hour = await daily_scan.get_setting(
                    db, daily_scan.SETTING_HOUR, daily_scan.DEFAULT_HOUR
                )
            delay = _seconds_until_hour(datetime.now(), int(hour))
        except Exception:
            delay = _seconds_until_hour(datetime.now(), daily_scan.DEFAULT_HOUR)
        await asyncio.sleep(delay)
        try:
            async for db in get_db():
                enabled = await daily_scan.get_setting(
                    db, daily_scan.SETTING_ENABLED, daily_scan.DEFAULT_ENABLED
                )
            if enabled:
                await _run_assistant_scan()
        except Exception:
            logger.exception("Assistant scan loop error")


# ── Background scheduled-tasks loop ───────────────────────────────────────────

async def _scheduled_tasks_loop() -> None:
    """Run user-defined recurring tasks (daily/weekly/monthly) when they come due."""
    from services.scheduler.runner import backfill_next_run, scheduled_tasks_loop

    # On startup, give any enabled task without a next_run_at a fresh schedule.
    try:
        async for db in get_db():
            await backfill_next_run(db)
    except Exception:
        logger.exception("Scheduled-tasks backfill error")

    await scheduled_tasks_loop(get_db, notification_manager)


# ── Background Gerry-draft cleanup loop ───────────────────────────────────────

async def _gerry_draft_cleanup_loop() -> None:
    """Once a day (03:00 local), delete unreviewed Gerry-generated email drafts
    from previous days, along with their still-pending approval intents.

    Also runs a catch-up on startup so stale drafts are cleared promptly.
    """
    from services.email_cleanup import cleanup_stale_gerry_drafts

    cleanup_hour = 3

    try:
        async for db in get_db():
            await cleanup_stale_gerry_drafts(db)
    except Exception:
        logger.exception("Gerry draft cleanup startup error")

    while True:
        delay = _seconds_until_hour(datetime.now(), cleanup_hour)
        await asyncio.sleep(delay)
        try:
            async for db in get_db():
                await cleanup_stale_gerry_drafts(db)
        except Exception:
            logger.exception("Gerry draft cleanup loop error")

# ── Background conversation-backup loop ─────────────────────────────────────────

async def _conversation_backup_loop() -> None:
    """Once a day (configurable hour, default 02:00 local), write a signed,
    tamper-evident backup of every conversation — locally and to Drive.

    On the hub this runs once per person, over their own conversations and into
    their own Drive: conversations are private, so a single combined file would
    hand everyone's chats to whoever owned the folder it landed in.

    No-op while backups are disabled; the schedule is re-read each cycle.
    """
    from services.conversation_backup import DEFAULT_HOUR, get_config, run_backup

    if settings.hub_mode:
        await _hub_conversation_backup_loop()
        return

    while True:
        try:
            async for db in get_db():
                cfg = await get_config(db)
            hour = int(cfg.get("hour", DEFAULT_HOUR))
        except Exception:
            hour = DEFAULT_HOUR
        delay = _seconds_until_hour(datetime.now(), hour)
        await asyncio.sleep(delay)
        try:
            async for db in get_db():
                cfg = await get_config(db)
                if not cfg.get("enabled"):
                    continue
                await run_backup(db, reason="scheduled")
        except Exception:
            logger.exception("Conversation backup loop error")


async def _hub_conversation_backup_loop() -> None:
    """Back each person up at their own hour, into their own Drive.

    Ticks hourly rather than sleeping to one time, because people no longer
    share a schedule; a per-user stamp keeps a restart from repeating a backup.
    """
    from services import user_settings
    from services.conversation_backup import (
        DEFAULT_ENABLED,
        DEFAULT_HOUR,
        ENABLED_KEY,
        HOUR_KEY,
        LAST_RUN_KEY,
        _get_for,
        run_backup,
    )

    while True:
        try:
            due: list = []
            async for db in get_db():
                now_hour = datetime.now().hour
                for user in await _google_users(db):
                    enabled = await _get_for(db, user.id, ENABLED_KEY, DEFAULT_ENABLED)
                    hour = int(await _get_for(db, user.id, HOUR_KEY, DEFAULT_HOUR))
                    stamp = await user_settings.get(db, user.id, LAST_RUN_KEY, None)
                    if enabled and now_hour >= hour and not _ran_today(stamp):
                        due.append(user)

            for user in due:
                async for db in get_db():
                    await _as_google_user(
                        user.id,
                        run_backup(db, reason="scheduled", owner_id=user.id),
                    )
                    await user_settings.set_value(
                        db, user.id, LAST_RUN_KEY, datetime.now().astimezone().isoformat()
                    )
                    await db.commit()
        except Exception:
            logger.exception("Conversation backup loop error")

        now = datetime.now()
        await asyncio.sleep(max(60.0, 3600 - (now.minute * 60 + now.second)))

# ── Background model-catalog refresh loop ───────────────────────────────────────

async def _model_catalog_loop() -> None:
    """Keep the LLM model catalog fresh (refreshed when older than a week).

    Checks staleness daily; get_model_catalog only re-discovers when the
    stored catalog is missing or older than CATALOG_MAX_AGE_DAYS.
    """
    from services.llm.catalog import get_model_catalog

    while True:
        try:
            async for db in get_db():
                await get_model_catalog(db, refresh_if_stale=True)
        except Exception:
            logger.exception("Model catalog refresh error")
        await asyncio.sleep(24 * 3600)

# ── Background meeting-capture monitor ──────────────────────────────────────────

async def _meeting_monitor_loop() -> None:
    """Watch for active video calls and auto-record + transcribe them."""
    if settings.hub_mode:
        # Capture reads this machine's audio devices and running processes,
        # which on a shared server belong to nobody.
        logger.info("Meeting capture disabled: hub deployment")
        return
    from services.meetings.monitor import meeting_monitor

    await meeting_monitor.run(get_db)

# ── Lifespan ──────────────────────────────────────────────────────────────────
async def _company_context_sync_once() -> None:
    """One-shot startup refresh of the company-context cache from Drive.

    Fire-and-continue: a failed or slow sync (Google disconnected, network
    down, file missing) must never block or fail backend startup.
    """
    try:
        from services.company_context import sync_company_context_from_drive

        ok = False
        if settings.hub_mode:
            # The context file is company-wide, but reading it still needs a
            # real person's Drive access. Use the first connected admin, then
            # anyone connected.
            async for db in get_db():
                users = await _google_users(db)
            reader = next((u for u in users if u.role == "admin"), None) or (
                users[0] if users else None
            )
            if reader is None:
                logger.info("Company context startup sync: skipped (nobody connected)")
                return

            async def _sync() -> None:
                nonlocal ok
                async for db in get_db():
                    ok = await sync_company_context_from_drive(db)

            await _as_google_user(reader.id, _sync())
        else:
            async for db in get_db():
                ok = await sync_company_context_from_drive(db)
        logger.info("Company context startup sync: %s", "ok" if ok else "skipped/failed")
    except Exception:
        logger.exception("Company context startup sync error")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Verify DB connectivity at startup — retry for up to 30 s so the backend
    # survives a slow Docker/PostgreSQL start after a restart or update.
    for _attempt in range(10):
        try:
            async with engine.begin() as conn:
                await conn.execute(text("SELECT 1"))
            break
        except Exception as exc:
            if _attempt == 9:
                raise
            logger.warning("DB not ready yet (attempt %d/10): %s — retrying in 3 s", _attempt + 1, exc)
            await asyncio.sleep(3)
    bg_task = asyncio.create_task(_notification_loop())
    drive_task = asyncio.create_task(_drive_sync_loop())
    assistant_task = asyncio.create_task(_assistant_scan_loop())
    scheduler_task = asyncio.create_task(_scheduled_tasks_loop())
    catalog_task = asyncio.create_task(_model_catalog_loop())
    meeting_task = asyncio.create_task(_meeting_monitor_loop())
    cleanup_task = asyncio.create_task(_gerry_draft_cleanup_loop())
    backup_task = asyncio.create_task(_conversation_backup_loop())
    # One-shot: refresh the company-context cache from Drive (never blocks boot).
    company_ctx_task = asyncio.create_task(_company_context_sync_once())
    yield
    bg_task.cancel()
    drive_task.cancel()
    assistant_task.cancel()
    scheduler_task.cancel()
    catalog_task.cancel()
    meeting_task.cancel()
    cleanup_task.cancel()
    backup_task.cancel()
    company_ctx_task.cancel()
    for _t in (bg_task, drive_task, assistant_task, scheduler_task, catalog_task, meeting_task, cleanup_task, backup_task, company_ctx_task):
        try:
            await _t
        except asyncio.CancelledError:
            pass
    await engine.dispose()


# ── App factory ───────────────────────────────────────────────────────────────

def create_app() -> FastAPI:
    app = FastAPI(
        title="PMI Agent API",
        version="0.1.0",
        docs_url="/docs" if settings.debug else None,
        redoc_url="/redoc" if settings.debug else None,
        lifespan=lifespan,
    )

    # Rate limiting
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

    # CORS — Tauri desktop shell + local dev server by default; the hub
    # overrides settings.cors_origins with its own origin.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

    # Routers
    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(audit.router)
    app.include_router(users.router)
    app.include_router(documents.router)
    app.include_router(search.router)
    app.include_router(conversations_router)
    app.include_router(approvals_router)
    app.include_router(notifications_router)
    app.include_router(tasks_router)
    app.include_router(projects_router)
    app.include_router(project_space_router)
    app.include_router(regulatory_router)
    app.include_router(capa_router)
    app.include_router(regulatory_files_router)
    app.include_router(regulatory_templates_router)
    app.include_router(briefings_router)
    app.include_router(browser_router)
    app.include_router(research_router)
    app.include_router(settings_router)
    app.include_router(voice_router)
    app.include_router(writing_voice_router)
    app.include_router(meetings_router)
    app.include_router(emails_router)
    app.include_router(update_router)
    app.include_router(google_router)
    app.include_router(backups_router)
    app.include_router(data_transfer_router)
    app.include_router(odoo_router)
    app.include_router(files_router)
    app.include_router(feedback_router)
    app.include_router(workrooms_router)
    app.include_router(budgets_router)
    app.include_router(assistant_router)
    app.include_router(scheduled_tasks_router)
    app.include_router(extractions_router)
    app.include_router(push_router)

    from routers.agents import router as agents_router
    app.include_router(agents_router)

    # ── WebSocket: real-time chat stream ─────────────────────────────────────
    @app.websocket("/ws/chat/{conversation_id}")
    async def ws_chat(websocket: WebSocket, conversation_id: str) -> None:
        """
        WebSocket endpoint for streaming AI responses.

        Authentication: pass JWT access token as query param `?token=<jwt>`
        (standard browsers cannot set Authorization headers on WebSocket upgrades).

        Client → server: {"type": "human", "content": "<user message>"}
        Server → client: WSToken | WSDone | WSError (JSON strings)
        """
        from models.schemas.conversations import WSError, WSIncoming
        from services.auth.service import AuthService

        # ── Authenticate via query param token ────────────────────────────────
        token = websocket.query_params.get("token", "")
        if not token:
            await websocket.close(code=4401, reason="Missing token")
            return

        async for db in get_db():
            auth_svc = AuthService(db)
            user = await auth_svc.get_user_from_access_token(token)
            if user is None:
                await websocket.close(code=4401, reason="Invalid token")
                return

            await websocket.accept()
            logger.info("WebSocket connected: user=%s conversation=%s", user.id, conversation_id)

            # Verify conversation belongs to user
            from repositories.conversation_repo import ConversationRepository
            import uuid as uuid_mod
            try:
                conv_uuid = uuid_mod.UUID(conversation_id)
            except ValueError:
                await websocket.send_text(WSError(detail="Invalid conversation ID.").model_dump_json())
                await websocket.close()
                return

            conv_repo = ConversationRepository(db)
            conv = await conv_repo.get(conv_uuid, user.id)
            if conv is None:
                await websocket.send_text(WSError(detail="Conversation not found.").model_dump_json())
                await websocket.close()
                return

            try:
                while True:
                    raw = await websocket.receive_text()
                    try:
                        incoming = WSIncoming.model_validate_json(raw)
                    except Exception:
                        await websocket.send_text(
                            WSError(detail="Invalid message format.").model_dump_json()
                        )
                        continue

                    if incoming.type == "ping":
                        await websocket.send_text('{"type":"pong"}')
                        continue

                    if incoming.type != "human" or not incoming.content.strip():
                        continue

                    # Feature flag: llm.use_langgraph = "true" enables v2 supervisor.
                    # Conversations pinned to the House Manager (voice sessions)
                    # always use the v2 path, since that agent only exists there.
                    from routers.settings import _get_setting as _gs
                    _use_lg = str(await _gs(db, "llm.use_langgraph") or "false").lower() == "true"
                    _conv_agent = getattr(conv.agent_type, "value", conv.agent_type)
                    if _conv_agent == "house_manager":
                        _use_lg = True

                    # Run the agent in a DETACHED background task with its own DB
                    # session, forwarding frames via a queue. If the client
                    # disconnects (e.g. navigates away), the run keeps going to
                    # completion and persists its answer — it is not cancelled.
                    from services.agent.stream_runner import spawn_agent_run

                    frame_queue: asyncio.Queue[str | None] = asyncio.Queue()
                    spawn_agent_run(
                        user.id,
                        conv_uuid,
                        incoming.content.strip(),
                        frame_queue,
                        _use_lg,
                        voice=incoming.voice,
                    )
                    while True:
                        frame = await frame_queue.get()
                        if frame is None:
                            break
                        await websocket.send_text(frame)

            except WebSocketDisconnect:
                logger.info("WebSocket disconnected: user=%s conversation=%s", user.id, conversation_id)
            except Exception as exc:
                logger.exception("WebSocket error: %s", exc)
                try:
                    await websocket.send_text(WSError(detail="Internal server error.").model_dump_json())
                    await websocket.close()
                except Exception:
                    pass
            break  # exit the get_db() generator after one iteration

    # ── WebSocket: real-time notification push ────────────────────────────────
    @app.websocket("/ws/notifications")
    async def ws_notifications(websocket: WebSocket) -> None:
        """
        WebSocket endpoint for real-time notification push.

        Authentication: ?token=<jwt> query param (same as chat WS).
        Server → client: {"type":"init","unread_count":<n>}
                         {"type":"notification","id":"<uuid>","title":"<str>","notif_type":"<str>"}
        """
        from repositories.conversation_repo import NotificationRepository
        from services.auth.service import AuthService

        token = websocket.query_params.get("token", "")
        if not token:
            await websocket.close(code=4401, reason="Missing token")
            return

        async for db in get_db():
            auth_svc = AuthService(db)
            user = await auth_svc.get_user_from_access_token(token)
            if user is None:
                await websocket.close(code=4401, reason="Invalid token")
                return

            await websocket.accept()
            user_id = str(user.id)
            await notification_manager.connect(user_id, websocket)
            logger.info("Notifications WS connected: user=%s", user_id)

            # Send unread count on connect
            notif_repo = NotificationRepository(db)
            unread = await notif_repo.list_for_user(user.id, unread_only=True, limit=50)
            await websocket.send_text(
                json.dumps({"type": "init", "unread_count": len(unread)})
            )

            try:
                while True:
                    # Keep alive — ignore any client messages (ping frames handled by WS protocol)
                    await websocket.receive_text()
            except WebSocketDisconnect:
                logger.info("Notifications WS disconnected: user=%s", user_id)
            except Exception as exc:
                logger.debug("Notifications WS error: %s", exc)
            finally:
                notification_manager.disconnect(user_id, websocket)
            break

    # ── Built frontend ───────────────────────────────────────────────────────
    # Baked into the hub image. Desktop installs run Vite separately, so this
    # directory is absent there and the app stays API-only.
    _dist = (Path(__file__).parent / "static").resolve()
    if _dist.is_dir():
        app.mount("/assets", StaticFiles(directory=_dist / "assets"), name="assets")

        @app.get("/{spa_path:path}", include_in_schema=False)
        async def serve_spa(spa_path: str) -> FileResponse:
            candidate = (_dist / spa_path).resolve()
            if spa_path and candidate.is_relative_to(_dist) and candidate.is_file():
                return FileResponse(candidate)
            return FileResponse(_dist / "index.html")

    return app


app = create_app()


# ── Entry point (uvicorn direct) ─────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=settings.host,  # 127.0.0.1 on desktop; the hub sets HOST=0.0.0.0
        port=settings.port,
        reload=settings.debug,
    )
