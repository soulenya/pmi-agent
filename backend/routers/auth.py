"""Authentication router — /auth prefix."""

from __future__ import annotations

import base64
import json
import os
import re
import secrets
import threading
import urllib.request
import uuid as _uuid
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

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
from services import google_user_creds
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

# Company-hosted google_credentials.json, used by the "Download credentials"
# button on the login page so teammates don't have to find the backend folder
# or rename the file by hand. Set this to a Google Drive "Anyone with the link"
# share URL (or a plain HTTPS URL) pointing at the OAuth client JSON. An
# environment variable wins over the baked-in constant when both are present.
#
#   Example: "https://drive.google.com/file/d/1AbCxyz.../view?usp=sharing"
GOOGLE_CREDENTIALS_DOWNLOAD_URL = "https://drive.google.com/file/d/1qfh3eQU0p10yOyfENBpuguRwDvNfOPel/view?usp=sharing"


def _credentials_download_url() -> str:
    """The configured company credentials URL (env var overrides the constant)."""
    return (os.environ.get("GOOGLE_CREDENTIALS_URL") or GOOGLE_CREDENTIALS_DOWNLOAD_URL).strip()


def _to_direct_download_url(url: str) -> str:
    """Turn a Google Drive share link into a direct-download URL.

    Plain (non-Drive) URLs and already-direct ``uc?export=download`` links are
    returned unchanged. A credentials JSON is tiny, so Drive serves it directly
    without the large-file virus-scan interstitial.
    """
    # Already a direct download endpoint — leave it alone.
    if "uc?export=download" in url or "drive.google.com/uc" in url:
        return url
    # Extract the file id from /file/d/<ID>/... or ...?id=<ID> share URLs.
    m = re.search(r"/file/d/([A-Za-z0-9_-]+)", url) or re.search(r"[?&]id=([A-Za-z0-9_-]+)", url)
    if m:
        return f"https://drive.google.com/uc?export=download&id={m.group(1)}"
    return url


def _validate_oauth_client(raw: bytes) -> dict:
    """Parse + validate that ``raw`` is a Google OAuth client JSON.

    Returns the parsed dict on success; raises ValueError otherwise.
    """
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ValueError("The downloaded file is not valid JSON.") from exc
    if not isinstance(data, dict):
        raise ValueError("The downloaded file is not a Google credentials file.")
    section = data.get("installed") or data.get("web")
    if not isinstance(section, dict) or not section.get("client_id") or not section.get("client_secret"):
        raise ValueError(
            "That doesn't look like a Google OAuth client file "
            "(missing client_id / client_secret)."
        )
    return data


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
            _sso_sessions[auth_id] = {
                "status": "done",
                "email": email,
                "name": claims.get("name", ""),
            }

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


@router.get("/mode")
async def auth_mode() -> dict:
    """Tell the frontend which sign-in flow this deployment uses."""
    return {"mode": "iap" if settings.hub_mode else "desktop"}


@router.post("/google/initiate")
async def google_initiate() -> dict:
    """
    Start the Google SSO login flow.
    Opens a browser window for the user to sign in.
    Returns an auth_id — poll /auth/google/poll/{auth_id} for the result.
    """
    if settings.hub_mode:
        # run_local_server needs a browser on the backend's own machine.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This server signs you in automatically. Reload the page.",
        )
    auth_id = str(_uuid.uuid4())
    with _sso_lock:
        _sso_sessions[auth_id] = {"status": "pending"}
    thread = threading.Thread(target=_run_sso_flow, args=(auth_id,), daemon=True)
    thread.start()
    return {"auth_id": auth_id}


@router.get("/credentials-status")
async def credentials_status() -> dict:
    """Whether the Google OAuth client file is present, and if a download is offered.

    Unauthenticated on purpose: the login page runs before anyone is signed in.
    """
    return {
        "present": _CREDS_FILE.exists(),
        "download_available": bool(_credentials_download_url()),
    }


