"""Errors shared by every ERP provider (no project imports — safe anywhere)."""

from __future__ import annotations


class ErpError(RuntimeError):
    """Base error for ERP integration failures."""


class ErpAuthError(ErpError):
    """Raised when authentication against the ERP fails."""
