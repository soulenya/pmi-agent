"""Pydantic schemas for RegulatoryDocuments, RiskItems, and CAPAs."""

from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import BaseModel, Field


# ── RegulatoryDocument ────────────────────────────────────────────────────────

class RegDocCreate(BaseModel):
    doc_type: str
    title: str = Field(max_length=500)
    doc_number: str | None = Field(None, max_length=100)
    revision: str = "1.0"
    related_standards: list[str] = []
    effective_date: date | None = None
    next_review_date: date | None = None


class RegDocUpdate(BaseModel):
    title: str | None = Field(None, max_length=500)
    doc_number: str | None = None
    revision: str | None = None
    status: str | None = None
    related_standards: list[str] | None = None
    effective_date: date | None = None
    next_review_date: date | None = None
    reviewed_at: datetime | None = None
    approved_at: datetime | None = None


class RegDocOut(BaseModel):
    id: uuid.UUID
    document_id: uuid.UUID | None
    doc_type: str
    doc_number: str | None
    title: str
    revision: str
    status: str
    related_standards: list[str]
    owner_id: uuid.UUID | None
    reviewed_at: datetime | None
    approved_at: datetime | None
    effective_date: date | None
    next_review_date: date | None
    supersedes_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── RiskItem ──────────────────────────────────────────────────────────────────

class RiskItemCreate(BaseModel):
    regulatory_doc_id: uuid.UUID | None = None
    hazard: str
    hazardous_situation: str
    harm: str
    probability_before: int | None = Field(None, ge=1, le=5)
    severity_before: int | None = Field(None, ge=1, le=5)
    mitigation_measures: str | None = None
    probability_after: int | None = Field(None, ge=1, le=5)
    severity_after: int | None = Field(None, ge=1, le=5)
    risk_acceptability: str | None = None


class RiskItemUpdate(BaseModel):
    hazard: str | None = None
    hazardous_situation: str | None = None
    harm: str | None = None
    probability_before: int | None = Field(None, ge=1, le=5)
    severity_before: int | None = Field(None, ge=1, le=5)
    mitigation_measures: str | None = None
    probability_after: int | None = Field(None, ge=1, le=5)
    severity_after: int | None = Field(None, ge=1, le=5)
    risk_acceptability: str | None = None


class RiskItemOut(BaseModel):
    id: uuid.UUID
    regulatory_doc_id: uuid.UUID | None
    hazard: str
    hazardous_situation: str
    harm: str
    probability_before: int | None
    severity_before: int | None
    risk_score_before: int | None
    mitigation_measures: str | None
    probability_after: int | None
    severity_after: int | None
    risk_score_after: int | None
    risk_acceptability: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── CAPA ──────────────────────────────────────────────────────────────────────

class CAPACreate(BaseModel):
    capa_number: str = Field(max_length=100)
    title: str = Field(max_length=500)
    description: str | None = None
    capa_type: str = "capa"
    root_cause: str | None = None
    corrective_action: str | None = None
    preventive_action: str | None = None
    due_date: datetime | None = None
    owner_id: uuid.UUID | None = None


class CAPAUpdate(BaseModel):
    title: str | None = Field(None, max_length=500)
    description: str | None = None
    capa_type: str | None = None
    root_cause: str | None = None
    corrective_action: str | None = None
    preventive_action: str | None = None
    status: str | None = None
    due_date: datetime | None = None
    owner_id: uuid.UUID | None = None
    closed_at: datetime | None = None


class CAPAOut(BaseModel):
    id: uuid.UUID
    capa_number: str
    title: str
    description: str | None
    capa_type: str
    root_cause: str | None
    corrective_action: str | None
    preventive_action: str | None
    status: str
    owner_id: uuid.UUID | None
    due_date: datetime | None
    closed_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
