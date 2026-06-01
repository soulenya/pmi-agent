"""Initial schema — all tables, enums, extensions, and indexes.

Revision ID: 001
Revises: 
Create Date: 2025-01-01 00:00:00.000000
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── Extensions ────────────────────────────────────────────────────────────
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.execute("CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\"")
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    # ── Enum types ────────────────────────────────────────────────────────────
    agent_type = postgresql.ENUM(
        "executive_assistant", "researcher", "project_coordinator",
        "knowledge_manager", "regulatory_specialist", "supervisor",
        name="agenttype", create_type=False,
    )
    agent_type.create(op.get_bind(), checkfirst=True)

    message_role = postgresql.ENUM(
        "system", "user", "assistant", "tool",
        name="messagerole", create_type=False,
    )
    message_role.create(op.get_bind(), checkfirst=True)

    task_status = postgresql.ENUM(
        "backlog", "todo", "in_progress", "blocked", "done", "cancelled",
        name="taskstatus", create_type=False,
    )
    task_status.create(op.get_bind(), checkfirst=True)

    task_priority = postgresql.ENUM(
        "low", "medium", "high", "critical",
        name="taskpriority", create_type=False,
    )
    task_priority.create(op.get_bind(), checkfirst=True)

    approval_status = postgresql.ENUM(
        "pending", "approved", "rejected", "expired",
        name="approvalstatus", create_type=False,
    )
    approval_status.create(op.get_bind(), checkfirst=True)

    document_source_type = postgresql.ENUM(
        "upload", "google_drive", "email_attachment", "web_fetch", "generated",
        name="documentsourcetype", create_type=False,
    )
    document_source_type.create(op.get_bind(), checkfirst=True)

    document_status = postgresql.ENUM(
        "pending", "processing", "ready", "error",
        name="documentstatus", create_type=False,
    )
    document_status.create(op.get_bind(), checkfirst=True)

    reg_doc_type = postgresql.ENUM(
        "sop", "work_instruction", "form", "policy", "risk_management_plan",
        "design_history_file", "technical_file", "capa", "audit_report", "other",
        name="regdoctype", create_type=False,
    )
    reg_doc_type.create(op.get_bind(), checkfirst=True)

    reg_doc_status = postgresql.ENUM(
        "draft", "under_review", "approved", "obsolete", "superseded",
        name="regdocstatus", create_type=False,
    )
    reg_doc_status.create(op.get_bind(), checkfirst=True)

    briefing_type = postgresql.ENUM(
        "morning", "evening", "weekly", "on_demand",
        name="briefingtype", create_type=False,
    )
    briefing_type.create(op.get_bind(), checkfirst=True)

    notification_type = postgresql.ENUM(
        "task_assigned", "task_due", "approval_required", "approval_resolved",
        "document_ready", "research_complete", "system", "briefing_ready",
        name="notificationtype", create_type=False,
    )
    notification_type.create(op.get_bind(), checkfirst=True)

    research_status = postgresql.ENUM(
        "in_progress", "completed", "failed",
        name="researchstatus", create_type=False,
    )
    research_status.create(op.get_bind(), checkfirst=True)

    risk_level = postgresql.ENUM(
        "low", "medium", "high", "critical",
        name="risklevel", create_type=False,
    )
    risk_level.create(op.get_bind(), checkfirst=True)

    # ── users ─────────────────────────────────────────────────────────────────
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("display_name", sa.String(255), nullable=False),
        sa.Column("hashed_password", sa.String(255), nullable=False),
        sa.Column("role", sa.String(50), nullable=False, server_default="user"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("email", name="uq_users_email"),
    )
    op.create_index("ix_users_email", "users", ["email"])

    # ── user_sessions ─────────────────────────────────────────────────────────
    op.create_table(
        "user_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("token_hash", name="uq_user_sessions_token_hash"),
    )
    op.create_index("ix_user_sessions_user_id", "user_sessions", ["user_id"])
    op.create_index("ix_user_sessions_token_hash", "user_sessions", ["token_hash"])

    # ── google_credentials ────────────────────────────────────────────────────
    op.create_table(
        "google_credentials",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("access_token_encrypted", sa.Text(), nullable=False),
        sa.Column("refresh_token_encrypted", sa.Text(), nullable=False),
        sa.Column("token_expiry", sa.DateTime(timezone=True), nullable=True),
        sa.Column("scopes", postgresql.ARRAY(sa.String()), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    # ── google_sync_state ─────────────────────────────────────────────────────
    op.create_table(
        "google_sync_state",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("service", sa.String(50), nullable=False),
        sa.Column("last_sync_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sync_token", sa.Text(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("user_id", "service", name="uq_google_sync_state_user_service"),
    )

    # ── document_categories ───────────────────────────────────────────────────
    op.create_table(
        "document_categories",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("parent_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("document_categories.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("name", name="uq_document_categories_name"),
    )

    # ── documents ─────────────────────────────────────────────────────────────
    op.create_table(
        "documents",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("category_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("document_categories.id"), nullable=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("filename", sa.String(500), nullable=True),
        sa.Column("mime_type", sa.String(127), nullable=True),
        sa.Column("file_size_bytes", sa.BigInteger(), nullable=True),
        sa.Column("file_path_encrypted", sa.Text(), nullable=True),
        sa.Column("checksum_sha256", sa.String(64), nullable=True),
        sa.Column("source_type", sa.String(30), nullable=False, server_default="upload"),
        sa.Column("source_url", sa.Text(), nullable=True),
        sa.Column("is_regulated", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("tags", postgresql.ARRAY(sa.String()), nullable=False, server_default="{}"),
        sa.Column("raw_content", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
    )
    op.create_index("ix_documents_checksum", "documents", ["checksum_sha256"])
    op.create_index("ix_documents_status", "documents", ["status"])

    # ── document_chunks ───────────────────────────────────────────────────────
    op.create_table(
        "document_chunks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("document_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("documents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("embedding", sa.Text(), nullable=True),  # managed as vector(768)
        sa.Column("token_count", sa.Integer(), nullable=True),
        sa.Column("page_number", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    # Replace the text column with a proper vector column
    op.execute("ALTER TABLE document_chunks DROP COLUMN embedding")
    op.execute("ALTER TABLE document_chunks ADD COLUMN embedding vector(768)")
    op.create_index("ix_document_chunks_document_id", "document_chunks", ["document_id"])
    # IVFFlat index for approximate nearest-neighbour search (build after data load)
    op.execute(
        "CREATE INDEX ix_document_chunks_embedding_ivfflat "
        "ON document_chunks USING ivfflat (embedding vector_cosine_ops) "
        "WITH (lists = 100)"
    )

    # ── conversations ─────────────────────────────────────────────────────────
    op.create_table(
        "conversations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("title", sa.String(500), nullable=True),
        sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_conversations_user_id", "conversations", ["user_id"])

    # ── agent_runs ────────────────────────────────────────────────────────────
    op.create_table(
        "agent_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("conversations.id"), nullable=False),
        sa.Column("agent_type", sa.String(50), nullable=False),
        sa.Column("status", sa.String(30), nullable=False, server_default="running"),
        sa.Column("graph_state", postgresql.JSONB(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )

    # ── messages ──────────────────────────────────────────────────────────────
    op.create_table(
        "messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("agent_run_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("agent_runs.id"), nullable=True),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("cited_chunk_ids", postgresql.ARRAY(postgresql.UUID(as_uuid=True)), nullable=True),
        sa.Column("tool_calls", postgresql.JSONB(), nullable=True),
        sa.Column("tool_results", postgresql.JSONB(), nullable=True),
        sa.Column("token_count", sa.Integer(), nullable=True),
        sa.Column("model_used", sa.String(100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_messages_conversation_id", "messages", ["conversation_id"])

    # ── approval_intents ──────────────────────────────────────────────────────
    op.create_table(
        "approval_intents",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("agent_run_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("agent_runs.id"), nullable=True),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("conversations.id"), nullable=True),
        sa.Column("requested_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("action_type", sa.String(100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("intent_payload", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("risk_level", sa.String(20), nullable=False, server_default="medium"),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resolved_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rejection_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_approval_intents_status", "approval_intents", ["status"])

    # ── projects ──────────────────────────────────────────────────────────────
    op.create_table(
        "projects",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(50), nullable=False, server_default="active"),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    # ── tasks ─────────────────────────────────────────────────────────────────
    op.create_table(
        "tasks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id"), nullable=True),
        sa.Column("parent_task_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tasks.id"), nullable=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="todo"),
        sa.Column("priority", sa.String(20), nullable=False, server_default="medium"),
        sa.Column("assignee_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("due_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source_agent_run_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("agent_runs.id"), nullable=True),
        sa.Column("source_conversation_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("conversations.id"), nullable=True),
        sa.Column("tags", postgresql.ARRAY(sa.String()), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
    )
    op.create_index("ix_tasks_project_id", "tasks", ["project_id"])
    op.create_index("ix_tasks_status", "tasks", ["status"])

    # ── task_comments ─────────────────────────────────────────────────────────
    op.create_table(
        "task_comments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("author_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    # ── research_reports ──────────────────────────────────────────────────────
    op.create_table(
        "research_reports",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("conversations.id"), nullable=True),
        sa.Column("agent_run_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("agent_runs.id"), nullable=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("query", sa.Text(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("full_report", sa.Text(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="completed"),
        sa.Column("tags", postgresql.ARRAY(sa.String()), nullable=False, server_default="{}"),
        sa.Column("ingested_as_document_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("documents.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
    )

    # ── research_sources ──────────────────────────────────────────────────────
    op.create_table(
        "research_sources",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("report_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("research_reports.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(500), nullable=True),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("domain", sa.String(255), nullable=True),
        sa.Column("snippet", sa.Text(), nullable=True),
        sa.Column("relevance_score", sa.Float(), nullable=True),
        sa.Column("retrieved_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_research_sources_report_id", "research_sources", ["report_id"])

    # ── regulatory_documents ──────────────────────────────────────────────────
    op.create_table(
        "regulatory_documents",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("document_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("documents.id"), nullable=True),
        sa.Column("doc_type", sa.String(30), nullable=False),
        sa.Column("doc_number", sa.String(100), nullable=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("revision", sa.String(20), nullable=False, server_default="1.0"),
        sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
        sa.Column("supersedes_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("regulatory_documents.id"), nullable=True),
        sa.Column("related_standards", postgresql.ARRAY(sa.String()), nullable=False, server_default="{}"),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("effective_date", sa.Date(), nullable=True),
        sa.Column("next_review_date", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
    )
    op.create_index("ix_regulatory_documents_doc_type", "regulatory_documents", ["doc_type"])
    op.create_index("ix_regulatory_documents_status", "regulatory_documents", ["status"])

    # ── risk_items ────────────────────────────────────────────────────────────
    op.create_table(
        "risk_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("regulatory_doc_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("regulatory_documents.id"), nullable=True),
        sa.Column("hazard", sa.Text(), nullable=False),
        sa.Column("hazardous_situation", sa.Text(), nullable=False),
        sa.Column("harm", sa.Text(), nullable=False),
        sa.Column("probability_before", sa.Integer(), sa.CheckConstraint("probability_before BETWEEN 1 AND 5"), nullable=True),
        sa.Column("severity_before", sa.Integer(), sa.CheckConstraint("severity_before BETWEEN 1 AND 5"), nullable=True),
        sa.Column("mitigation_measures", sa.Text(), nullable=True),
        sa.Column("probability_after", sa.Integer(), sa.CheckConstraint("probability_after BETWEEN 1 AND 5"), nullable=True),
        sa.Column("severity_after", sa.Integer(), sa.CheckConstraint("severity_after BETWEEN 1 AND 5"), nullable=True),
        sa.Column("risk_acceptability", sa.String(20), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    # ── capas ─────────────────────────────────────────────────────────────────
    op.create_table(
        "capas",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("capa_number", sa.String(100), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("capa_type", sa.String(10), nullable=False, server_default="capa"),
        sa.Column("root_cause", sa.Text(), nullable=True),
        sa.Column("corrective_action", sa.Text(), nullable=True),
        sa.Column("preventive_action", sa.Text(), nullable=True),
        sa.Column("status", sa.String(50), nullable=False, server_default="open"),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("due_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("capa_number", name="uq_capas_capa_number"),
    )
    op.create_index("ix_capas_capa_number", "capas", ["capa_number"])

    # ── notifications ─────────────────────────────────────────────────────────
    op.create_table(
        "notifications",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("type", sa.String(50), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("entity_type", sa.String(100), nullable=True),
        sa.Column("entity_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("is_read", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_notifications_user_id", "notifications", ["user_id"])
    op.create_index("ix_notifications_created_at", "notifications", ["created_at"])

    # ── briefings ─────────────────────────────────────────────────────────────
    op.create_table(
        "briefings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("type", sa.String(20), nullable=False),
        sa.Column("headline", sa.Text(), nullable=True),
        sa.Column("priority_items", postgresql.JSONB(), nullable=True),
        sa.Column("open_actions", postgresql.JSONB(), nullable=True),
        sa.Column("upcoming_events", postgresql.JSONB(), nullable=True),
        sa.Column("email_summary", postgresql.JSONB(), nullable=True),
        sa.Column("full_content", sa.Text(), nullable=True),
        sa.Column("agent_run_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("agent_runs.id"), nullable=True),
        sa.Column("generated_for_date", sa.Date(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_briefings_user_id", "briefings", ["user_id"])
    op.create_index("ix_briefings_generated_for_date", "briefings", ["generated_for_date"])

    # ── system_settings ───────────────────────────────────────────────────────
    op.create_table(
        "system_settings",
        sa.Column("key", sa.String(255), primary_key=True),
        sa.Column("value", postgresql.JSONB(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_secret", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
    )

    # ── model_routing_rules ───────────────────────────────────────────────────
    op.create_table(
        "model_routing_rules",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("agent_type", sa.String(50), nullable=False),
        sa.Column("task_category", sa.String(100), nullable=True),
        sa.Column("preferred_provider", sa.String(50), nullable=False, server_default="ollama"),
        sa.Column("preferred_model", sa.String(100), nullable=True),
        sa.Column("fallback_provider", sa.String(50), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    # ── audit_events ──────────────────────────────────────────────────────────
    op.create_table(
        "audit_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("sequence_number", sa.BigInteger(), sa.Identity(start=1, cycle=False), nullable=False),
        sa.Column("event_type", sa.String(100), nullable=False),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("entity_type", sa.String(100), nullable=True),
        sa.Column("entity_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("payload", postgresql.JSONB(), nullable=True),
        sa.Column("previous_hash", sa.String(64), nullable=False),
        sa.Column("record_hash", sa.String(64), nullable=False),
        sa.Column("ip_address", sa.String(45), nullable=True),
        sa.Column("user_agent", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("sequence_number", name="uq_audit_events_sequence_number"),
    )
    op.create_index("ix_audit_events_event_type", "audit_events", ["event_type"])
    op.create_index("ix_audit_events_actor_id", "audit_events", ["actor_id"])
    op.create_index("ix_audit_events_entity", "audit_events", ["entity_type", "entity_id"])

    # ── DB role permissions ───────────────────────────────────────────────────
    # pmi_app: no DELETE or UPDATE on audit_events (enforced at DB level)
    op.execute("REVOKE UPDATE, DELETE ON audit_events FROM pmi_app")


def downgrade() -> None:
    op.drop_table("audit_events")
    op.drop_table("model_routing_rules")
    op.drop_table("system_settings")
    op.drop_table("briefings")
    op.drop_table("notifications")
    op.drop_table("capas")
    op.drop_table("risk_items")
    op.drop_table("regulatory_documents")
    op.drop_table("research_sources")
    op.drop_table("research_reports")
    op.drop_table("task_comments")
    op.drop_table("tasks")
    op.drop_table("projects")
    op.drop_table("approval_intents")
    op.drop_table("messages")
    op.drop_table("agent_runs")
    op.drop_table("conversations")
    op.drop_table("document_chunks")
    op.drop_table("documents")
    op.drop_table("document_categories")
    op.drop_table("google_sync_state")
    op.drop_table("google_credentials")
    op.drop_table("user_sessions")
    op.drop_table("users")

    for enum_name in [
        "agenttype", "messagerole", "taskstatus", "taskpriority",
        "approvalstatus", "documentsourcetype", "documentstatus",
        "regdoctype", "regdocstatus", "briefingtype", "notificationtype",
        "researchstatus", "risklevel",
    ]:
        op.execute(f"DROP TYPE IF EXISTS {enum_name}")
