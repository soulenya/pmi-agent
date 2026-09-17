"""The hub, seen from the desktop.

Every shared read and write goes over the wire to the hub and nothing is cached
locally, so the hub stays the single copy and custody keeps meaning what it
says. The desktop is a window onto it, not a second master.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import uuid as _uuid

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database import get_db
from dependencies import get_current_user
from models.db.user import User
from services.hub import client as hub

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/hub", tags=["hub"])

# Scopes IAP tokens to the shared workspace. The desktop has no business
# proxying a person's private hub data, and an open proxy would hand the
# renderer a way to call anything at all on the far side.
#
# ``/conversations`` and ``/budgets`` are here because a shared project's
# conversation and its budget live on the hub with the rest of it. Both routers
# scope every read to the calling user or to project membership, so widening the
# proxy does not widen what anyone can see. ``/team`` is people talking to
# people, which only makes sense on the shared copy; ``/notifications`` carries
# the @mentions that conversation produces, scoped to the calling user.
_ALLOWED_PREFIXES = (
    "/projects",
    "/tasks",
    "/workrooms",
    "/portfolio",
    "/conversations",
    "/budgets",
    "/search/everything",
    "/team",
    "/notifications",
)

_SCOPES = ["openid", "email"]

# Keyed by auth_id, same shape as the Google SSO flow the login page uses.
_connect_sessions: dict[str, dict] = {}
_connect_lock = threading.Lock()


class ConnectRequest(BaseModel):
    hub_url: str | None = None


class HubStatus(BaseModel):
    available: bool
    connected: bool
    hub_url: str
    email: str | None = None
    last_error: str | None = None
    # True when this app IS the hub: the browser is already on it, so shared
    # work is served from here and nothing is proxied.
    here: bool = False
    # Who this person is on the hub. Differs from the desktop's own user id.
    hub_user_id: str | None = None


async def _remember_hub_user(db: AsyncSession, link) -> None:
    """Fill in the hub's id for this person if the link predates the column."""
    if link is None or link.hub_user_id is not None:
        return
    try:
        resp = await hub.request(db, link.user_id, "GET", "/settings/me")
    except hub.HubError:
        return
    if resp.status_code != 200:
        return
    raw = (resp.json() or {}).get("id")
    try:
        link.hub_user_id = _uuid.UUID(str(raw))
    except (ValueError, TypeError):
        return
    await db.flush()


def _hub_url(requested: str | None = None) -> str:
    url = (requested or settings.hub_url or "").strip().rstrip("/")
    if not url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No hub address is configured for this build.",
        )
    if not url.startswith("https://"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The hub address must be an https:// URL.",
        )
    return url


def _guard_desktop() -> None:
    if settings.hub_mode:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="This is the hub.",
        )


