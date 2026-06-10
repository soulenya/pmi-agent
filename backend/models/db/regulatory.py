"""RegulatoryDocument, RiskItem, and CAPA ORM models."""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import CheckConstraint, Computed, Date, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.db.base import Base
from models.db.enums import RegDocStatus, RegDocType


class RegulatoryDocument(Base):
    __tablename__ = "regulatory_documents"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # Optional link to the main document store
    document_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id"), nullable=True
    )

    doc_type: Mapped[RegDocType] = mapped_column(String(30), nullable=False, index=True)
    doc_number: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    revision: Mapped[str] = mapped_column(String(20), nullable=False, default="1.0")
    status: Mapped[RegDocStatus] = mapped_column(
        String(20), nullable=False, default=RegDocStatus.DRAFT, index=True
    )

    # Version lineage
    supersedes_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("regulatory_documents.id"), nullable=True
    )
    # e.g. ["ISO 13485:2016", "IEC 60601-1", "ISO 14971:2019"]
    related_standards: Mapped[list[str]] = mapped_column(
        ARRAY(String), nullable=False, default=list
    )

    owner_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    effective_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    next_review_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )

    risk_items: Mapped[list[RiskItem]] = relationship(
        "RiskItem", back_populates="regulatory_document", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<RegulatoryDocument {self.doc_number} {self.title!r} Rev {self.revision}>"


class RiskItem(Base):
    """ISO 14971 risk item with before/after mitigation scores."""

    __tablename__ = "risk_items"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    regulatory_doc_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("regulatory_documents.id"), nullable=True, index=True
    )

    # ISO 14971 fields
    hazard: Mapped[str] = mapped_column(Text, nullable=False)
    hazardous_situation: Mapped[str] = mapped_column(Text, nullable=False)
    harm: Mapped[str] = mapped_column(Text, nullable=False)

    # Risk before mitigation (1-5 scale)
    probability_before: Mapped[int | None] = mapped_column(
        Integer, CheckConstraint("probability_before BETWEEN 1 AND 5", name="ck_risk_items_probability_before"), nullable=True
    )
    severity_before: Mapped[int | None] = mapped_column(
        Integer, CheckConstraint("severity_before BETWEEN 1 AND 5", name="ck_risk_items_severity_before"), nullable=True
    )

    mitigation_measures: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Risk after mitigation (1-5 scale)
    probability_after: Mapped[int | None] = mapped_column(
        Integer, CheckConstraint("probability_after BETWEEN 1 AND 5", name="ck_risk_items_probability_after"), nullable=True
    )
    severity_after: Mapped[int | None] = mapped_column(
        Integer, CheckConstraint("severity_after BETWEEN 1 AND 5", name="ck_risk_items_severity_after"), nullable=True
    )

    # acceptable | alarp | unacceptable
    risk_acceptability: Mapped[str | None] = mapped_column(String(20), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    regulatory_document: Mapped[RegulatoryDocument | None] = relationship(
        "RegulatoryDocument", back_populates="risk_items"
    )

    @property
    def risk_score_before(self) -> int | None:
        if self.probability_before and self.severity_before:
            return self.probability_before * self.severity_before
        return None

    @property
    def risk_score_after(self) -> int | None:
        if self.probability_after and self.severity_after:
            return self.probability_after * self.severity_after
        return None


class CAPA(Base):
    __tablename__ = "capas"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    capa_number: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # ca | pa | capa
    capa_type: Mapped[str] = mapped_column(String(10), nullable=False, default="capa")

    root_cause: Mapped[str | None] = mapped_column(Text, nullable=True)
    corrective_action: Mapped[str | None] = mapped_column(Text, nullable=True)
    preventive_action: Mapped[str | None] = mapped_column(Text, nullable=True)

    status: Mapped[str] = mapped_column(String(50), nullable=False, default="open")
    owner_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    due_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class RegulatoryNode(Base):
    """A node in the Regulatory file explorer — either a folder or a file.

    Folders and files form a single self-referential tree (``parent_id``).
    File bytes live on disk under the local regulatory store; ``stored_filename``
    is the stable on-disk name (``{uuid}{ext}``) so renames/moves in the tree
    never touch the filesystem.
    """

    __tablename__ = "regulatory_nodes"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("regulatory_nodes.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    # "folder" | "file"
    node_type: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(500), nullable=False)

    # File-only fields (NULL for folders)
    stored_filename: Mapped[str | None] = mapped_column(String(300), nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(150), nullable=True)
    extension: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Provenance: where the file came from
    # "upload" | "google_drive" | "folder"
    source_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    source_file_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_modified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # ── Source-update tracking (Google Drive selective sync) ────────────────────
    # sync_status: NULL/"current" | "modified" | "renamed" | "deleted"
    sync_status: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    sync_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_name: Mapped[str | None] = mapped_column(String(500), nullable=True)
    last_checked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_synced_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    parent: Mapped[RegulatoryNode | None] = relationship(
        "RegulatoryNode", remote_side="RegulatoryNode.id", back_populates="children"
    )
    children: Mapped[list[RegulatoryNode]] = relationship(
        "RegulatoryNode",
        back_populates="parent",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    def __repr__(self) -> str:
        return f"<RegulatoryNode {self.node_type} {self.name!r}>"
