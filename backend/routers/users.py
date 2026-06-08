"""User management router — admin-only CRUD for user accounts."""

from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_current_user, require_admin
from models.db.user import User
from models.schemas.auth import UserOut
from models.schemas.common import ApiResponse, Meta
from services.auth.service import hash_password
from services.audit.logger import AuditLogger, get_audit_logger

router = APIRouter(prefix="/users", tags=["users"])


class CreateUserRequest(BaseModel):
    email: EmailStr
    display_name: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=8)
    role: str = Field(default="user")
    can_write_regulatory: bool = False


class UpdateUserRequest(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=255)
    is_active: bool | None = None
    role: str | None = None
    can_write_regulatory: bool | None = None


@router.get("", response_model=ApiResponse[list[UserOut]])
async def list_users(
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[list[UserOut]]:
    result = await db.execute(select(User).order_by(User.created_at))
    users = result.scalars().all()
    return ApiResponse.ok([UserOut.model_validate(u) for u in users])


@router.post("", response_model=ApiResponse[UserOut], status_code=status.HTTP_201_CREATED)
async def create_user(
    body: CreateUserRequest,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    audit: AuditLogger = Depends(get_audit_logger),
) -> ApiResponse[UserOut]:
    from sqlalchemy import select as sa_select

    existing = (
        await db.execute(sa_select(User).where(User.email == body.email.lower()))
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with that email already exists.",
        )

    user = User(
        email=body.email.lower(),
        display_name=body.display_name,
        hashed_password=hash_password(body.password),
        role=body.role,
        is_active=True,
        can_write_regulatory=body.can_write_regulatory,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)

    await audit.log(
        "user.created",
        actor_id=admin.id,
        entity_type="user",
        entity_id=user.id,
        payload={"email": user.email, "role": user.role},
    )
    await db.commit()
    return ApiResponse.ok(UserOut.model_validate(user))


@router.patch("/{user_id}", response_model=ApiResponse[UserOut])
async def update_user(
    user_id: uuid.UUID,
    body: UpdateUserRequest,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    audit: AuditLogger = Depends(get_audit_logger),
) -> ApiResponse[UserOut]:
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    changes: dict = {}
    if body.display_name is not None:
        changes["display_name"] = body.display_name
        user.display_name = body.display_name
    if body.is_active is not None:
        changes["is_active"] = body.is_active
        user.is_active = body.is_active
    if body.role is not None:
        changes["role"] = body.role
        user.role = body.role
    if body.can_write_regulatory is not None:
        changes["can_write_regulatory"] = body.can_write_regulatory
        user.can_write_regulatory = body.can_write_regulatory

    if changes:
        await db.flush()
        await db.refresh(user)
        await audit.log(
            "user.updated",
            actor_id=admin.id,
            entity_type="user",
            entity_id=user.id,
            payload=changes,
        )
        await db.commit()

    return ApiResponse.ok(UserOut.model_validate(user))