@router.post("/credentials/fetch")
async def fetch_credentials() -> dict:
    """Download the company google_credentials.json and place it in backend/.

    Pulls the file from the configured company URL (a Drive "Anyone with the
    link" share or a plain HTTPS URL), validates it's a real OAuth client, and
    writes it to the backend folder so the user can sign in immediately — no
    manual file move or rename. Unauthenticated (pre-login).
    """
    url = _credentials_download_url()
    if not url:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "not_configured",
                "message": "No company credentials URL is configured for this build.",
            },
        )

    download_url = _to_direct_download_url(url)
    try:
        req = urllib.request.Request(download_url, headers={"User-Agent": "LittleGerry"})
        with urllib.request.urlopen(req, timeout=20) as resp:  # noqa: S310 (trusted company URL)
            raw = resp.read(2 * 1024 * 1024)  # cap at 2 MB; a client file is < 1 KB
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "code": "download_failed",
                "message": f"Couldn't download the credentials file: {exc}",
            },
        ) from exc

    try:
        _validate_oauth_client(raw)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "invalid_credentials", "message": str(exc)},
        ) from exc

    try:
        _CREDS_FILE.write_bytes(raw)
    except OSError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "write_failed", "message": f"Couldn't save the credentials file: {exc}"},
        ) from exc

    return {"ok": True, "path": str(_CREDS_FILE)}


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
        # First sign-in on this machine — auto-provision the account (local-first:
        # this is the user's own copy). The owner becomes admin; everyone else is a
        # full-access member. SSO-only accounts get an unusable random password.
        import secrets as _secrets
        from services.auth.service import hash_password

        role = "admin" if email == settings.admin_email.lower() else "member"
        display_name = (session_data.get("name") or "").strip() or email.split("@")[0]
        user = User(
            email=email,
            display_name=display_name,
            hashed_password=hash_password(_secrets.token_urlsafe(32)),
            role=role,
            is_active=True,
            can_write_regulatory=True,  # full access for everyone
            onboarding_complete=False,
        )
        db.add(user)
        await db.flush()
        await db.refresh(user)
        await audit.log(
            "user.auto_provisioned",
            actor_id=user.id,
            entity_type="user",
            entity_id=user.id,
            payload={"email": email, "role": role},
        )

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


# ── IAP sign-in (hub only) ────────────────────────────────────────────────────

_IAP_HEADER = "x-goog-iap-jwt-assertion"
_IAP_CERTS_URL = "https://www.gstatic.com/iap/verify/public_key"
_IAP_ISSUER = "https://cloud.google.com/iap"


def _verify_iap_assertion(assertion: str) -> tuple[str, str]:
    """Return (email, google_subject) from a cryptographically verified IAP JWT.

    Raises ValueError on any failure. The signature check is what makes the
    header trustworthy — without it anyone who reaches the VM directly could
    forge an identity.
    """
    from google.auth.transport import requests as ga_requests
    from google.oauth2 import id_token

    claims = id_token.verify_token(
        assertion,
        ga_requests.Request(),
        audience=settings.iap_audience,
        certs_url=_IAP_CERTS_URL,
    )
    if claims.get("iss") != _IAP_ISSUER:
        raise ValueError("Assertion was not issued by Identity-Aware Proxy.")

    email = (claims.get("email") or "").lower()
    subject = claims.get("sub") or ""
    if not email or not subject:
        raise ValueError("Assertion did not carry an identity.")
    return email, subject


@router.post("/iap", response_model=LoginResponse)
async def iap_login(
    request: Request,
    db: AsyncSession = Depends(get_db),
    audit: AuditLogger = Depends(get_audit_logger),
) -> LoginResponse:
    """Exchange the Identity-Aware Proxy assertion for an application session.

    IAP has already authenticated the user against Google and checked org
    membership before the request reached us, so no second sign-in is needed.
    """
    if not settings.hub_mode:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
    if not settings.iap_audience:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="IAP sign-in is not configured on this server.",
        )

    assertion = request.headers.get(_IAP_HEADER)
    if not assertion:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Request did not come through Identity-Aware Proxy.",
        )

    try:
        email, subject = await run_in_threadpool(_verify_iap_assertion, assertion)
    except Exception as exc:
        await audit.log(
            "auth.iap.rejected",
            payload={"reason": str(exc)[:200]},
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
        )
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not verify your identity.",
        ) from exc

    domain = email.split("@")[-1] if "@" in email else ""
    if domain not in _ALLOWED_DOMAINS:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"The account '{email}' is not authorised for this workspace.",
        )

    auth_service = AuthService(db)
    user = await auth_service.user_repo.get_by_email(email)

    if user is None:
        import secrets as _secrets
        from services.auth.service import hash_password

        role = "admin" if email == settings.admin_email.lower() else "member"
        user = User(
            email=email,
            display_name=email.split("@")[0],
            hashed_password=hash_password(_secrets.token_urlsafe(32)),
            role=role,
            is_active=True,
            can_write_regulatory=True,
            onboarding_complete=False,
        )
        db.add(user)
        await db.flush()
        await db.refresh(user)
        await audit.log(
            "user.auto_provisioned",
            actor_id=user.id,
            entity_type="user",
            entity_id=user.id,
            payload={"email": email, "role": role, "via": "iap"},
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account is inactive. Contact your administrator.",
        )

    access_token, refresh_token = await auth_service.create_session(user)

    await audit.log(
        "auth.login.success",
        actor_id=user.id,
        entity_type="user",
        entity_id=user.id,
        payload={"method": "iap", "google_sub": subject},
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


# ── per-user Google connection (hub only) ────────────────────────────────────
# Each person grants their own Google access. Nothing here is shared: the grant
# is stored against the user id and read back only for that user's requests.

_GOOGLE_STATE_PURPOSE = "google-connect"


def _sign_google_state(user_id: _uuid.UUID) -> str:
    from datetime import datetime, timedelta, timezone

    from jose import jwt

    return jwt.encode(
        {
            "sub": str(user_id),
            "purpose": _GOOGLE_STATE_PURPOSE,
            "nonce": secrets.token_urlsafe(16),
            "exp": datetime.now(timezone.utc) + timedelta(minutes=10),
        },
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )


def _read_google_state(state: str) -> _uuid.UUID:
    """The user this consent belongs to. Raises ValueError on a bad state."""
    from jose import JWTError, jwt

    try:
        claims = jwt.decode(
            state, settings.jwt_secret, algorithms=[settings.jwt_algorithm]
        )
    except JWTError as exc:
        raise ValueError("This link has expired. Start again from Settings.") from exc
    if claims.get("purpose") != _GOOGLE_STATE_PURPOSE:
        raise ValueError("This link isn't a Google connection link.")
    return _uuid.UUID(claims["sub"])


def _google_flow():
    from google_auth_oauthlib.flow import Flow

    from services.google_service import SCOPES

    return Flow.from_client_config(
        {"web": google_user_creds.web_client_config()},
        scopes=SCOPES,
        redirect_uri=google_user_creds.redirect_uri(),
    )


def _verify_google_email(raw_id_token: str | None) -> str:
    """The verified address on the id_token Google just issued."""
    from google.auth.transport import requests as ga_requests
    from google.oauth2 import id_token as google_id_token

    if not raw_id_token:
        raise ValueError("Google didn't say which account this is.")
    cfg = google_user_creds.web_client_config()
    try:
        claims = google_id_token.verify_oauth2_token(
            raw_id_token, ga_requests.Request(), cfg.get("client_id")
        )
    except Exception as exc:  # noqa: BLE001 — an unverifiable token is a failure
        raise ValueError("Couldn't verify the Google account.") from exc
    email = (claims.get("email") or "").lower()
    if not email or not claims.get("email_verified"):
        raise ValueError("That Google account has no verified address.")
    return email


@router.get("/google/connect")
async def google_connect(current_user: User = Depends(get_current_user)) -> dict:
    """Where to send this user so they can grant their own Google access."""
    if not settings.hub_mode:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Not available on this install.",
        )
    if not google_user_creds.is_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google isn't configured on this server yet.",
        )

    url, _ = _google_flow().authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        # Force the consent screen so Google always returns a refresh token —
        # without it a re-connect yields an access token only, and the grant
        # dies an hour later.
        prompt="consent",
        state=_sign_google_state(current_user.id),
    )
    return {"authorization_url": url}


