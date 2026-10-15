"""PDF text extraction keeps table rows together; chunking keeps line structure."""

import fitz
import pytest

from services.documents.ingestion import (
    _chunk_text,
    _extract_text_pdf,
    _normalize_whitespace,
    _pdf_page_rows,
    _pdf_rows_look_like_prose_columns,
)


def _statement_pdf() -> bytes:
    doc = fitz.open()
    page = doc.new_page()
    y = 80.0
    page.insert_text((40, y), "Date", fontsize=9)
    page.insert_text((120, y), "Description of Transaction", fontsize=9)
    page.insert_text((480, y), "Amount", fontsize=9)
    for date, desc, amount in [
        ("Aug 5", "Electronic Withdrawal To GOOGLE", "45.04-"),
        ("Aug 24", "Business Bill Pay ESS TO Ovyl LLC", "2,009.50-"),
        ("Aug 25", "Business Bill Pay ESS TO Hatch PD", "13,635.00-"),
    ]:
        y += 14
        page.insert_text((40, y), date, fontsize=9)
        page.insert_text((120, y), desc, fontsize=9)
        page.insert_text((480, y), amount, fontsize=9)
    return doc.tobytes()


def _two_column_pdf() -> bytes:
    doc = fitz.open()
    page = doc.new_page()
    left = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor. " * 12
    right = "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore. " * 12
    page.insert_textbox(fitz.Rect(40, 60, 290, 780), left, fontsize=9)
    page.insert_textbox(fitz.Rect(305, 60, 555, 780), right, fontsize=9)
    return doc.tobytes()


def test_statement_rows_stay_on_one_line():
    text = _extract_text_pdf(_statement_pdf())
    lines = [ln for ln in text.splitlines() if ln.strip()]
    assert any("Aug 24" in ln and "Ovyl" in ln and "2,009.50-" in ln for ln in lines)
    # Columns are separated by the wide-gap marker, not a single space.
    row = next(ln for ln in lines if "13,635.00-" in ln)
    assert "Hatch PD   13,635.00-" in row


def test_two_column_prose_reads_column_by_column():
    raw = _two_column_pdf()
    doc = fitz.open(stream=raw, filetype="pdf")
    page = doc[0]
    assert _pdf_rows_look_like_prose_columns(_pdf_page_rows(page.get_text("words")), page.rect.width)
    text = _extract_text_pdf(raw)
    first_duis = text.find("Duis aute")
    assert first_duis > 0
    # Everything before the right column starts belongs to the left column.
    assert "Duis" not in text[:first_duis] and "Lorem" in text[:first_duis]
    assert text.count("Lorem") == 12


def test_statement_page_is_not_mistaken_for_prose_columns():
    doc = fitz.open(stream=_statement_pdf(), filetype="pdf")
    page = doc[0]
    assert not _pdf_rows_look_like_prose_columns(_pdf_page_rows(page.get_text("words")), page.rect.width)


def test_normalize_whitespace_keeps_column_gaps():
    text = "Label   $   1.00   \n\n\n\nNext   2.00\n"
    assert _normalize_whitespace(text) == "Label   $   1.00\n\nNext   2.00"


def test_chunks_keep_newlines_and_column_gaps():
    text = "Aug 5   Google   45.04-\nAug 6   Google   12.66-"
    chunks = _chunk_text(text)
    assert chunks == [text]


def test_chunk_overlap_in_words_is_unchanged():
    words = [f"w{i}" for i in range(1500)]
    chunks = _chunk_text(" ".join(words))
    per_chunk, overlap = int(512 / 0.75), int(64 / 0.75)
    assert len(chunks[0].split()) == per_chunk
    assert chunks[1].split()[:overlap] == chunks[0].split()[-overlap:]
    assert chunks[-1].split()[-1] == "w1499"


@pytest.mark.parametrize("text", ["", "   ", "\n\n"])
def test_chunk_empty(text):
    assert _chunk_text(text) == []
