"""
Authentication service — JWT issuance, password hashing, token validation.
Secrets are read from the OS keyring via config.settings.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

import bcrypt
from jose import JWTError, jwt
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from models.db.user import User, UserSession
from repositories.user_repo import UserRepository, UserSessionRepository

_ACCESS_TOKEN_TYPE = "access"
_REFRESH_TOKEN_TYPE = "refresh"


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def _hash_token(token: str) -> str:
    """SHA-256 of a raw JWT — stored in DB instead of the token itself."""
    return hashlib.sha256(token.encode()).hexdigest()


def _create_token(
    subject: str,
    token_type: str,
    expires_delta: timedelta,
    extra_claims: dict[str, Any] | None = None,
) -> str:
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": subject,
        "type": token_type,
        "iat": now,
        "exp": now + expires_delta,
    }
    if extra_claims:
        payload.update(extra_claims)
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def create_access_token(user_id: UUID, role: str, session_id: UUID) -> str:
    return _create_token(
        subject=str(user_id),
        token_type=_ACCESS_TOKEN_TYPE,
        expires_delta=timedelta(minutes=settings.access_token_expire_minutes),
        extra_claims={"role": role, "jti": str(session_id)},
    )


def create_refresh_token(user_id: UUID, session_id: UUID) -> str:
    return _create_token(
        subject=str(user_id),
        token_type=_REFRESH_TOKEN_TYPE,
        expires_delta=timedelta(days=settings.refresh_token_expire_days),
        extra_claims={"jti": str(session_id)},
    )


def decode_token(token: str) -> dict[str, Any]:
    """Decode and validate a JWT. Raises JWTError on failure."""
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])


class AuthService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.user_repo = UserRepository(session)
        self.session_repo = UserSessionRepository(session)

    async def authenticate(self, email: str, password: str) -> User | None:
        """Return User if credentials are valid, else None."""
        user = await self.user_repo.get_by_email(email)
        if not user or not user.is_active:
            return None
        if not verify_password(password, user.hashed_password):
            return None
        return user

    async def create_session(self, user: User) -> tuple[str, str]:
        """
        Create a new UserSession and return (access_token, refresh_token).
        Token hashes are stored in the DB; raw tokens are returned to the caller only.
        """
        import uuid as _uuid
        session_id = _uuid.uuid4()

        access_token = create_access_token(user.id, user.role, session_id)
        refresh_token = create_refresh_token(user.id, session_id)

        expires_at = datetime.now(timezone.utc) + timedelta(
            days=settings.refresh_token_expire_days
        )

        await self.session_repo.create(
            id=session_id,
            user_id=user.id,
            token_hash=_hash_token(refresh_token),
            expires_at=expires_at,
        )
        await self.session.commit()

        return access_token, refresh_token

    async def refresh_session(self, refresh_token: str) -> tuple[str, str] | None:
        """
        Validate a refresh token and issue a new token pair (rotation).
        Returns None if the token is invalid or revoked.
        """
        try:
            payload = decode_token(refresh_token)
            if payload.get("type") != _REFRESH_TOKEN_TYPE:
                return None
        except JWTError:
            return None

        token_hash = _hash_token(refresh_token)
        db_session = await self.session_repo.get_by_token_hash(token_hash)
        if not db_session:
            return None

        user = await self.user_repo.get(db_session.user_id)
        if not user or not user.is_active:
            return None

        # Revoke old session and issue a new one (rotation)
        await self.session_repo.revoke(db_session)
        return await self.create_session(user)

    async def revoke_session(self, refresh_token: str) -> bool:
        """Revoke a session by its refresh token. Returns True if found."""
        token_hash = _hash_token(refresh_token)
        db_session = await self.session_repo.get_by_token_hash(token_hash)
        if not db_session:
            return False
        await self.session_repo.revoke(db_session)
        await self.session.commit()
        return True

    async def get_user_from_access_token(self, token: str) -> User | None:
        """Validate access token and return the corresponding User."""
        try:
            payload = decode_token(token)
            if payload.get("type") != _ACCESS_TOKEN_TYPE:
                return None
            user_id = UUID(payload["sub"])
        except (JWTError, KeyError, ValueError):
            return None

        user = await self.user_repo.get(user_id)
        if not user or not user.is_active:
            return None
        return user
