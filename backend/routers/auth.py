"""Authentication router — /auth prefix."""

from __future__ import annotations

import base64
import json
import threading
import uuid as _uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_current_user
from models.db.user import User
from models.schemas.auth import (
    AccessTokenResponse,
    LoginRequest,
    LoginResponse,
    RefreshRequest,
    UserOut,
)
from config import settings
from services.auth.service import AuthService
from services.audit.logger import AuditLogger, get_audit_logger

router = APIRouter(prefix="/auth", tags=["auth"])

# ── Google SSO ────────────────────────────────────────────────────────────────

_ALLOWED_DOMAINS = {"pmi-llc.com", "precisianmedical.com"}
_SSO_SCOPES = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
]
_CREDS_FILE = Path(__file__).parent.parent / "google_credentials.json"

# In-memory store keyed by auth_id (UUID string):
#   {"status": "pending" | "done" | "error", "email": str, "error_msg": str}
_sso_sessions: dict[str, dict] = {}
_sso_lock = threading.Lock()


def _decode_id_token(raw: str | dict) -> dict:
    """Return decoded ID token claims regardless of whether raw is a JWT string or already a dict."""
    if isinstance(raw, dict):
        return raw
    parts = raw.split(".")
    if len(parts) != 3:
        raise ValueError("Malformed ID token")
    padded = parts[1] + "=" * (-len(parts[1]) % 4)
    return json.loads(base64.urlsafe_b64decode(padded))


def _run_sso_flow(auth_id: str) -> None:
    """Run InstalledAppFlow in a background thread, open browser, store result."""
    try:
        from google_auth_oauthlib.flow import InstalledAppFlow
        flow = InstalledAppFlow.from_client_secrets_file(
            str(_CREDS_FILE), _SSO_SCOPES
        )
        creds = flow.run_local_server(port=0, open_browser=True, prompt="select_account")

        raw_id_token = creds.id_token
        if not raw_id_token:
            raise ValueError("Google did not return an ID token.")

        claims = _decode_id_token(raw_id_token)
        email: str = claims.get("email", "").lower()
        if not email:
            raise ValueError("ID token did not include an email address.")

        domain = email.split("@")[-1] if "@" in email else ""
        if domain not in _ALLOWED_DOMAINS:
            raise ValueError(
                f"The account '{email}' is not authorised. "
                "Please sign in with a @pmi-llc.com or @precisianmedical.com account."
            )

        with _sso_lock:
            _sso_sessions[auth_id] = {"status": "done", "email": email}

    except Exception as exc:
        with _sso_lock:
            _sso_sessions[auth_id] = {"status": "error", "error_msg": str(exc)}


@router.post("/login", response_model=LoginResponse)
async def login(
    body: LoginRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    audit: AuditLogger = Depends(get_audit_logger),
) -> LoginResponse:
    auth_service = AuthService(db)
    user = await auth_service.authenticate(body.email, body.password)

    if user is None:
        await audit.log(
            "auth.login.failed",
            payload={"email": body.email},
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials.",
        )

    access_token, refresh_token = await auth_service.create_session(user)

    await audit.log(
        "auth.login.success",
        actor_id=user.id,
        entity_type="user",
        entity_id=user.id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()

    return LoginResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=settings.access_token_expire_minutes * 60,
        user=UserOut.model_validate(user),
    )


@router.post("/google/initiate")
async def google_initiate() -> dict:
    """
    Start the Google SSO login flow.
    Opens a browser window for the user to sign in.
    Returns an auth_id — poll /auth/google/poll/{auth_id} for the result.
    """
    auth_id = str(_uuid.uuid4())
    with _sso_lock:
        _sso_sessions[auth_id] = {"status": "pending"}
    thread = threading.Thread(target=_run_sso_flow, args=(auth_id,), daemon=True)
    thread.start()
    return {"auth_id": auth_id}


@router.get("/google/poll/{auth_id}")
async def google_poll(
    auth_id: str,
    db: AsyncSession = Depends(get_db),
    audit: AuditLogger = Depends(get_audit_logger),
) -> dict:
    """Poll for the result of a Google SSO initiation."""
    with _sso_lock:
        session_data = dict(_sso_sessions.get(auth_id, {}))

    if not session_data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Auth session not found.")

    if session_data["status"] == "pending":
        return {"status": "pending"}

    # Remove from memory regardless of outcome
    with _sso_lock:
        _sso_sessions.pop(auth_id, None)

    if session_data["status"] == "error":
        return {"status": "error", "message": session_data.get("error_msg", "Authentication failed.")}

    # status == "done" — look up user and issue tokens
    email: str = session_data["email"]
    auth_service = AuthService(db)
    user = await auth_service.user_repo.get_by_email(email)

    if user is None:
        return {
            "status": "error",
            "message": f"No account found for '{email}'. Contact your administrator.",
        }
    if not user.is_active:
        return {
            "status": "error",
            "message": "Your account is inactive. Contact your administrator.",
        }

    access_token, refresh_token = await auth_service.create_session(user)

    await audit.log(
        "auth.login.success",
        actor_id=user.id,
        entity_type="user",
        entity_id=user.id,
    )
    await db.commit()

    return {
        "status": "success",
        "access_token": access_token,
        "refresh_token": refresh_token,
        "expires_in": settings.access_token_expire_minutes * 60,
        "user": UserOut.model_validate(user).model_dump(mode="json"),
    }


@router.post("/refresh", response_model=AccessTokenResponse)
async def refresh(
    body: RefreshRequest,
    db: AsyncSession = Depends(get_db),
) -> AccessTokenResponse:
    auth_service = AuthService(db)
    result = await auth_service.refresh_session(body.refresh_token)
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token.",
        )
    access_token, _new_refresh = result
    return AccessTokenResponse(
        access_token=access_token,
        expires_in=settings.access_token_expire_minutes * 60,
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    body: RefreshRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    audit: AuditLogger = Depends(get_audit_logger),
) -> None:
    auth_service = AuthService(db)
    await auth_service.revoke_session(body.refresh_token)
    await audit.log(
        "auth.logout",
        actor_id=current_user.id,
        entity_type="user",
        entity_id=current_user.id,
    )
    await db.commit()


@router.get("/me", response_model=UserOut)
async def get_me(current_user: User = Depends(get_current_user)) -> UserOut:
    return UserOut.model_validate(current_user)
