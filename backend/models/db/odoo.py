"""Compatibility: the Odoo connection row is now ``models.db.erp.ErpConnection``."""

from __future__ import annotations

from models.db.erp import ErpConnection

OdooConnection = ErpConnection

__all__ = ["OdooConnection", "ErpConnection"]
