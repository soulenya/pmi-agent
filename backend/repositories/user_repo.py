"""User and UserSession repository."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.user import User, UserSession
from repositories.base import BaseRepository


class UserRepository(BaseRepository[User]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(User, session)

    async def get_by_email(self, email: str) -> User | None:
        result = await self.session.execute(
            select(User).where(User.email == email.lower())
        )
        return result.scalar_one_or_none()

    async def email_exists(self, email: str) -> bool:
        return await self.get_by_email(email) is not None

    async def has_admin(self) -> bool:
        result = await self.session.execute(
            select(User.id).where(User.role == "admin", User.is_active.is_(True)).limit(1)
        )
        return result.scalar_one_or_none() is not None

    def is_designated_admin(self, email: str) -> bool:
        """The brand's administrator address (brand.json / ADMIN_EMAIL)."""
        from config import settings

        return (email or "").lower() == (settings.admin_email or "").strip().lower()

    async def role_for_new_user(self, email: str) -> str:
        """Admin for the brand's administrator address, and for the first
        account on a database that has no administrator yet (a fresh install
        is its owner's own copy); member otherwise."""
        if self.is_designated_admin(email) or not await self.has_admin():
            return "admin"
        return "member"


class UserSessionRepository(BaseRepository[UserSession]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(UserSession, session)

    async def get_by_token_hash(self, token_hash: str) -> UserSession | None:
        result = await self.session.execute(
            select(UserSession).where(
                UserSession.token_hash == token_hash,
                UserSession.revoked_at.is_(None),
                UserSession.expires_at > datetime.now(timezone.utc),
            )
        )
        return result.scalar_one_or_none()

    async def revoke(self, session_obj: UserSession) -> UserSession:
        session_obj.revoked_at = datetime.now(timezone.utc)
        return await self.save(session_obj)

    async def revoke_all_for_user(self, user_id: UUID) -> int:
        """Revoke all active sessions for a user. Returns count revoked."""
        result = await self.session.execute(
            select(UserSession).where(
                UserSession.user_id == user_id,
                UserSession.revoked_at.is_(None),
            )
        )
        sessions = result.scalars().all()
        now = datetime.now(timezone.utc)
        for s in sessions:
            s.revoked_at = now
        await self.session.flush()
        return len(sessions)
