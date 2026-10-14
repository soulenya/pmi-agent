"""services/design_tokens: PMI defaults are 5.18.0's values; stored tokens flow to Word and deck themes."""

from __future__ import annotations

import pytest

from services import design_system as ds
from services import design_tokens as dt
from services.decks.theme import DEFAULT_THEME


@pytest.fixture(autouse=True)
def _restore():
    before = (dt._current, dt._source)
    yield
    dt._current, dt._source = before


def _activate(data: dict):
    tokens, problems = dt._coerce(data)
    dt._current, dt._source = tokens, "setting"
    return tokens, problems


def test_defaults_match_the_shipped_design_system():
    assert dt.current() == dt.DEFAULTS
    t = ds.tokens()
    assert t is ds.TOKENS
    assert (t.font_display, t.font_mono, t.red, t.black, t.ink_500, t.hairline) == (
        "Archivo", "JetBrains Mono", "FF0000", "000000", "333333", "E0E0E0"
    )
    assert dt.deck_theme() == DEFAULT_THEME
    assert dt.DEFAULTS.app_accent == "E8000D" and dt.hex_to_hsl_css("E8000D") == "357 100% 45%"
    assert ds.resolve_doc_style(None, "CAPA-004") == ds.CONTROLLED


def test_stored_tokens_reach_word_and_decks():
    tokens, problems = _activate({
        "accent": "#0057B8", "ink": "111111", "font_display": "Inter", "font_mono": "IBM Plex Mono",
        "dark_background": "0B1F3A", "banner_style": "accent", "title_rule": False,
        "controlled_exempt": False, "footer_wording": "Acme Ltd · Internal", "deck_name": "Acme",
    })
    assert problems == []
    t = ds.tokens()
    assert t.red == "0057B8" and t.black == "111111" and t.font_display == "Inter"
    r = ds.rules()
    assert r.banner_style == "accent" and r.title_rule is False and r.footer_wording == "Acme Ltd · Internal"
    # Exemption off: a CAPA gets the brand style unless asked for by name.
    assert ds.resolve_doc_style(None, "CAPA-004") == ds.BRAND
    assert ds.resolve_doc_style("controlled", "CAPA-004") == ds.CONTROLLED
    theme = dt.deck_theme()
    assert theme.palette.accent == "0057B8" and theme.palette.background == "0B1F3A"
    assert theme.fonts.display == "Inter" and theme.name == "Acme"
    assert dt.source() == "setting"


def test_bad_values_fall_back_and_are_reported():
    tokens, problems = dt._coerce({"accent": "red", "banner_style": "stripes", "font_mono": "<script>"})
    assert tokens.accent == dt.DEFAULTS.accent and tokens.banner_style == "dark"
    assert tokens.font_mono == dt.DEFAULTS.font_mono
    assert len(problems) == 3


def test_contrast_and_fonts():
    assert dt.contrast_ratio("000000", "FFFFFF") == 21.0
    assert dt.contrast_ratio("FFFFFF", "FFFFFF") == 1.0
    families = [f["family"] for f in dt.available_fonts()]
    assert families[:2] == ["Archivo", "JetBrains Mono"]
    assert dt.font_class("Some Mono") == ("modern", "fixed")
    with pytest.raises(ValueError):
        dt.save_font("Bad/Name", "Regular", b"\x00\x01\x00\x00", "ttf")
    with pytest.raises(ValueError):
        dt.save_logo("light", b"GIF89a")
