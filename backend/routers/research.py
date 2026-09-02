"""Research API — run web searches, archive reports, and optionally ingest into KB."""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_current_user
from models.db.enums import ResearchStatus
from models.db.user import User
from models.schemas.research import ResearchReportOut, RunResearchRequest
from repositories.research_repo import ResearchRepository
from services.llm.router import get_llm_client
from services.research.searcher import web_search

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/research", tags=["research"])


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _summarise(query: str, sources: list[dict], db: AsyncSession) -> tuple[str, str]:
    """
    Call the local LLM to produce a summary paragraph and full report markdown
    from DuckDuckGo results.  Returns (summary, full_report).
    Falls back gracefully if Ollama is unavailable.
    """
    if not sources:
        return "No search results found.", ""

    snippets = "\n\n".join(
        f"**{s['title']}** ({s['domain']})\n{s['snippet']}\nURL: {s['url']}"
        for s in sources[:8]
    )

    prompt = (
        f"You are a research assistant at a medical device company (PMI).\n"
        f"The user queried: \"{query}\"\n\n"
        f"Here are the top web search results:\n\n{snippets}\n\n"
        f"Write a concise research summary (2-4 paragraphs) synthesising the key findings. "
        f"Then write a structured full report in Markdown with sections: "
        f"## Summary, ## Key Findings, ## Sources.\n"
        f"Format: first output the summary paragraph, then `---`, then the full report."
    )

    try:
        client = await get_llm_client(db, task="research")
        chunk = await client.chat(
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
        )
        text = chunk.content.strip()
        if "---" in text:
            parts = text.split("---", 1)
            return parts[0].strip(), parts[1].strip()
        return text[:500], text
    except Exception as exc:
        logger.warning("LLM summarisation failed: %s", exc)
        # Build a simple summary from snippets as fallback
        summary = f"Found {len(sources)} sources for query: {query}"
        full = f"## Summary\n{summary}\n\n## Sources\n" + "\n".join(
            f"- [{s['title']}]({s['url']})" for s in sources
        )
        return summary, full


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("", response_model=list[ResearchReportOut])
async def list_reports(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[ResearchReportOut]:
    repo = ResearchRepository(db)
    reports = await repo.list(created_by=current_user.id)
    return [ResearchReportOut.model_validate(r) for r in reports]


@router.get("/{report_id}", response_model=ResearchReportOut)
async def get_report(
    report_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ResearchReportOut:
    repo = ResearchRepository(db)
    report = await repo.get(report_id)
    if report is None or report.created_by != current_user.id:
        raise HTTPException(status_code=404, detail="Report not found.")
    return ResearchReportOut.model_validate(report)


@router.post("/run", response_model=ResearchReportOut, status_code=status.HTTP_201_CREATED)
async def run_research(
    body: RunResearchRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ResearchReportOut:
    """
    Run a web search, summarise with LLM, persist as ResearchReport.
    Optionally ingest the summary back into the knowledge base.
    """
    repo = ResearchRepository(db)

    # 1. Create report placeholder (in_progress)
    title = body.title or body.query[:100]
    report = await repo.create(
        created_by=current_user.id,
        title=title,
        query=body.query,
        status=ResearchStatus.IN_PROGRESS,
        tags=body.tags,
    )
    await db.commit()
    await db.refresh(report)

    try:
        # 2. Search the web
        results = await web_search(body.query, max_results=body.max_results)

        # 3. Save sources
        if results:
            await repo.add_sources(report.id, results)

        # 4. LLM summarisation
        summary, full_report = await _summarise(body.query, results, db)

        # 5. Update report with content
        report = await repo.update(
            report.id,
            summary=summary,
            full_report=full_report,
            status=ResearchStatus.COMPLETED,
        )
        await db.commit()

        # 6. Optionally ingest into knowledge base
        if body.ingest_to_kb and report and full_report:
            try:
                from services.documents.ingestion import DocumentIngestionService
                from services.embeddings.service import EmbeddingService

                emb_svc = EmbeddingService()
                ingest_svc = DocumentIngestionService(db, emb_svc)
                doc = await ingest_svc.ingest(
                    raw_bytes=full_report.encode(),
                    filename=f"research_{report.id}.md",
                    title=f"Research: {title}",
                    category_id=None,
                    is_regulated=False,
                    created_by_id=current_user.id,
                )
                report = await repo.update(report.id, ingested_as_document_id=doc.id)
                await db.commit()
            except Exception as exc:
                logger.warning("KB ingest failed for research report %s: %s", report.id, exc)

    except Exception as exc:
        logger.error("Research run failed: %s", exc)
        await repo.update(report.id, status=ResearchStatus.FAILED)
        await db.commit()
        raise HTTPException(status_code=500, detail=f"Research failed: {exc}") from exc

    await db.refresh(report)
    # Reload with sources eagerly to avoid MissingGreenlet on relationship access
    final_report = await repo.get(report.id)
    return ResearchReportOut.model_validate(final_report)


@router.delete("/{report_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_report(
    report_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    repo = ResearchRepository(db)
    report = await repo.get(report_id)
    if report is None or report.created_by != current_user.id:
        raise HTTPException(status_code=404, detail="Report not found.")
    await db.delete(report)
    await db.commit()
