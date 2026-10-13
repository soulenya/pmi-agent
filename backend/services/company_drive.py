"""The company's Drive layout — where each feature keeps its files.

Every Drive location the app depends on (Company Truth, Templates, Budgets,
Invoices, Workrooms, Backups, the app-clients folder, restricted folders) is a
*location* with three possible sources, in order:

1. a SystemSetting written by the Company Setup wizard or Settings → Company;
2. the brand's default in ``brand/brand.json`` (PMI's ids live there, so a
   PMI install needs no setting and behaves exactly as before);
3. nothing — the feature reports "not configured" instead of failing on
   someone else's folder.

The wizard can also *create* the layout: one parent folder the admin picks,
the standard sub-folders inside it, and the blank Company Truth and starter
templates copied in. Idempotent — an existing folder or file of the same name
is reused, never duplicated.

Because every desktop install has its own database, the ids chosen on the
admin's machine are also *published* as a small JSON file in the app-clients
folder on the shared drive; every other install finds that file by name on
first Google connection and adopts the ids (``import_from_drive``). That is
the same mechanism the hub sign-in client already uses.
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from brand import get_brand
from models.db.settings import SystemSetting

logger = logging.getLogger(__name__)

STARTER_DIR = Path(__file__).resolve().parent.parent / "assets" / "starter"
COMPANY_TRUTH_FOLDER = "Company Truth"
TEMPLATES_FOLDER = "Templates"
APP_CLIENTS_FOLDER = "app-clients"

# Local starter file → the name it gets on Drive (Drive allows "/").
_TRUTH_SECTIONS: tuple[tuple[str, str], ...] = (
    ("01 Company.md", "01 Company.md"),
    ("02 Key People.md", "02 Key People.md"),
    ("03 Key Partners - Stakeholders.md", "03 Key Partners / Stakeholders.md"),
    ("04 Products & Programs.md", "04 Products & Programs.md"),
    ("05 Market.md", "05 Market.md"),
    ("06 Regulatory Context.md", "06 Regulatory Context.md"),
    ("07 Financial.md", "07 Financial.md"),
    ("08 ERP & Banking.md", "08 ERP & Banking.md"),
    ("09 Glossary - Internal Shorthand.md", "09 Glossary / Internal Shorthand.md"),
    ("10 Security & Confidentiality.md", "10 Security & Confidentiality.md"),
    ("11 Ground Rules.md", "11 Ground Rules.md"),
)
_TEMPLATE_FILES: tuple[str, ...] = ("Style Guide.md", "Deck Theme.md", "QMS SOP Template.md")


@dataclass(frozen=True)
class Location:
    key: str
    label: str
    setting_key: str
    brand_key: str
    kind: str          # "folder" | "file_or_folder" | "folder_list" | "bucket" | "name"
    purpose: str
    folder_name: str = ""   # created by create_layout when set
    feature: str = ""       # only meaningful when this brand feature is on


LOCATIONS: tuple[Location, ...] = (
    Location("company_context", "Company Truth", "company.profile_drive_file_id", "company_context",
             "file_or_folder", "Folder (or single file) of company facts loaded into every conversation.",
             COMPANY_TRUTH_FOLDER),
    Location("templates", "Templates", "templates.drive_folder_id", "templates_folder",
             "folder", "Document templates, the Style Guide and the Deck Theme.", TEMPLATES_FOLDER),
    Location("budgets", "Budgets", "budgets.folder_id_override", "budgets_folder",
             "folder", "Budget spreadsheets the assistant creates.", "Budgets", "budgets"),
    Location("invoices", "Invoices", "invoices.parent_folder_id_override", "invoices_folder",
             "folder", "Parent of the per-vendor '<Vendor> Invoices' folders.", "Invoices", "invoices"),
    Location("workrooms", "Workrooms", "workrooms.share_folder_id_override", "workrooms_share_folder",
             "folder", "Shared room manifests.", "Workrooms"),
    Location("backups", "Backups", "backup.drive_folder_id", "backups_folder",
             "folder", "Conversation backups.", "Backups"),
    Location("app_clients", "App clients", "company.app_clients_folder_id", "app_clients_folder",
             "folder", "Credential files distributed to every install (hub client, company settings).",
             APP_CLIENTS_FOLDER),
    Location("restricted_folders", "Restricted folders", "drive_policy.restricted_folder_ids",
             "restricted_folders", "folder_list",
             "Folders the assistant must confirm before reading.", "", "drive_restrictions"),
    Location("shared_drive_name", "Backed-up shared drive", "backup.shared_drive_name",
             "shared_drive_name", "name", "Shared drive the nightly Drive→GCS backup mirrors."),
    Location("drive_backup_bucket", "Drive backup bucket", "backup.gcs_bucket", "drive_backup_bucket",
             "bucket", "GCS bucket the Drive backup lands in (read by the backup monitor)."),
)
_BY_KEY = {loc.key: loc for loc in LOCATIONS}


def company_file_name() -> str:
    return f"{get_brand().slug}-company.json"


def _brand_default(loc: Location) -> Any:
    brand = get_brand()
    if loc.kind == "bucket":
        return brand.gcp.get(loc.brand_key, "")
    return brand.drive.get(loc.brand_key, [] if loc.kind == "folder_list" else "")


async def _read(db: AsyncSession, key: str) -> Any:
    row = (await db.execute(select(SystemSetting).where(SystemSetting.key == key))).scalar_one_or_none()
    return row.value if row is not None else None


async def _write(db: AsyncSession, key: str, value: Any, user_id=None) -> None:
    row = (await db.execute(select(SystemSetting).where(SystemSetting.key == key))).scalar_one_or_none()
    if row is None:
        db.add(SystemSetting(key=key, value=value, updated_by=user_id))
    else:
        row.value = value
        row.updated_by = user_id
    await db.flush()


async def resolve(db: AsyncSession | None, key: str) -> Any:
    """Setting → brand default → "" (or [] for a folder list)."""
    loc = _BY_KEY[key]
    if db is not None:
        try:
            value = await _read(db, loc.setting_key)
        except Exception:  # noqa: BLE001 — a read failure must not take the brand default down with it
            logger.exception("Could not read setting %s", loc.setting_key)
            value = None
        if loc.kind == "folder_list":
            if isinstance(value, list) and value:
                return [str(v) for v in value if v]
        elif value:
            return str(value)
    return _brand_default(loc)


async def source_of(db: AsyncSession, key: str) -> str:
    loc = _BY_KEY[key]
    value = await _read(db, loc.setting_key)
    if (isinstance(value, list) and value) or (not isinstance(value, list) and value):
        return "setting"
    return "brand" if _brand_default(loc) else "none"


async def status(db: AsyncSession) -> list[dict]:
    brand = get_brand()
    out: list[dict] = []
    for loc in LOCATIONS:
        if loc.feature and not brand.feature(loc.feature):
            continue
        out.append({
            "key": loc.key,
            "label": loc.label,
            "kind": loc.kind,
            "purpose": loc.purpose,
            "value": await resolve(db, loc.key),
            "source": await source_of(db, loc.key),
            "created_by_layout": bool(loc.folder_name),
        })
    return out


async def set_locations(db: AsyncSession, values: dict[str, Any], user_id=None) -> None:
    """Write the given locations; a blank value clears the setting (brand default applies)."""
    for key, value in values.items():
        loc = _BY_KEY.get(key)
        if loc is None:
            raise ValueError(f"Unknown location '{key}'.")
        if loc.kind == "folder_list":
            cleaned = [str(v).strip() for v in (value or []) if str(v).strip()]
            await _write(db, loc.setting_key, cleaned, user_id)
        else:
            await _write(db, loc.setting_key, str(value or "").strip(), user_id)


# ── Layout creation ─────────────────────────────────────────────────────────

def _starter(path: Path) -> bytes:
    return path.read_bytes()


def _seed_folder(folder_id: str, files: list[tuple[Path, str]]) -> list[str]:
    """Upload each (local path, drive name) unless a file of that name already exists. Blocking."""
    from services import google_service as gs

    existing = {c["name"] for c in gs.drive_list_folder(folder_id, max_results=200)}
    added: list[str] = []
    for local, drive_name in files:
        if drive_name in existing or not local.is_file():
            continue
        gs.drive_upload_bytes(_starter(local), drive_name, "text/markdown", folder_id)
        added.append(drive_name)
    return added


def _create_layout_blocking(parent_id: str, with_qms_template: bool) -> dict:
    from services import google_service as gs

    report: dict[str, Any] = {"folders": {}, "seeded": {}}
    ids: dict[str, str] = {}
    for loc in LOCATIONS:
        if not loc.folder_name:
            continue
        if loc.feature and not get_brand().feature(loc.feature):
            continue
        made = gs.drive_find_or_create_child_folder(loc.folder_name, parent_id)
        ids[loc.key] = made["id"]
        report["folders"][loc.key] = {"id": made["id"], "name": made["name"], "url": made["url"],
                                      "created": made["created"]}
    truth_files = [(STARTER_DIR / "company-truth" / local, drive) for local, drive in _TRUTH_SECTIONS]
    report["seeded"]["company_context"] = _seed_folder(ids["company_context"], truth_files)
    template_names = [n for n in _TEMPLATE_FILES if with_qms_template or not n.startswith("QMS")]
    report["seeded"]["templates"] = _seed_folder(
        ids["templates"], [(STARTER_DIR / "templates" / n, n) for n in template_names]
    )
    report["ids"] = ids
    return report


async def create_layout(db: AsyncSession, parent_id: str, user_id=None, *, with_qms_template: bool = True) -> dict:
    """Create the folder layout under ``parent_id`` (a folder or shared-drive id), seed it, store the ids."""
    from services.google_service import get_credentials

    if get_credentials() is None:
        raise RuntimeError("Google is not connected on this computer.")
    parent_id = parent_id.strip()
    if not parent_id:
        raise ValueError("Choose a shared drive or folder to create the layout in.")
    report = await asyncio.get_event_loop().run_in_executor(
        None, lambda: _create_layout_blocking(parent_id, with_qms_template)
    )
    await set_locations(db, report["ids"], user_id)
    return report


# ── Publish / import across installs ───────────────────────────────────────

async def publish(db: AsyncSession, user_id=None) -> dict:
    """Write this install's locations to ``<slug>-company.json`` in the app-clients folder."""
    from services import google_service as gs

    if gs.get_credentials() is None:
        raise RuntimeError("Google is not connected on this computer.")
    folder_id = await resolve(db, "app_clients")
    if not folder_id:
        raise RuntimeError("No app-clients folder is set — create the Drive layout first.")
    payload = {
        "app": "little-gerry-company",
        "schema": 1,
        "brand": get_brand().slug,
        "published_at": datetime.now(timezone.utc).isoformat(),
        "locations": {row["key"]: row["value"] for row in await status(db)},
    }
    raw = json.dumps(payload, indent=1).encode("utf-8")
    name = company_file_name()

    def _write_file() -> dict:
        existing = [c for c in gs.drive_list_folder(folder_id, max_results=200) if c["name"] == name]
        if existing:
            gs.drive_update_bytes(existing[0]["id"], raw, "application/json")
            return {"id": existing[0]["id"], "url": existing[0].get("url", ""), "updated": True}
        made = gs.drive_upload_bytes(raw, name, "application/json", folder_id)
        return {"id": made["id"], "url": made.get("url", ""), "updated": False}

    result = await asyncio.get_event_loop().run_in_executor(None, _write_file)
    await _write(db, "company.published_at", payload["published_at"], user_id)
    return {**result, "name": name, "locations": payload["locations"]}


