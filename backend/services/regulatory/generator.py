"""LLM-backed regulatory document generation.

Two entry points used by the regulatory template wizard:

- :func:`recommend_formatting` — asks the LLM (task="regulatory") to refine
  the template's default section structure and recommend an output format
  for a specific document title, returning a JSON-safe dict. Falls back to
  the template defaults on any error.
- :func:`generate_markdown` — drafts the full document content in Markdown,
  optionally auto-populating specifics from the knowledge base and company
  profile. When auto-populate is off, the draft uses explicit
  ``[FILL IN: …]`` placeholders instead of invented facts.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from repositories.document_repo import DocumentChunkRepository
from services.embeddings.service import EmbeddingService
from services.llm.router import get_llm_client
from services.regulatory.templates import RegTemplate

logger = logging.getLogger(__name__)

COMPANY_CONTEXT = (
    "Company: Precisian Medical Instruments (PMI), a medical device startup. "
    "Product: VACTOR — a hyper-compact, battery-powered suction device for "
    "emergency, military, and EMS applications."
)


async def _company_blocks(db: AsyncSession, template: RegTemplate) -> tuple[str, str]:
    """(company context, formatting rules) for prompt injection.

    Context prefers the live synced company profile (shared Drive doc) over the
    built-in fallback constant. Formatting rules come from the shared Drive
    templates folder — the best-matching company template for this document
    family plus the company style guide — so the Regulatory wizard follows the
    same formatting truth as chat-generated documents. Both are best-effort:
    failures never block generation.
    """
    ctx = COMPANY_CONTEXT
    fmt = ""
    try:
        from services.company_context import get_company_context

        live = (await get_company_context(db)).strip()
        if live:
            ctx = live
    except Exception:  # noqa: BLE001 — optional enrichment
        logger.debug("Live company context unavailable; using fallback.", exc_info=True)
    try:
        from services.file_templates import get_formatting_context

        fmt = await get_formatting_context(
            db, [template.label, template.category, "QMS"]
        )
    except Exception:  # noqa: BLE001 — optional enrichment
        logger.debug("Drive formatting context unavailable.", exc_info=True)
    return ctx, fmt


def _parse_json_block(text: str) -> dict | None:
    """Extract the first JSON object from an LLM response, tolerating code fences."""
    cleaned = re.sub(r"```(?:json)?", "", text).strip().strip("`")
    match = re.search(r"\{.*\}", cleaned, re.DOTALL)
    if not match:
        return None
    try:
        data = json.loads(match.group(0))
        return data if isinstance(data, dict) else None
    except (json.JSONDecodeError, ValueError):
        return None


async def recommend_formatting(
    db: AsyncSession,
    template: RegTemplate,
    title: str,
    notes: str | None = None,
) -> dict:
    """Return {"format", "sections", "rationale"} for a planned document."""
    fallback = {
        "format": template.recommended_format,
        "sections": list(template.default_sections),
        "rationale": (
            f"Standard structure for a {template.label} per "
            f"{', '.join(template.related_standards)}."
        ),
    }

    notes_block = f"\nAdditional context from the author: {notes}" if notes else ""
    company_ctx, fmt_rules = await _company_blocks(db, template)
    fmt_block = (
        f"\n\nCompany formatting requirements (from the shared templates folder — "
        f"respect required sections and conventions where applicable):\n{fmt_rules}"
        if fmt_rules
        else ""
    )
    prompt = (
        "You are a regulatory documentation expert for medical devices.\n\n"
        f"{company_ctx}\n\n"
        f"A user is about to create: {template.label} — \"{title}\"\n"
        f"Governing standards: {', '.join(template.related_standards)}\n"
        f"Default section structure:\n"
        + "\n".join(f"- {s}" for s in template.default_sections)
        + f"{notes_block}{fmt_block}\n\n"
        "Based on current regulatory best practice, recommend the final section "
        "structure for THIS document. Keep, reorder, rename, add, or drop "
        "sections only where genuinely warranted — the defaults are sound.\n"
        "Also recommend an output format: \"docx\" (formal Word document, best "
        "for controlled documents and submissions) or \"md\" (Markdown, "
        "editable directly in this app).\n\n"
        "Respond with ONLY a JSON object, no commentary:\n"
        '{"format": "docx", "sections": ["Section 1", "..."], '
        '"rationale": "one or two sentences explaining the recommendation"}'
    )

    try:
        client = await get_llm_client(db, task="regulatory")
        response = await client.chat(
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
        )
        data = _parse_json_block(response.content)
        if not data:
            return fallback
        fmt = str(data.get("format", "")).lower()
        sections = [str(s).strip() for s in data.get("sections", []) if str(s).strip()]
        rationale = str(data.get("rationale", "")).strip()
        if fmt not in ("docx", "md") or not sections:
            return fallback
        return {
            "format": fmt,
            "sections": sections,
            "rationale": rationale or fallback["rationale"],
        }
    except Exception as exc:  # noqa: BLE001 — recommendation must never block the wizard
        logger.warning("Formatting recommendation failed: %s", exc)
        return fallback


async def _kb_context(
    db: AsyncSession,
    embedding_svc: EmbeddingService,
    template: RegTemplate,
    title: str,
) -> str:
    """Fetch relevant knowledge-base excerpts for auto-population (best effort)."""
    try:
        query = f"{template.label} {title} {' '.join(template.related_standards)}"
        embedding = await embedding_svc.embed(query)
        chunk_repo = DocumentChunkRepository(db)
        results = await chunk_repo.vector_search(embedding, top_k=6)
        if not results:
            return ""
        excerpts = [
            f"[{i + 1}] {chunk.content[:600]}" for i, (chunk, _) in enumerate(results)
        ]
        return "\n\n".join(excerpts)
    except Exception as exc:  # noqa: BLE001 — KB context is optional
        logger.warning("KB search for template generation failed: %s", exc)
        return ""


async def generate_markdown(
    db: AsyncSession,
    embedding_svc: EmbeddingService,
    template: RegTemplate,
    title: str,
    doc_number: str | None,
    sections: list[str],
    auto_populate: bool,
    notes: str | None = None,
) -> str:
    """Draft the full document content as Markdown."""
    kb_context = ""
    if auto_populate:
        kb_context = await _kb_context(db, embedding_svc, template, title)

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    sections_block = "\n".join(f"- {s}" for s in sections)
    kb_block = (
        f"\n\nRelevant excerpts from the company knowledge base:\n{kb_context}"
        if kb_context
        else ""
    )
    notes_block = f"\nAdditional author notes: {notes}" if notes else ""

    company_ctx, fmt_rules = await _company_blocks(db, template)
    fmt_block = (
        f"\n\nCompany formatting requirements (from the shared templates folder):\n{fmt_rules}"
        if fmt_rules
        else ""
    )

    if auto_populate:
        populate_rules = (
            "Auto-populate the document with specifics about PMI and VACTOR from "
            "the company context and knowledge-base excerpts above. Where a "
            "required fact is not available (names, dates, registration numbers, "
            "test results), insert an explicit placeholder like "
            "[FILL IN: notified body number] rather than inventing it."
        )
    else:
        populate_rules = (
            "Do NOT fill in company- or product-specific facts. Produce a "
            "professional template: for each section, write brief instructional "
            "guidance plus [FILL IN: …] placeholders for every detail the "
            "author must supply."
        )

    prompt = (
        "You are a regulatory affairs specialist at Precisian Medical "
        "Instruments (PMI).\n\n"
        f"{company_ctx}\n\n"
        f"Draft a complete {template.label}.\n"
        f"Title: {title}\n"
        f"Document number: {doc_number or '[FILL IN: document number]'}\n"
        f"Revision: A (draft)\n"
        f"Date: {today}\n"
        f"Governing standards: {', '.join(template.related_standards)}\n"
        f"{notes_block}\n\n"
        f"Required section structure (use '## ' headings, in this order):\n"
        f"{sections_block}\n\n"
        f"Template guidance: {template.guidance}\n"
        f"{fmt_block}\n"
        f"{kb_block}\n\n"
        f"Population rules: {populate_rules}\n\n"
        "Formatting rules:\n"
        "- Start with a short document-control block (document number, "
        "revision, date, governing standards) as bold key/value lines.\n"
        "- Use '## ' for each required section heading and '### ' for "
        "sub-sections.\n"
        "- Use '- ' bullets and numbered lists where appropriate; use "
        "**bold** for emphasis.\n"
        "- Do not use Markdown tables; render tabular data as labelled "
        "lists instead.\n"
        "- Follow the company formatting requirements above (language "
        "conventions, numbering, headers/footers, metadata fields) wherever "
        "they do not conflict with the required section structure.\n"
        "- Output ONLY the document content — no meta-commentary."
    )

    client = await get_llm_client(db, task="regulatory")
    response = await client.chat(
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
    )
    content = response.content.strip()
    if not content:
        raise RuntimeError("The model returned an empty document.")
    return content
