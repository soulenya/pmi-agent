"""
Audit logger service — computes SHA-256 hash chain and appends events.
Use as a FastAPI dependency via get_audit_logger().
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db

from models.db.audit import AuditEvent
from repositories.audit_repo import AuditRepository


def _compute_record_hash(
    sequence_number: int,
    event_type: str,
    actor_id: str | None,
    entity_type: str | None,
    entity_id: str | None,
    payload: dict[str, Any],
    previous_hash: str,
    timestamp: str,
) -> str:
    """Deterministic SHA-256 over event fields to detect tampering."""
    canonical = json.dumps(
        {
            "sequence_number": sequence_number,
            "event_type": event_type,
            "actor_id": actor_id,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "payload": payload,
            "previous_hash": previous_hash,
            "timestamp": timestamp,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode()).hexdigest()


class AuditLogger:
    _GENESIS_HASH = "0" * 64  # initial sentinel value

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self._repo = AuditRepository(session)

    async def log(
        self,
        event_type: str,
        *,
        actor_id: UUID | None = None,
        entity_type: str | None = None,
        entity_id: UUID | None = None,
        payload: dict[str, Any] | None = None,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> AuditEvent:
        payload = payload or {}

        latest = await self._repo.get_latest()
        previous_hash = latest.record_hash if latest else self._GENESIS_HASH
        next_seq = (latest.sequence_number + 1) if latest else 1

        now = datetime.now(timezone.utc)
        timestamp_str = now.isoformat()

        record_hash = _compute_record_hash(
            sequence_number=next_seq,
            event_type=event_type,
            actor_id=str(actor_id) if actor_id else None,
            entity_type=entity_type,
            entity_id=str(entity_id) if entity_id else None,
            payload=payload,
            previous_hash=previous_hash,
            timestamp=timestamp_str,
        )

        event = await self._repo.create(
            event_type=event_type,
            actor_id=actor_id,
            entity_type=entity_type,
            entity_id=entity_id,
            payload=payload,
            previous_hash=previous_hash,
            record_hash=record_hash,
            ip_address=ip_address,
            user_agent=user_agent,
            created_at=now,
        )
        return event

    async def verify_chain(self, limit: int = 1000) -> list[int]:
        """
        Verify the hash chain for the most recent `limit` events.
        Returns a list of sequence numbers where the chain is broken.
        """
        events = await self._repo.list(
            order_by=AuditEvent.sequence_number,
            limit=limit,
        )
        broken: list[int] = []
        prev_hash = self._GENESIS_HASH

        for event in events:
            expected = _compute_record_hash(
                sequence_number=event.sequence_number,
                event_type=event.event_type,
                actor_id=str(event.actor_id) if event.actor_id else None,
                entity_type=event.entity_type,
                entity_id=str(event.entity_id) if event.entity_id else None,
                payload=event.payload or {},
                previous_hash=prev_hash,
                timestamp=event.created_at.isoformat(),
            )
            if expected != event.record_hash:
                broken.append(event.sequence_number)
            prev_hash = event.record_hash

        return broken


async def get_audit_logger(
    db: AsyncSession = Depends(get_db),
) -> AuditLogger:
    """FastAPI dependency — inject as Depends(get_audit_logger)."""
    return AuditLogger(db)