def _find_company_file_blocking() -> dict | None:
    from services import google_service as gs

    name = company_file_name()
    matches = [f for f in gs.drive_search_by_name(name, max_results=10) if f.get("name") == name]
    if not matches:
        return None
    raw = gs.drive_download_bytes(matches[0]["id"]).get("content")
    if not isinstance(raw, bytes):
        return None
    try:
        data = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None
    if not isinstance(data, dict) or data.get("app") != "little-gerry-company":
        return None
    return data


async def import_from_drive(db: AsyncSession, user_id=None, *, overwrite: bool = False) -> dict:
    """Adopt the locations published by the admin. Returns {found, applied: [keys]}."""
    from services.google_service import get_credentials

    if get_credentials() is None:
        return {"found": False, "applied": [], "reason": "google_not_connected"}
    data = await asyncio.get_event_loop().run_in_executor(None, _find_company_file_blocking)
    if not data:
        return {"found": False, "applied": [], "reason": "no_company_file"}
    if data.get("brand") and data["brand"] != get_brand().slug:
        return {"found": False, "applied": [], "reason": "different_brand"}
    applied: list[str] = []
    for key, value in (data.get("locations") or {}).items():
        loc = _BY_KEY.get(key)
        if loc is None or not value:
            continue
        if not overwrite and await source_of(db, key) == "setting":
            continue
        await set_locations(db, {key: value}, user_id)
        applied.append(key)
    await _write(db, "company.imported_at", datetime.now(timezone.utc).isoformat(), user_id)
    return {"found": True, "applied": applied, "published_at": data.get("published_at")}


def needs_import() -> bool:
    """A brand whose file carries no Drive defaults relies on the published company file."""
    drive = get_brand().drive
    return not any(drive.get(k) for k in ("company_context", "templates_folder", "budgets_folder"))


async def import_once_at_startup(db: AsyncSession) -> None:
    """Desktop start: adopt the company file if this install has nothing yet. Never raises."""
    try:
        if not needs_import():
            return
        if await source_of(db, "company_context") == "setting":
            return
        result = await import_from_drive(db)
        if result.get("found"):
            await db.commit()
            logger.info("Company locations imported from Drive: %s", ", ".join(result["applied"]))
    except Exception:  # noqa: BLE001 — optional, best-effort
        logger.debug("Company file import skipped", exc_info=True)
