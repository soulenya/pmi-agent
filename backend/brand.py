"""The brand — every company-specific value the backend needs, from one file.

``brand/brand.json`` at the repository root (or ``backend/brand/brand.json``
inside the hub image; ``BRAND_FILE`` overrides both) names the company, its
domains, Drive locations, database names, feature flags and agent roster.
PMI's values are the built-in defaults, so an install without the file
behaves exactly as before. A white-label fork edits the file and nothing else.

This module has no project imports: ``config.py`` reads it for its defaults,
and everything else imports ``config``.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

_HERE = Path(__file__).resolve().parent
_CANDIDATES = (
    _HERE.parent / "brand" / "brand.json",  # repo / installed layout
    _HERE / "brand" / "brand.json",         # hub image (COPY brand/ ./brand/)
)

# PMI, as shipped through v5.18.0. Kept as the default so the absence of the
# file never changes an existing install.
_DEFAULTS: dict[str, Any] = {
    "slug": "littlegerry",
    "product_name": "Little Gerry",
    "assistant_name": "Gerry",
    "publisher": "Precisian Medical Instruments",
    "company_name": "Precisian Medical Instruments",
    "company_short": "PMI",
    "company_descriptor": "a medical device startup",
    "company_website": "https://www.precisianmedical.com",
    "product": {
        "name": "VACTOR",
        "one_liner": (
            "a compact, battery-powered suction device designed for emergency "
            "medicine, military, and tactical applications"
        ),
        "engineering_context": (
            "VACTOR DEVICE CONTEXT:\n"
            "- Compact, battery-powered portable suction device\n"
            "- Target: emergency medicine, military tactical, field surgical applications\n"
            "- Designed to meet IEC 60601-1 electrical safety, ISO 10079-1 (suction equipment)\n"
            "- Key performance: suction pressure, flow rate, battery life, IP rating, noise, weight"
        ),
    },
    "domains": ["pmi-llc.com", "precisianmedical.com"],
    "admin_email": "morganjkeane@pmi-llc.com",
    "support_email": "morganjkeane@pmi-llc.com",
    "vapid_subject": "mailto:morganjkeane@precisianmedical.com",
    "github_repo": "soulenya/pmi-agent",
    "hub_url": "https://hub.precisianmedical.com",
    "windows": {
        "app_id": "{F4A2B7C1-3D8E-4F6A-92B5-1E7D3C9A0F28}",
        "install_dir_name": "Little Gerry",
        "setup_name": "LittleGerry_Setup",
        "cert_cn": "Precisian Medical Instruments",
    },
    "macos": {"bundle_id": "com.precisian.littlegerry", "pkg_name": "LittleGerry"},
    "data_dir_name": ".pmi-agent",
    "keyring_service": "pmi-agent",
    "db": {
        "name": "pmi_dev",
        "superuser": "pmi",
        "app_role": "pmi_app",
        "audit_role": "pmi_audit",
        "api_container": "pmi_api",
        "postgres_container": "pmi_postgres",
    },
    "drive": {
        "company_context": "1aqx08UZ6J1qWAK4o9RMQMeonGvV1yI1C",
        "templates_folder": "1EFoPDRfAA1RaxRtWEEVj32eGfpeekV0F",
        "workrooms_share_folder": "1rk-Pg-Ly9cIrHF87Cr7Gnu7-VRUjamT7",
        "budgets_folder": "1k-tBw0UomODw-nwJjjkNteHaQltuNs2D",
        "invoices_folder": "10NQQeIETjEv_1fGCowSQSHGX37Cgn1eg",
        "backups_folder": "1I57fln_8vYkChX40vPV5pAjAu7Ue-hOG",
        "app_clients_folder": "",
        "restricted_folders": ["1c5mGaeldOIUXZyGVwUoTOsUTtGJ2LMp_"],
        "shared_drive_name": "PMI Share Drive",
        "hub_client_file": "1BuvAGSyr7wi-VVTJmFE81dnfDTyQSCsd",
        "oauth_client_download_url": (
            "https://drive.google.com/file/d/1qfh3eQU0p10yOyfENBpuguRwDvNfOPel/view?usp=sharing"
        ),
        "stt_key_download_url": (
            "https://drive.google.com/file/d/1FyBDnxuf7dSS0pEE-j6Ho4w5BMeDPCmQ/view?usp=drive_link"
        ),
    },
    "gcp": {
        "stt_bucket": "little_gerry_stt",
        "drive_backup_bucket": "pmi-drive-backup",
        "project": "pmi-littlegerry-hub",
        "region": "us-central1",
        "zone": "us-central1-a",
        "hub_vm": "hub",
        "registry": "us-central1-docker.pkg.dev",
        "image_repo": "littlegerry",
        "hub_backup_bucket": "pmi-littlegerry-hub-backup",
        "iap_audience": "/projects/200809642986/global/backendServices/3249219135556043655",
    },
    "features": {
        "regulatory": True,
        "qms_agent": True,
        "drive_restrictions": True,
        "investor_relations": True,
        "budgets": True,
        "invoices": True,
        "erp": True,
        "meetings": True,
        "hub": True,
    },
    "erp": {
        "providers": ["odoo"],
        "default": "odoo",
        "odoo": {
            "url": "https://precisian-medical-instruments.odoo.com",
            "database": "precisian-medical-instruments",
            "email_domain": "precisianmedical.com",
        },
    },
    "agents": [
        "executive_assistant", "house_manager", "research", "operations",
        "engineering", "qms", "regulatory", "ir",
    ],
}

# Agents that only make sense with the matching feature on.
_AGENT_FEATURES = {"regulatory": "regulatory", "qms": "qms_agent", "ir": "investor_relations"}


# Keys a brand file replaces wholesale (a company without a product must be
# able to clear it); every other dict is merged over the PMI defaults.
_REPLACE_KEYS = {"product", "erp"}


def _merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for key, value in override.items():
        if key not in _REPLACE_KEYS and isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _merge(out[key], value)
        else:
            out[key] = value
    return out


@dataclass(frozen=True)
class Brand:
    raw: dict[str, Any] = field(repr=False)
    source: str = "defaults"

    # ── identity ────────────────────────────────────────────────────────────
    @property
    def slug(self) -> str: return str(self.raw["slug"])
    @property
    def product_name(self) -> str: return str(self.raw["product_name"])
    @property
    def assistant_name(self) -> str: return str(self.raw["assistant_name"])
    @property
    def publisher(self) -> str: return str(self.raw["publisher"])
    @property
    def company_name(self) -> str: return str(self.raw["company_name"])
    @property
    def company_short(self) -> str: return str(self.raw["company_short"])
    @property
    def company_descriptor(self) -> str: return str(self.raw.get("company_descriptor") or "")
    @property
    def company_website(self) -> str: return str(self.raw.get("company_website") or "")
    @property
    def product(self) -> dict[str, str]: return dict(self.raw.get("product") or {})
    @property
    def product_name_short(self) -> str:
        """The flagship product's name, or the company's short name when there is none."""
        return str(self.product.get("name") or self.company_short)

    # ── access ──────────────────────────────────────────────────────────────
    @property
    def domains(self) -> list[str]:
        return [str(d).strip().lower().lstrip("@") for d in self.raw["domains"] if str(d).strip()]
    @property
    def admin_email(self) -> str: return str(self.raw["admin_email"])
    @property
    def support_email(self) -> str: return str(self.raw.get("support_email") or self.admin_email)
    @property
    def vapid_subject(self) -> str: return str(self.raw.get("vapid_subject") or f"mailto:{self.support_email}")
    @property
    def github_repo(self) -> str: return str(self.raw["github_repo"])
    @property
    def hub_url(self) -> str: return str(self.raw.get("hub_url") or "")

    # ── install / storage ───────────────────────────────────────────────────
    @property
    def data_dir_name(self) -> str: return str(self.raw["data_dir_name"])
    @property
    def keyring_service(self) -> str: return str(self.raw["keyring_service"])
    @property
    def db(self) -> dict[str, str]: return {k: str(v) for k, v in self.raw["db"].items()}
    @property
    def drive(self) -> dict[str, Any]:
        """Drive locations. Strings are ids/urls ("" when unset); ``restricted_folders`` is a list."""
        out: dict[str, Any] = {}
        for k, v in (self.raw.get("drive") or {}).items():
            if isinstance(v, list):
                out[k] = [str(x) for x in v if str(x).strip()]
            else:
                out[k] = str(v or "")
        return out
    @property
    def gcp(self) -> dict[str, str]: return {k: str(v or "") for k, v in (self.raw.get("gcp") or {}).items()}

    # ── features / agents ───────────────────────────────────────────────────
    def feature(self, name: str) -> bool:
        return bool((self.raw.get("features") or {}).get(name, False))

    @property
    def agents(self) -> list[str]:
        wanted = [str(a) for a in self.raw.get("agents") or []]
        return [a for a in wanted if a not in _AGENT_FEATURES or self.feature(_AGENT_FEATURES[a])]

    def agent_enabled(self, name: str) -> bool:
        return name in self.agents

    # ── prose helpers for prompts ───────────────────────────────────────────
    @property
    def identity_line(self) -> str:
        """'Little Gerry, the AI Executive Assistant for Precisian Medical Instruments
        (PMI), a medical device startup building VACTOR — a compact …' — the opening
        of every system prompt; product-less companies get the shorter form."""
        who = f"{self.product_name}, the AI Executive Assistant for {self.company_with_short}"
        tail = self.company_descriptor
        name, one_liner = self.product.get("name"), self.product.get("one_liner")
        if name and one_liner:
            tail = f"{tail} building {name} — {one_liner}" if tail else f"the company behind {name} — {one_liner}"
        return f"{who}, {tail}" if tail else who

    @property
    def company_with_short(self) -> str:
        """'Precisian Medical Instruments (PMI)', or just the name when they match."""
        if self.company_short and self.company_short != self.company_name:
            return f"{self.company_name} ({self.company_short})"
        return self.company_name

    @property
    def sign_in_hint(self) -> str:
        """'a @pmi-llc.com or @precisianmedical.com account'."""
        ats = [f"@{d}" for d in self.domains]
        if len(ats) <= 1:
            return f"a {ats[0]} account" if ats else "a company account"
        return "a " + ", ".join(ats[:-1]) + f" or {ats[-1]} account"


def _read(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, dict):
        raise ValueError(f"{path}: brand file must be a JSON object")
    return data


@lru_cache(maxsize=1)
def get_brand() -> Brand:
    """The brand in effect, loaded once. Missing file → PMI defaults."""
    env = os.environ.get("BRAND_FILE", "").strip()
    paths = [Path(env)] if env else list(_CANDIDATES)
    for path in paths:
        if path.is_file():
            data = _merge(_DEFAULTS, _read(path))
            return Brand(raw=data, source=str(path))
    return Brand(raw=dict(_DEFAULTS), source="defaults")


def escape_braces(text: str) -> str:
    """Make brand text safe inside a prompt that is later ``.format()``-ed."""
    return text.replace("{", "{{").replace("}", "}}")