@router.get("/google/callback")
async def google_callback(
    request: Request,
    db: AsyncSession = Depends(get_db),
    audit: AuditLogger = Depends(get_audit_logger),
):
    """Google redirects the browser here. Authenticated by the signed state,
    because a redirect carries no Authorization header."""
    from fastapi.responses import RedirectResponse

    def _fail(message: str) -> RedirectResponse:
        return RedirectResponse(f"/google?google_error={quote(message)}")

    if not settings.hub_mode or not google_user_creds.is_configured():
        return _fail("Google isn't configured on this server.")

    params = request.query_params
    if params.get("error"):
        return _fail("Google sign-in was cancelled.")
    code, state = params.get("code"), params.get("state")
    if not code or not state:
        return _fail("Google didn't return a sign-in code.")

    try:
        user_id = _read_google_state(state)
    except ValueError as exc:
        return _fail(str(exc))

    user = await db.get(User, user_id)
    if user is None or not user.is_active:
        return _fail("That account is no longer active.")

    flow = _google_flow()
    try:
        await run_in_threadpool(flow.fetch_token, code=code)
    except Exception:  # noqa: BLE001 — any failure here is a failed connect
        return _fail("Google rejected the sign-in. Try again.")

    creds = flow.credentials
    if not creds.refresh_token:
        return _fail("Google didn't return a refresh token. Try connecting again.")

    try:
        email = await run_in_threadpool(_verify_google_email, creds.id_token)
    except ValueError as exc:
        return _fail(str(exc))

    if email.split("@")[-1] not in _ALLOWED_DOMAINS:
        await audit.log(
            "google.connect.rejected",
            actor_id=user.id,
            payload={"email": email, "reason": "domain"},
        )
        await db.commit()
        return _fail("Connect a PMI account, not a personal one.")

    await google_user_creds.store(db, user.id, email, creds)
    await audit.log(
        "google.connect.success",
        actor_id=user.id,
        entity_type="user",
        entity_id=user.id,
        payload={"email": email, "scopes": list(creds.scopes or [])},
    )
    await db.commit()
    return RedirectResponse("/google?google=connected")


@router.post("/google/disconnect", status_code=status.HTTP_204_NO_CONTENT)
async def google_disconnect(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    audit: AuditLogger = Depends(get_audit_logger),
) -> None:
    """Forget this user's Google grant. Only ever their own."""
    await google_user_creds.clear(db, current_user.id)
    await audit.log(
        "google.disconnect",
        actor_id=current_user.id,
        entity_type="user",
        entity_id=current_user.id,
    )
    await db.commit()


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
