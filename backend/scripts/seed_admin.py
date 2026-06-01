"""
Seed the first admin user.

Usage:
    cd backend
    uv run python scripts/seed_admin.py

Reads credentials from env vars or prompts interactively.
  PMI_ADMIN_EMAIL    — defaults to admin@pmi.local
  PMI_ADMIN_PASSWORD — must be set or prompted
  PMI_ADMIN_NAME     — defaults to "PMI Admin"
"""

from __future__ import annotations

import asyncio
import os
import sys

# Allow running from the scripts/ directory or backend/
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy.ext.asyncio import AsyncSession

from database import AsyncSessionLocal
from models.db.user import User
from services.auth.service import hash_password


async def seed_admin(
    email: str,
    password: str,
    display_name: str,
) -> None:
    from sqlalchemy import select

    async with AsyncSessionLocal() as session:
        session: AsyncSession

        # Check if admin already exists
        result = await session.execute(select(User).where(User.email == email.lower()))
        existing = result.scalar_one_or_none()

        if existing:
            print(f"[seed] Admin user already exists: {existing.email}")
            return

        admin = User(
            email=email.lower(),
            display_name=display_name,
            hashed_password=hash_password(password),
            role="admin",
            is_active=True,
        )
        session.add(admin)
        await session.commit()
        await session.refresh(admin)
        print(f"[seed] Created admin user: {admin.email} (id={admin.id})")


def main() -> None:
    email = os.environ.get("PMI_ADMIN_EMAIL", "admin@pmi.local")
    name = os.environ.get("PMI_ADMIN_NAME", "PMI Admin")
    password = os.environ.get("PMI_ADMIN_PASSWORD", "")

    if not password:
        import getpass
        password = getpass.getpass(f"Password for {email}: ")

    if len(password) < 8:
        print("[seed] Error: Password must be at least 8 characters.", file=sys.stderr)
        sys.exit(1)

    asyncio.run(seed_admin(email, password, name))


if __name__ == "__main__":
    main()
