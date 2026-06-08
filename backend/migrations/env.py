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
    Feedback,
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

    Migrations need DDL privileges (CREATE on schema ``public``), which only the
    privileged ``pmi`` role has — the runtime ``pmi_app`` role cannot create
    objects. So we prefer the ``DATABASE_URL_SYNC`` env var, then the alembic.ini
    value (the ``pmi`` role). Each migration that creates a table is responsible
    for handing ownership to ``pmi_app`` via ``ALTER TABLE ... OWNER TO pmi_app``
    so the running API can access it.
    """
    return os.environ.get(
        "DATABASE_URL_SYNC",
        config.get_main_option("sqlalchemy.url", ""),
    )


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