@router.get("/status", response_model=HubStatus)
async def hub_status(
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> HubStatus:
    if settings.hub_mode:
        # A browser on the hub used to be told 404 here, which the app read as
        # "not connected" and switched off everything shared.
        return HubStatus(
            available=True,
            connected=True,
            hub_url=(settings.hub_url or str(request.base_url)).rstrip("/"),
            email=current_user.email,
            here=True,
        )
    await hub.ensure_client_file()
    configured = hub.configured()
    link = await hub.get_link(db, current_user.id)
    if link is not None:
        await _remember_hub_user(db, link)
        await db.commit()
    return HubStatus(
        available=configured,
        connected=link is not None,
        hub_url=(link.hub_url if link else (settings.hub_url or "")),
        email=link.email if link else None,
        last_error=link.last_error if link else None,
        hub_user_id=str(link.hub_user_id) if link and link.hub_user_id else None,
    )


def _run_connect_flow(auth_id: str, hub_url: str) -> None:
    """Sign in to Google in a browser and keep the refresh token."""
    try:
        from google_auth_oauthlib.flow import InstalledAppFlow

        # Asking for `email` gets userinfo.email back, so the granted set never
        # equals the requested set and oauthlib would call that an error.
        os.environ.setdefault("OAUTHLIB_RELAX_TOKEN_SCOPE", "1")

        client_id, client_secret = hub.desktop_client()
        flow = InstalledAppFlow.from_client_config(
            {
                "installed": {
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": hub.TOKEN_URL,
                }
            },
            _SCOPES,
        )
        creds = flow.run_local_server(port=0, open_browser=True, prompt="consent")
        if not creds.refresh_token:
            raise ValueError(
                "Google did not return a lasting sign-in. Remove the app from "
                "your Google account permissions and try again."
            )
        from routers.auth import _decode_id_token

        claims = _decode_id_token(creds.id_token) if creds.id_token else {}
        email = (claims.get("email") or "").lower()
        if not email:
            raise ValueError("Google did not say which account signed in.")
        with _connect_lock:
            _connect_sessions[auth_id] = {
                "status": "done",
                "email": email,
                "refresh_token": creds.refresh_token,
                "hub_url": hub_url,
            }
    except Exception as exc:  # noqa: BLE001 — surfaced to the user verbatim
        logger.warning("Hub connect failed: %s", exc)
        with _connect_lock:
            _connect_sessions[auth_id] = {"status": "error", "error_msg": str(exc)}


@router.post("/connect/initiate")
async def connect_initiate(
    body: ConnectRequest | None = None,
    current_user: User = Depends(get_current_user),
) -> dict:
    """Open a browser so this person can sign in to the hub as themselves."""
    _guard_desktop()
    url = _hub_url(body.hub_url if body else None)
    await hub.ensure_client_file()
    try:
        hub.desktop_client()
    except hub.HubError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    auth_id = str(_uuid.uuid4())
    with _connect_lock:
        _connect_sessions[auth_id] = {"status": "pending"}
    threading.Thread(target=_run_connect_flow, args=(auth_id, url), daemon=True).start()
    return {"auth_id": auth_id}


@router.get("/connect/poll/{auth_id}")
async def connect_poll(
    auth_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    _guard_desktop()
    with _connect_lock:
        data = dict(_connect_sessions.get(auth_id, {}))
    if not data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such sign-in.")
    if data["status"] == "pending":
        return {"status": "pending"}

    with _connect_lock:
        _connect_sessions.pop(auth_id, None)

    if data["status"] == "error":
        return {"status": "error", "message": data.get("error_msg", "Sign-in failed.")}

    await hub.save_link(
        db,
        current_user.id,
        data["hub_url"],
        data["email"],
        data["refresh_token"],
    )
    await db.commit()
    await _remember_hub_user(db, await hub.get_link(db, current_user.id))
    await db.commit()
    return {"status": "success", "email": data["email"]}


@router.post("/disconnect", status_code=status.HTTP_204_NO_CONTENT)
async def hub_disconnect(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    _guard_desktop()
    if await hub.disconnect(db, current_user.id):
        await db.commit()


def _check_path(path: str) -> str:
    """Refuse anything outside the shared workspace."""
    target = "/" + path.lstrip("/")
    if ".." in target:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bad path.")
    if not any(
        target == prefix or target.startswith(prefix + "/") for prefix in _ALLOWED_PREFIXES
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only shared project work can be reached through the hub.",
        )
    return target


@router.api_route(
    "/api/{path:path}", methods=["GET", "POST", "PATCH", "PUT", "DELETE"]
)
async def hub_proxy(
    path: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    """Pass a shared-workspace call through to the hub and hand back its answer."""
    if settings.hub_mode:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="This is the hub: call the path directly, without /hub/api.",
        )
    target = _check_path(path)

    body: object | None = None
    if request.method in ("POST", "PATCH", "PUT"):
        raw = await request.body()
        if raw:
            try:
                import json

                body = json.loads(raw)
            except ValueError as exc:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST, detail="Body must be JSON."
                ) from exc

    try:
        resp = await hub.request(
            db,
            current_user.id,
            request.method,
            target,
            params=dict(request.query_params),
            json_body=body,
        )
    except hub.HubNotConnected as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except hub.HubError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)
        ) from exc
    await db.commit()

    return Response(
        content=resp.content,
        status_code=resp.status_code,
        media_type=resp.headers.get("content-type"),
    )


