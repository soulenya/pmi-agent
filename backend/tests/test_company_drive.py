"""services/company_drive: resolver precedence, layout creation and publish/import without Drive."""

from __future__ import annotations

import json

import pytest

import brand as brand_mod
from services import company_drive as cd


class _FakeDB:
    """Just enough of AsyncSession for company_drive's _read/_write."""

    def __init__(self, rows: dict | None = None):
        self.rows: dict[str, object] = dict(rows or {})

    async def execute(self, stmt):
        key = stmt.whereclause.right.value
        row = self.rows.get(key)
        return _Result(_Row(self.rows, key) if row is not None else None)

    def add(self, obj):
        self.rows[obj.key] = obj.value

    async def flush(self):
        pass


class _Row:
    def __init__(self, rows, key):
        object.__setattr__(self, "_rows", rows)
        object.__setattr__(self, "key", key)
        self.updated_by = None

    @property
    def value(self):
        return self._rows[self.key]

    @value.setter
    def value(self, v):
        self._rows[self.key] = v


class _Result:
    def __init__(self, row):
        self._row = row

    def scalar_one_or_none(self):
        return self._row


@pytest.fixture
def pmi(monkeypatch, tmp_path):
    monkeypatch.setenv("BRAND_FILE", str(tmp_path / "missing.json"))
    brand_mod.get_brand.cache_clear()
    yield brand_mod.get_brand()
    brand_mod.get_brand.cache_clear()


@pytest.fixture
def blank_brand(monkeypatch, tmp_path):
    path = tmp_path / "brand.json"
    path.write_text(json.dumps({
        "slug": "acme", "product_name": "Acme Assistant", "company_name": "Acme Ltd",
        "company_short": "Acme", "domains": ["acme.test"],
        "drive": {"company_context": "", "templates_folder": "", "budgets_folder": "",
                  "invoices_folder": "", "backups_folder": "", "workrooms_share_folder": "",
                  "app_clients_folder": "", "restricted_folders": [], "shared_drive_name": "",
                  "oauth_client_download_url": "", "stt_key_download_url": ""},
        "gcp": {"drive_backup_bucket": ""},
        "features": {"drive_restrictions": False},
    }), encoding="utf-8")
    monkeypatch.setenv("BRAND_FILE", str(path))
    brand_mod.get_brand.cache_clear()
    yield brand_mod.get_brand()
    brand_mod.get_brand.cache_clear()


async def test_pmi_brand_defaults_win_when_no_setting(pmi):
    db = _FakeDB()
    assert await cd.resolve(db, "budgets") == "1k-tBw0UomODw-nwJjjkNteHaQltuNs2D"
    assert await cd.resolve(db, "invoices") == "10NQQeIETjEv_1fGCowSQSHGX37Cgn1eg"
    assert await cd.resolve(db, "backups") == "1I57fln_8vYkChX40vPV5pAjAu7Ue-hOG"
    assert await cd.resolve(db, "restricted_folders") == ["1c5mGaeldOIUXZyGVwUoTOsUTtGJ2LMp_"]
    assert await cd.resolve(db, "shared_drive_name") == "PMI Share Drive"
    assert await cd.resolve(db, "drive_backup_bucket") == "pmi-drive-backup"
    assert await cd.source_of(db, "budgets") == "brand"
    assert not cd.needs_import()


async def test_setting_overrides_brand_and_blank_clears(pmi):
    db = _FakeDB({"budgets.folder_id_override": "FOLDER123"})
    assert await cd.resolve(db, "budgets") == "FOLDER123"
    assert await cd.source_of(db, "budgets") == "setting"
    await cd.set_locations(db, {"budgets": ""})
    assert await cd.resolve(db, "budgets") == "1k-tBw0UomODw-nwJjjkNteHaQltuNs2D"
    with pytest.raises(ValueError):
        await cd.set_locations(db, {"nope": "x"})


async def test_blank_brand_reports_none_and_hides_restricted(blank_brand):
    db = _FakeDB()
    assert await cd.resolve(db, "budgets") == ""
    assert await cd.source_of(db, "budgets") == "none"
    assert cd.needs_import()
    keys = [r["key"] for r in await cd.status(db)]
    assert "restricted_folders" not in keys and "budgets" in keys
    assert cd.company_file_name() == "acme-company.json"


async def test_create_layout_seeds_and_stores_ids(blank_brand, monkeypatch):
    from services import google_service as gs

    created: dict[str, str] = {}
    uploads: list[tuple[str, str]] = []

    def fake_child(name, parent_id):
        created[name] = f"id-{name}"
        return {"id": f"id-{name}", "name": name, "url": "", "created": True}

    def fake_list(folder_id, drive_id=None, max_results=100):
        # Pretend "01 Company.md" already exists so idempotence is exercised.
        return [{"name": "01 Company.md"}] if folder_id == "id-Company Truth" else []

    def fake_upload(data, name, mime_type=None, folder_id=None):
        uploads.append((folder_id, name))
        return {"id": "f", "name": name, "url": ""}

    monkeypatch.setattr(gs, "drive_find_or_create_child_folder", fake_child)
    monkeypatch.setattr(gs, "drive_list_folder", fake_list)
    monkeypatch.setattr(gs, "drive_upload_bytes", fake_upload)
    monkeypatch.setattr(gs, "get_credentials", lambda: object())

    db = _FakeDB()
    report = await cd.create_layout(db, "PARENT", with_qms_template=False)
    assert set(created) == {"Company Truth", "Templates", "Budgets", "Invoices", "Workrooms", "Backups", "app-clients"}
    truth = [n for f, n in uploads if f == "id-Company Truth"]
    assert "01 Company.md" not in truth and "03 Key Partners / Stakeholders.md" in truth and len(truth) == 10
    templates = [n for f, n in uploads if f == "id-Templates"]
    assert templates == ["Style Guide.md", "Deck Theme.md"]
    assert await cd.resolve(db, "budgets") == "id-Budgets"
    assert report["ids"]["app_clients"] == "id-app-clients"


async def test_publish_then_import_roundtrip(blank_brand, monkeypatch):
    from services import google_service as gs

    store: dict[str, bytes] = {}

    monkeypatch.setattr(gs, "get_credentials", lambda: object())
    monkeypatch.setattr(gs, "drive_list_folder", lambda folder_id, drive_id=None, max_results=100: [])
    monkeypatch.setattr(gs, "drive_upload_bytes",
                        lambda data, name, mime_type=None, folder_id=None: store.__setitem__(name, data) or {"id": "pub", "name": name, "url": ""})
    monkeypatch.setattr(gs, "drive_search_by_name",
                        lambda name, max_results=25: [{"id": "pub", "name": n} for n in store if n == name])
    monkeypatch.setattr(gs, "drive_download_bytes", lambda file_id: {"content": store["acme-company.json"]})

    admin_db = _FakeDB({"company.app_clients_folder_id": "id-app-clients",
                        "budgets.folder_id_override": "id-Budgets"})
    out = await cd.publish(admin_db)
    assert out["name"] == "acme-company.json" and out["locations"]["budgets"] == "id-Budgets"

    other = _FakeDB()
    result = await cd.import_from_drive(other)
    assert result["found"] and "budgets" in result["applied"]
    assert await cd.resolve(other, "budgets") == "id-Budgets"
    # Existing settings are kept unless overwrite is asked for.
    other2 = _FakeDB({"budgets.folder_id_override": "MINE"})
    r2 = await cd.import_from_drive(other2)
    assert "budgets" not in r2["applied"] and await cd.resolve(other2, "budgets") == "MINE"
