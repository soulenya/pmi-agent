"""brand.py: defaults are PMI, a brand file overrides, prose helpers behave."""

import json

import pytest

import brand as brand_mod


def _load(tmp_path, monkeypatch, data: dict) -> brand_mod.Brand:
    path = tmp_path / "brand.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    monkeypatch.setenv("BRAND_FILE", str(path))
    brand_mod.get_brand.cache_clear()
    try:
        return brand_mod.get_brand()
    finally:
        brand_mod.get_brand.cache_clear()


def test_defaults_are_pmi(monkeypatch, tmp_path):
    monkeypatch.setenv("BRAND_FILE", str(tmp_path / "missing.json"))
    brand_mod.get_brand.cache_clear()
    b = brand_mod.get_brand()
    brand_mod.get_brand.cache_clear()
    assert b.source == "defaults"
    assert b.company_short == "PMI" and b.product_name == "Little Gerry"
    assert b.domains == ["pmi-llc.com", "precisianmedical.com"]
    assert b.db["app_role"] == "pmi_app" and b.db["name"] == "pmi_dev"
    assert b.feature("regulatory") and b.feature("drive_restrictions")
    assert "regulatory" in b.agents and "qms" in b.agents
    assert b.identity_line.startswith(
        "Little Gerry, the AI Executive Assistant for Precisian Medical Instruments (PMI), "
        "a medical device startup building VACTOR — a compact"
    )
    assert b.sign_in_hint == "a @pmi-llc.com or @precisianmedical.com account"


def test_brand_file_overrides_and_merges(tmp_path, monkeypatch):
    b = _load(tmp_path, monkeypatch, {
        "company_name": "Noctu", "company_short": "Noctu", "domains": ["Noctu.co"],
        "product": {"name": "Flex", "one_liner": "a load-carriage system"},
        "db": {"app_role": "lg_app"},
        "features": {"regulatory": False, "qms_agent": False},
    })
    assert b.company_name == "Noctu"
    assert b.company_with_short == "Noctu"                     # no "(Noctu)" when equal
    assert b.domains == ["noctu.co"]                           # normalised
    assert b.db["app_role"] == "lg_app" and b.db["name"] == "pmi_dev"  # deep merge keeps the rest
    assert b.product_name == "Little Gerry"                    # product name is not a company value
    assert not b.feature("regulatory")
    assert "regulatory" not in b.agents and "qms" not in b.agents and "ir" in b.agents
    assert b.identity_line == (
        "Little Gerry, the AI Executive Assistant for Noctu, a medical device startup "
        "building Flex — a load-carriage system"
    )
    assert b.sign_in_hint == "a @noctu.co account"


def test_product_less_company(tmp_path, monkeypatch):
    b = _load(tmp_path, monkeypatch, {"company_name": "Acme", "company_short": "Acme",
                                      "company_descriptor": "", "product": {}})
    assert b.identity_line == "Little Gerry, the AI Executive Assistant for Acme"
    assert b.product_name_short == "Acme"


def test_escape_braces():
    assert brand_mod.escape_braces("a {b} c") == "a {{b}} c"


def test_invalid_brand_file_is_an_error(tmp_path, monkeypatch):
    path = tmp_path / "brand.json"
    path.write_text("[]", encoding="utf-8")
    monkeypatch.setenv("BRAND_FILE", str(path))
    brand_mod.get_brand.cache_clear()
    with pytest.raises(ValueError):
        brand_mod.get_brand()
    brand_mod.get_brand.cache_clear()
