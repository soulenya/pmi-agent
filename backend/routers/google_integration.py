"""
Google Workspace integration router.

All write actions go through a proposals system:
  POST /api/google/actions/propose  → creates a pending proposal
  POST /api/google/actions/{id}/approve → executes it (user must explicitly call this)
  DELETE /api/google/actions/{id}   → cancel
"""
from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from services import google_service as gs

router = APIRouter(prefix="/api/google", tags=["google"])

# Import the auth dependency used by the rest of the app.
# Adjust this import if your project uses a different path.
try:
    from dependencies import get_current_user  # type: ignore[import]
except ImportError:
    try:
        from auth import get_current_user  # type: ignore[import]
    except ImportError:
        # Fallback: no auth guard (should not happen in production)
        async def get_current_user():  # type: ignore[misc]
            return {"id": 0}


# ── Auth status & OAuth flow ──────────────────────────────────────────────

@router.get("/status")
async def google_status(_user=Depends(get_current_user)):
    return gs.get_status()


@router.post("/auth/start")
async def google_auth_start(_user=Depends(get_current_user)):
    """
    Launches Google OAuth in the user's default browser.
    The backend waits for the callback (up to ~5 min) in a background thread.
    Poll GET /api/google/status until status == "connected".
    """
    gs.start_auth_flow()
    return {"status": "pending", "message": "Google sign-in window opened in your browser."}


@router.delete("/auth/revoke")
async def google_revoke(_user=Depends(get_current_user)):
    gs.revoke()
    return {"status": "disconnected"}


# ── Gmail ─────────────────────────────────────────────────────────────────

@router.get("/gmail/search")
async def gmail_search(q: str, max: int = 10, _user=Depends(get_current_user)):
    try:
        return {"messages": gs.gmail_search(q, max)}
    except RuntimeError as e:
        raise HTTPException(401, str(e))


@router.get("/gmail/message/{message_id}")
async def gmail_message(message_id: str, _user=Depends(get_current_user)):
    try:
        return gs.gmail_get_message(message_id)
    except RuntimeError as e:
        raise HTTPException(401, str(e))


# ── Drive ─────────────────────────────────────────────────────────────────

@router.get("/drive/search")
async def drive_search(q: str, max: int = 10, _user=Depends(get_current_user)):
    try:
        return {"files": gs.drive_search(q, max)}
    except RuntimeError as e:
        raise HTTPException(401, str(e))


@router.get("/drive/file/{file_id}")
async def drive_file(file_id: str, _user=Depends(get_current_user)):
    try:
        return gs.drive_get_content(file_id)
    except RuntimeError as e:
        raise HTTPException(401, str(e))


# ── Calendar ──────────────────────────────────────────────────────────────

@router.get("/calendar/events")
async def calendar_events(
    days_behind: int = 0, days_ahead: int = 7,
    _user=Depends(get_current_user),
):
    try:
        return {"events": gs.calendar_events(days_behind, days_ahead)}
    except RuntimeError as e:
        raise HTTPException(401, str(e))


# ── Contacts ──────────────────────────────────────────────────────────────

@router.get("/contacts/search")
async def contacts_search(q: str, max: int = 10, _user=Depends(get_current_user)):
    try:
        return {"contacts": gs.contacts_search(q, max)}
    except RuntimeError as e:
        raise HTTPException(401, str(e))


# ── Human-in-the-loop write proposals ────────────────────────────────────

_proposals: dict[str, dict[str, Any]] = {}


class ProposeRequest(BaseModel):
    action_type: str      # "send_email" | "create_event"
    params: dict[str, Any]


def _describe(action_type: str, params: dict) -> str:
    if action_type == "send_email":
        return (
            f"Send email\n"
            f"  To: {params.get('to', '')}\n"
            f"  Subject: {params.get('subject', '')}\n"
            f"  Body: {str(params.get('body', ''))[:300]}"
        )
    if action_type == "create_event":
        return (
            f"Create calendar event\n"
            f"  Title: {params.get('title', '')}\n"
            f"  When: {params.get('start', '')} → {params.get('end', '')}\n"
            f"  Location: {params.get('location', 'N/A')}"
        )
    return f"{action_type}: {params}"


@router.post("/actions/propose")
async def propose_action(req: ProposeRequest, _user=Depends(get_current_user)):
    if req.action_type not in ("send_email", "create_event"):
        raise HTTPException(400, f"Unknown action_type: {req.action_type}")
    pid = str(uuid.uuid4())[:8]
    _proposals[pid] = {
        "id": pid,
        "action_type": req.action_type,
        "params": req.params,
        "description": _describe(req.action_type, req.params),
        "status": "pending",
    }
    return _proposals[pid]


@router.get("/actions/pending")
async def list_pending(_user=Depends(get_current_user)):
    return {"proposals": [p for p in _proposals.values() if p["status"] == "pending"]}


@router.post("/actions/{proposal_id}/approve")
async def approve_action(proposal_id: str, _user=Depends(get_current_user)):
    p = _proposals.get(proposal_id)
    if not p:
        raise HTTPException(404, "Proposal not found")
    if p["status"] != "pending":
        raise HTTPException(400, f"Proposal is already {p['status']}")
    try:
        if p["action_type"] == "send_email":
            result = gs.gmail_send(**p["params"])
        elif p["action_type"] == "create_event":
            result = gs.calendar_create_event(**p["params"])
        else:
            raise HTTPException(400, "Unknown action type")
        p["status"] = "approved"
        return {"status": "executed", "result": result}
    except Exception as exc:
        p["status"] = "error"
        raise HTTPException(500, str(exc))


@router.delete("/actions/{proposal_id}")
async def cancel_action(proposal_id: str, _user=Depends(get_current_user)):
    p = _proposals.get(proposal_id)
    if not p:
        raise HTTPException(404, "Proposal not found")
    p["status"] = "cancelled"
    return {"status": "cancelled"}
