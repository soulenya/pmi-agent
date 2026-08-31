"""
FastAPI dependency that resolves the current authenticated user
from the Authorization: Bearer <access_token> header.
"""

from __future__ import annotations

import uuid
from typing import Callable

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select

from database import get_db
from models.db.task import Project
from models.db.user import User
from services.auth.service import AuthService
from sqlalchemy.ext.asyncio import AsyncSession

_bearer = HTTPBearer(auto_error=True)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    token = credentials.credentials
    auth_service = AuthService(db)
    user = await auth_service.get_user_from_access_token(token)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired access token.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


async def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin role required.",
        )
    return current_user


async def require_regulatory_write(
    current_user: User = Depends(get_current_user),
) -> User:
    """Allow only users granted regulatory write access (admins always pass)."""
    if current_user.role == "admin" or getattr(current_user, "can_write_regulatory", False):
        return current_user
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You don't have permission to modify regulatory files.",
    )


def require_project_role(minimum: str) -> Callable:
    """Dependency factory gating a `/projects/{project_id}/...` route by role.

    Returns the project. A project the user cannot see 404s rather than 403s —
    a private project must not confirm its own existence.
    """

    async def _dependency(
        project_id: uuid.UUID,
        db: AsyncSession = Depends(get_db),
        current_user: User = Depends(get_current_user),
    ) -> Project:
        from services.projects.access import resolve_role, role_at_least

        project = (
            await db.execute(select(Project).where(Project.id == project_id))
        ).scalar_one_or_none()
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found.")

        role = await resolve_role(db, project, current_user.id)
        if role is None:
            raise HTTPException(status_code=404, detail="Project not found.")
        if not role_at_least(role, minimum):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"This needs {minimum} access to the project.",
            )
        return project

    return _dependency