# ── Moving a person's own work to the hub ────────────────────────────────

MY_TASKS_PROJECT = "My tasks"


class MoveAllPreview(BaseModel):
    projects: list[dict]
    orphan_tasks: int
    orphan_open: int


class MoveAllResult(BaseModel):
    moved: list[dict]
    tasks_moved: int
    failed: list[str]


class MoveAllRequest(BaseModel):
    """Everything by default; a subset when `project_ids` is given."""

    project_ids: list[_uuid.UUID] | None = None
    include_orphans: bool = True


async def _movable_projects(db: AsyncSession, user_id: _uuid.UUID) -> list:
    from sqlalchemy import select

    from models.db.task import Project
    from services.projects.access import resolve_role

    rows = (
        await db.execute(
            select(Project)
            .where(Project.is_archived.is_(False))
            .order_by(Project.created_at.asc())
        )
    ).scalars().all()
    # Only what this person owns: a project someone else made here is theirs to move.
    out = []
    for p in rows:
        if await resolve_role(db, p, user_id) == "owner":
            out.append(p)
    return out


async def _orphan_tasks(db: AsyncSession, user_id: _uuid.UUID) -> list:
    from sqlalchemy import or_, select

    from models.db.task import Task

    return list(
        (
            await db.execute(
                select(Task).where(
                    Task.project_id.is_(None),
                    or_(Task.created_by == user_id, Task.assignee_id == user_id),
                )
            )
        ).scalars().all()
    )


