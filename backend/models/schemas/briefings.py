"""Pydantic schemas for Briefings."""

from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import BaseModel


class BriefingOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    type: str
    headline: str | None
    priority_items: list | None
    open_actions: list | None
    upcoming_events: list | None
    email_summary: list | None
    full_content: str | None
    generated_for_date: date
    created_at: datetime

    model_config = {"from_attributes": True}
