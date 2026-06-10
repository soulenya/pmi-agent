"""
Research service — web search via DuckDuckGo + page content fetching.

No API key required. Uses duckduckgo-search (DDGS) for search results
and httpx for fetching page text.
"""

from __future__ import annotations

import logging
import re
from html.parser import HTMLParser

import httpx

logger = logging.getLogger(__name__)

MAX_PAGE_CHARS = 5_000  # max chars extracted from a fetched page


# ── HTML stripping ─────────────────────────────────────────────────────────────

class _TextExtractor(HTMLParser):
    """Minimal HTML→text extractor using stdlib only."""

    _SKIP_TAGS = {"script", "style", "noscript", "head", "meta", "link"}

    def __init__(self) -> None:
        super().__init__()
        self._skip_depth = 0
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list) -> None:
        if tag.lower() in self._SKIP_TAGS:
            self._skip_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in self._SKIP_TAGS and self._skip_depth > 0:
            self._skip_depth -= 1

    def handle_data(self, data: str) -> None:
        if self._skip_depth == 0:
            stripped = data.strip()
            if stripped:
                self.parts.append(stripped)


def _strip_html(raw: str) -> str:
    extractor = _TextExtractor()
    try:
        extractor.feed(raw)
    except Exception:
        pass
    text = " ".join(extractor.parts)
    return re.sub(r"\s{2,}", " ", text).strip()


def _extract_domain(url: str) -> str:
    """Extract domain from a URL string without urllib overhead."""
    try:
        # Remove protocol
        s = url.split("://", 1)[-1]
        # Remove path
        domain = s.split("/", 1)[0]
        # Remove www.
        if domain.startswith("www."):
            domain = domain[4:]
        return domain
    except Exception:
        return ""


# ── Web search ─────────────────────────────────────────────────────────────────

async def web_search(query: str, max_results: int = 8) -> list[dict]:
    """
    Run a DuckDuckGo text search and return results.

    Returns a list of dicts with keys: title, url, snippet, domain.
    Falls back to empty list on any error so callers are never blocked.
    """
    try:
        try:
            from ddgs import DDGS  # type: ignore[import]  # package renamed to "ddgs"
        except ImportError:
            from duckduckgo_search import DDGS  # type: ignore[import]  # legacy name

        with DDGS() as ddgs:
            raw = list(ddgs.text(query, max_results=max_results))

        results = []
        for r in raw:
            url = r.get("href", "")
            results.append(
                {
                    "title": r.get("title", ""),
                    "url": url,
                    "snippet": r.get("body", ""),
                    "domain": _extract_domain(url),
                }
            )
        return results
    except Exception as exc:
        logger.warning("DuckDuckGo search failed: %s", exc)
        return []


# ── Page fetching ──────────────────────────────────────────────────────────────

async def fetch_page_text(url: str, max_chars: int = MAX_PAGE_CHARS) -> str:
    """
    Fetch a URL and return extracted plain text (truncated to max_chars).
    Returns empty string on any network / parse error.
    """
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(connect=5.0, read=15.0, write=5.0, pool=5.0),
            follow_redirects=True,
        ) as client:
            resp = await client.get(
                url,
                headers={"User-Agent": "PMIAgent/1.0 (research bot; non-commercial)"},
            )
            resp.raise_for_status()
            content_type = resp.headers.get("content-type", "")
            if "html" in content_type:
                text = _strip_html(resp.text)
            else:
                text = resp.text[:max_chars]
        return text[:max_chars]
    except Exception as exc:
        logger.warning("Page fetch failed for %s: %s", url, exc)
        return ""
