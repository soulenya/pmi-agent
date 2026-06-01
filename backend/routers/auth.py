"""Authentication router — /auth prefix."""

from __future__ import annotations

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