@router.get("/move-all/preview", response_model=MoveAllPreview)
async def move_all_preview(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MoveAllPreview:
    """What "move everything to the hub" would take with it."""
    _guard_desktop()
    from sqlalchemy import func, select

    from models.db.task import Task

    projects = await _movable_projects(db, current_user.id)
    counts = dict(
        (
            await db.execute(
                select(Task.project_id, func.count(Task.id))
                .where(Task.project_id.in_([p.id for p in projects] or [_uuid.uuid4()]))
                .group_by(Task.project_id)
            )
        ).all()
    )
    orphans = await _orphan_tasks(db, current_user.id)
    open_states = {"todo", "in_progress", "blocked", "review"}
    return MoveAllPreview(
        projects=[
            {"id": str(p.id), "name": p.name, "visibility": p.visibility, "tasks": counts.get(p.id, 0)}
            for p in projects
        ],
        orphan_tasks=len(orphans),
        orphan_open=sum(
            1 for t in orphans if str(getattr(t.status, "value", t.status)) in open_states
        ),
    )


@router.post("/move-all", response_model=MoveAllResult)
async def move_all(
    body: MoveAllRequest | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MoveAllResult:
    """Send every project this person owns, and their tasks with no project,
    to the hub — the same move as a project's own "Move to hub", for all of
    them at once.

    Tasks with no project travel inside a private hub project called
    "My tasks", because a task on the hub has to belong to something. Each
    local copy is archived once the hub has confirmed it, never before.
    """
    _guard_desktop()
    from datetime import datetime, timezone

    from models.db.task import Project
    from services.projects import transfer
    from services.projects.workroom import ensure_workroom

    projects = await _movable_projects(db, current_user.id)
    body = body or MoveAllRequest()
    if body.project_ids is not None:
        wanted = set(body.project_ids)
        projects = [p for p in projects if p.id in wanted]
    orphans = await _orphan_tasks(db, current_user.id) if body.include_orphans else []

    if orphans:
        holder = Project(
            id=_uuid.uuid4(),
            name=MY_TASKS_PROJECT,
            description="Tasks that were not part of any project.",
            visibility="private",
            owner_id=current_user.id,
            created_by=current_user.id,
        )
        db.add(holder)
        await db.flush()
        for t in orphans:
            t.project_id = holder.id
        await db.flush()
        await ensure_workroom(db, holder, current_user.id)
        projects.append(holder)

    moved: list[dict] = []
    failed: list[str] = []
    tasks_moved = 0
    for p in projects:
        bundle = await transfer.build(db, p, visibility=p.visibility)
        try:
            resp = await hub.request(
                db, current_user.id, "POST", "/projects/import",
                json_body=bundle.model_dump(mode="json"),
            )
        except hub.HubNotConnected as exc:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
        except hub.HubError as exc:
            failed.append(f"{p.name}: {exc}")
            continue
        if resp.status_code >= 400:
            failed.append(f"{p.name}: the hub would not take it ({resp.status_code})")
            continue
        result = resp.json()
        p.is_archived = True
        p.archived_at = datetime.now(timezone.utc)
        tasks_moved += int(result.get("tasks") or 0)
        moved.append({"name": p.name, "hub_project_id": result.get("project_id"), "tasks": result.get("tasks", 0)})
        await db.commit()
        logger.info("Moved project %s to hub as %s", p.id, result.get("project_id"))

    return MoveAllResult(moved=moved, tasks_moved=tasks_moved, failed=failed)


@router.post("/budgets/push")
async def push_budgets(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Send every budget this person owns up to the hub, so all of them are
    there when they open the hub from a browser away from this computer.

    Only the row and its cached figures travel; the sheet stays on Drive and is
    read there under whichever Google grant is doing the reading. Repeating
    this updates the copies rather than duplicating them.
    """
    _guard_desktop()
    from sqlalchemy import select

    from models.db.budget import Budget

    rows = (
        await db.execute(select(Budget).where(Budget.user_id == current_user.id))
    ).scalars().all()
    pushed = 0
    failed: list[str] = []
    for b in rows:
        body = {
            "title": b.title,
            "drive_file_id": b.drive_file_id,
            "drive_url": b.drive_url or "",
            "allotment": float(b.allotment) if b.allotment is not None else None,
            "currency": b.currency,
            "external_readonly": b.external_readonly,
            "cached_ledger": b.cached_ledger or [],
            "cached_categories": b.cached_categories or [],
            "cached_summary": b.cached_summary or {},
            "cached_estimate": b.cached_estimate or [],
        }
        try:
            resp = await hub.request(db, current_user.id, "POST", "/budgets/mirror", json_body=body)
        except hub.HubNotConnected as exc:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
        except hub.HubError as exc:
            failed.append(f"{b.title}: {exc}")
            continue
        if resp.status_code < 300:
            pushed += 1
        else:
            failed.append(f"{b.title}: hub answered {resp.status_code}")
    await db.commit()
    return {"pushed": pushed, "failed": failed}


@router.post("/conversations/{conversation_id}/sync")
async def sync_conversation(
    conversation_id: _uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Make a local copy of a shared project's chat, and bring it up to date.

    This replaces relaying the chat socket to the hub. Running the turn there
    put Gerry in the one place with no knowledge base, no Drive token and no
    Gmail; she works here instead, on this copy, and the hub is reconciled
    around each turn. Call it before opening the conversation.

    On the hub itself there is nothing to copy: the conversation is already
    here, so this just confirms it can be read.
    """
    if settings.hub_mode:
        from routers.conversations import conversation_for

        conv = await conversation_for(db, conversation_id, current_user.id)
        if conv is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="That conversation is not yours to read.",
            )
        return {"id": str(conv.id), "title": conv.title}
    from services.hub import conv_sync

    conv = await conv_sync.sync(db, current_user.id, conversation_id)
    if conv is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="That conversation is not on the hub, or is not yours to read.",
        )
    return {"id": str(conv.id), "title": conv.title}
