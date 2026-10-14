"""services/erp: provider registry, brand-driven availability, PMI wording preserved."""

from __future__ import annotations

import json

import pytest

import brand as brand_mod
from services import erp
from services import odoo_service as odoo


@pytest.fixture
def pmi(monkeypatch, tmp_path):
    monkeypatch.setenv("BRAND_FILE", str(tmp_path / "missing.json"))
    brand_mod.get_brand.cache_clear()
    yield
    brand_mod.get_brand.cache_clear()


@pytest.fixture
def no_erp_brand(monkeypatch, tmp_path):
    path = tmp_path / "brand.json"
    path.write_text(json.dumps({
        "slug": "acme", "product_name": "Acme Assistant", "company_name": "Acme Ltd",
        "company_short": "Acme", "domains": ["acme.test"],
        "erp": {"providers": ["odoo"], "default": "none"},
    }), encoding="utf-8")
    monkeypatch.setenv("BRAND_FILE", str(path))
    brand_mod.get_brand.cache_clear()
    yield
    brand_mod.get_brand.cache_clear()


def test_pmi_offers_odoo_by_default_with_prefill(pmi):
    infos = erp.available()
    assert [p.key for p in infos] == ["odoo", "none"]
    assert erp.default_key() == "odoo"
    od = infos[0]
    assert od.defaults["url"] == "https://precisian-medical-instruments.odoo.com"
    assert od.defaults["database"] == "precisian-medical-instruments"
    assert od.defaults["email_domain"] == "precisianmedical.com"
    assert [f.name for f in od.fields] == ["url", "database", "username", "api_key"]
    assert od.supports_writes and od.supports_bank_balances
    assert erp.not_connected_message() == "Odoo is not connected. Ask the user to connect it on the Odoo page first."
    assert erp.provider_for(None).key == "odoo"


def test_no_erp_brand_defaults_to_none(no_erp_brand):
    assert erp.default_key() == "none"
    assert erp.provider_for(None).key == "none"
    assert erp.not_connected_message() == erp.NOT_CONNECTED
    none = erp.get("none")
    assert none.datasets() == [] and none.dataset_keys() == ()
    with pytest.raises(erp.ErpError):
        none.validate_write("log_note", {})


def test_odoo_errors_are_erp_errors():
    assert issubclass(odoo.OdooError, erp.ErpError)
    assert issubclass(odoo.OdooAuthError, erp.ErpAuthError)
    assert issubclass(odoo.OdooAuthError, odoo.OdooError)


def test_odoo_provider_delegates_catalogues():
    p = erp.get("odoo")
    assert p.datasets() == odoo.model_catalog()
    assert p.dataset_keys() == tuple(odoo.MODEL_CONFIG)
    assert p.write_catalog() == odoo.write_catalog()
    assert p.default_risk("register_payment") == "high"
    with pytest.raises(erp.ErpError):
        p.validate_write("confirm_quotation", {})
    assert p.describe_write("create_contact", {"name": "Bob"})[0] == "Create contact: Bob"
    assert p.field_text([3, "Acme"]) == "Acme" and p.field_text(False) == ""


def test_unknown_provider_falls_back_to_none():
    assert erp.get("sap").key == "none"
