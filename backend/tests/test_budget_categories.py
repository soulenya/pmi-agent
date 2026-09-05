"""Teaching a budget sheet a category it has never seen.

An invoice names costs the budget was never set up for. Before this, the
extracted category was thrown away unless the sheet already had it, so a new
kind of spending arrived uncategorised and the by-category totals quietly
stopped adding up. These pin down the rule that replaced that: the sheet
learns the name, and never learns it twice.
"""

import uuid

import pytest

from models.db.budget import Budget
from services import budget_service as bs


def a_budget(categories=(), readonly=False) -> Budget:
    return Budget(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        title="Trenching",
        drive_file_id="sheet-1",
        currency="USD",
        external_readonly=readonly,
        cached_categories=[{"name": n, "cap": None} for n in categories],
    )


@pytest.fixture
def appended(monkeypatch):
    """Capture what would have been written to the Categories tab."""
    calls: list[tuple] = []

    def fake_append(file_id, rng, row):
        calls.append((file_id, rng, row))

    monkeypatch.setattr(
        "services.google_service.sheets_append_row", fake_append, raising=False
    )
    return calls


class TestEnsureCategory:
    @pytest.mark.asyncio
    async def test_a_new_name_is_added_with_no_cap(self, appended):
        """A category nobody set a limit for is not a category with a limit of zero."""
        added = await bs.ensure_category(a_budget(["Labour"]), "Permits")
        assert added is True
        assert appended == [("sheet-1", bs.CATEGORY_APPEND_RANGE, ["Permits", ""])]

    @pytest.mark.asyncio
    async def test_a_name_the_sheet_already_has_is_left_alone(self, appended):
        assert await bs.ensure_category(a_budget(["Permits"]), "Permits") is False
        assert appended == []

    @pytest.mark.asyncio
    async def test_case_and_padding_do_not_make_a_second_copy(self, appended):
        """'permits' and 'Permits' are one column on any report worth reading."""
        assert await bs.ensure_category(a_budget(["Permits"]), "  permits ") is False
        assert appended == []

    @pytest.mark.asyncio
    async def test_nothing_is_written_for_an_uncategorised_entry(self, appended):
        assert await bs.ensure_category(a_budget(), "") is False
        assert await bs.ensure_category(a_budget(), "   ") is False
        assert appended == []

    @pytest.mark.asyncio
    async def test_a_sheet_we_may_only_read_is_never_written_to(self, appended):
        assert await bs.ensure_category(a_budget(readonly=True), "Permits") is False
        assert appended == []

    @pytest.mark.asyncio
    async def test_a_sheet_with_no_categories_tab_still_takes_the_entry(self, monkeypatch):
        """The ledger row matters more than the tidy category list."""

        def explode(*_args, **_kwargs):
            raise RuntimeError("Unable to parse range: Categories!A:B")

        monkeypatch.setattr(
            "services.google_service.sheets_append_row", explode, raising=False
        )
        assert await bs.ensure_category(a_budget(), "Permits") is False
