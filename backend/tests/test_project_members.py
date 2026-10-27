"""Sharing a project names a real account, never a placeholder.

Adding someone used to accept any address on an allowed domain and, when it
matched nobody, quietly create a dormant account to carry the role. The person
it was meant for then signed in as themselves and found nothing. The resolver
now takes an id from the directory first, and refuses an address it cannot
match to someone who has signed in.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db.user import User
from routers.project_space import MemberAdd, _resolve_person
from services.auth.service import hash_password
from services.projects.access import ALLOWED_DOMAINS

DOMAIN = next(iter(ALLOWED_DOMAINS))


async def _user(db: AsyncSession, local: str, *, active: bool = True) -> User:
    user = User(
        email=f"{local}@{DOMAIN}",
        display_name=local,
        hashed_password=hash_password("TestPassword1!"),
        role="user",
        is_active=active,
    )
    db.add(user)
    await db.flush()
    return user


async def _user_count(db: AsyncSession) -> int:
    return int((await db.execute(select(func.count(User.id)))).scalar() or 0)


@pytest.mark.asyncio
async def test_picked_from_directory_resolves_to_that_account(db_session: AsyncSession):
    lindsey = await _user(db_session, "pm-lindsey")
    found = await _resolve_person(db_session, MemberAdd(user_id=lindsey.id))
    assert found.id == lindsey.id


@pytest.mark.asyncio
async def test_email_matches_the_existing_account_case_insensitively(db_session: AsyncSession):
    lindsey = await _user(db_session, "pm-lindsey2")
    found = await _resolve_person(
        db_session, MemberAdd(email=f"PM-Lindsey2@{DOMAIN.upper()}")
    )
    assert found.id == lindsey.id


@pytest.mark.asyncio
async def test_unknown_email_is_refused_and_creates_nobody(db_session: AsyncSession):
    before = await _user_count(db_session)
    with pytest.raises(HTTPException) as err:
        await _resolve_person(db_session, MemberAdd(email=f"pm-nobody-here@{DOMAIN}"))
    assert err.value.status_code == 404
    assert "signed in" in err.value.detail
    assert await _user_count(db_session) == before


@pytest.mark.asyncio
async def test_unknown_id_and_deactivated_account_are_refused(db_session: AsyncSession):
    with pytest.raises(HTTPException) as err:
        await _resolve_person(db_session, MemberAdd(user_id=uuid.uuid4()))
    assert err.value.status_code == 404

    gone = await _user(db_session, "pm-gone", active=False)
    with pytest.raises(HTTPException) as err:
        await _resolve_person(db_session, MemberAdd(user_id=gone.id))
    assert err.value.status_code == 404


@pytest.mark.asyncio
async def test_outside_domain_is_still_refused(db_session: AsyncSession):
    with pytest.raises(HTTPException) as err:
        await _resolve_person(db_session, MemberAdd(email="someone@example.org"))
    assert err.value.status_code == 400


def test_must_name_someone():
    with pytest.raises(ValueError):
        MemberAdd(role="editor")
