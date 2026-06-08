"""
Alembic environment configuration.
Supports async SQLAlchemy engine via run_async_migrations().
"""

from __future__ import annotations

import asyncio
import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

# Import Base and all models so Alembic autogenerate can see the metadata
from models.db import (  # noqa: F401 — side-effect imports register models
    Base,
    AuditEvent,
    Briefing,
    CAPA,
    Conversation,
    AgentRun,
    Document,
    DocumentCategory,
    DocumentChunk,
    GoogleCredential,
    GoogleSyncState,
    Message,
    ModelRoutingRule,
    Notification,
    ApprovalIntent,
    Project,
    RegulatoryDocument,
    ResearchReport,
    ResearchSource,
    RiskItem,
    SystemSetting,
    Task,
    TaskComment,
    User,
    UserSession,
)

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def get_url() -> str:
    """Resolve the sync DB URL for migrations.

    Prefer the ``DATABASE_URL_SYNC`` env var, then the application's configured
    ``database_url_sync`` (the ``pmi_app`` role that owns the runtime tables),
    and only fall back to the alembic.ini value as a last resort. Using the app
    role keeps newly created objects owned by ``pmi_app`` so the running API can
    access them.
    """
    env_url = os.environ.get("DATABASE_URL_SYNC")
    if env_url:
        return env_url
    try:
        from config import settings

        if settings.database_url_sync:
            return settings.database_url_sync
    except Exception:  # pragma: no cover — fall back to ini if config import fails
        pass
    return config.get_main_option("sqlalchemy.url", "")


def run_migrations_offline() -> None:
    url = get_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        include_schemas=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        include_schemas=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    from sqlalchemy.ext.asyncio import create_async_engine

    # Build asyncpg URL directly — avoids any configparser whitespace issues
    sync_url = get_url().strip()
    async_url = sync_url.replace("postgresql://", "postgresql+asyncpg://", 1)

    connectable = create_async_engine(async_url, poolclass=pool.NullPool)

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
