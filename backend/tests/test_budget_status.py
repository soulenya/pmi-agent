"""Budget statuses: the arithmetic behind allocated and expected money.

The ledger lives in a Google Sheet, so column G is typed by hand as often as
it is written by the app. These tests pin down what happens to the totals when
it is blank, misspelt or unfamiliar — the failure that matters is money quietly
vanishing from a total because a word was not recognised.
"""

from services import budget_service as bs


def entry(amount, status="", category="", **extra):
    row = {
        "row": 2,
        "date": "2025-01-01",
        "description": "x",
        "category": category,
        "amount": amount,
        "source": "test",
        "note": "",
        "status": bs.normalize_status(status),
    }
    row.update(extra)
    return row


class TestNormalizeStatus:
    def test_blank_is_spent(self):
        """Every row written before column G existed must keep its meaning."""
        assert bs.normalize_status("") == bs.STATUS_SPENT
        assert bs.normalize_status(None) == bs.STATUS_SPENT
        assert bs.normalize_status("   ") == bs.STATUS_SPENT

    def test_unknown_word_falls_back_to_spent(self):
        """A typo must never quietly take money out of the spent total."""
        assert bs.normalize_status("splurged") == bs.STATUS_SPENT
        assert bs.normalize_status("???") == bs.STATUS_SPENT

    def test_the_four_words_round_trip(self):
        for word in bs.ENTRY_STATUSES:
            assert bs.normalize_status(word) == word

    def test_case_and_whitespace_are_forgiven(self):
        assert bs.normalize_status("  ALLOCATED ") == bs.STATUS_ALLOCATED

    def test_synonyms(self):
        assert bs.normalize_status("committed") == bs.STATUS_ALLOCATED
        assert bs.normalize_status("reserved") == bs.STATUS_ALLOCATED
        assert bs.normalize_status("paid") == bs.STATUS_SPENT
        assert bs.normalize_status("received") == bs.STATUS_COLLECTED
        assert bs.normalize_status("invoiced") == bs.STATUS_EXPECTED
        assert bs.normalize_status("forecast") == bs.STATUS_EXPECTED


class TestSummarizeEntries:
    def test_each_status_lands_in_its_own_total(self):
        s = bs.summarize_entries(
            [
                entry(100, "Spent"),
                entry(50, "Allocated"),
                entry(700, "Collected"),
                entry(300, "Expected"),
            ],
            1000,
        )
        assert s["total_spent"] == 100
        assert s["total_allocated"] == 50
        assert s["total_collected"] == 700
        assert s["total_expected"] == 300
        assert s["entry_count"] == 4

    def test_remaining_is_allotment_less_spent_and_allocated(self):
        s = bs.summarize_entries([entry(100, "Spent"), entry(50, "Allocated")], 1000)
        assert s["committed"] == 150
        assert s["remaining"] == 850

    def test_incoming_money_does_not_inflate_remaining(self):
        """Collecting an invoice is not the same as being handed more budget."""
        s = bs.summarize_entries(
            [entry(100, "Spent"), entry(5000, "Collected")], 1000
        )
        assert s["remaining"] == 900

    def test_remaining_is_none_without_an_allotment(self):
        s = bs.summarize_entries([entry(100, "Spent")], None)
        assert s["remaining"] is None
        assert s["allotment"] is None

    def test_remaining_goes_negative_when_overcommitted(self):
        s = bs.summarize_entries([entry(600, "Spent"), entry(600, "Allocated")], 1000)
        assert s["remaining"] == -200

    def test_blank_status_counts_as_spent(self):
        s = bs.summarize_entries([entry(40), entry(60, "spent")], 100)
        assert s["total_spent"] == 100
        assert s["remaining"] == 0

    def test_categories_cover_outgoing_money_only(self):
        """Category caps are about money leaving, so income must stay out."""
        s = bs.summarize_entries(
            [
                entry(100, "Spent", category="Travel"),
                entry(50, "Allocated", category="Travel"),
                entry(900, "Collected", category="Travel"),
                entry(200, "Expected", category="Travel"),
            ],
            None,
        )
        assert s["by_category"] == {"Travel": 150}

    def test_uncategorized_rows_are_grouped(self):
        s = bs.summarize_entries([entry(25, "Spent"), entry(25, "Spent")], None)
        assert s["by_category"] == {"(uncategorized)": 50}

    def test_all_four_statuses_are_always_reported(self):
        """The UI reads these keys straight out, so none may be missing."""
        s = bs.summarize_entries([], 0)
        assert set(s["by_status"]) == set(bs.ENTRY_STATUSES)
        assert all(v == 0 for v in s["by_status"].values())

    def test_unparsed_amounts_are_skipped_not_counted_as_zero_entries(self):
        s = bs.summarize_entries([entry(None, "Spent"), entry(10, "Spent")], None)
        assert s["total_spent"] == 10
        assert s["entry_count"] == 2


class TestReferenceRows:
    def test_a_legacy_marker_is_read_as_the_spent_row(self):
        """References written before column G existed carried the total spent."""
        ref_id = "11111111-1111-1111-1111-111111111111"
        note = f"budget-ref:{ref_id} (auto-synced total — edit in the source budget)"
        assert bs._ref_row_kind(note, ref_id) == "spent"

    def test_the_two_kinds_are_told_apart(self):
        ref_id = "22222222-2222-2222-2222-222222222222"
        assert bs._ref_row_kind(bs._ref_note(ref_id, "spent"), ref_id) == "spent"
        assert bs._ref_row_kind(bs._ref_note(ref_id, "allocated"), ref_id) == "allocated"

    def test_another_budgets_row_is_not_claimed(self):
        mine = "33333333-3333-3333-3333-333333333333"
        theirs = "44444444-4444-4444-4444-444444444444"
        assert bs._ref_row_kind(bs._ref_note(theirs, "spent"), mine) is None

    def test_an_ordinary_row_is_not_a_reference(self):
        ref_id = "55555555-5555-5555-5555-555555555555"
        assert bs._ref_row_kind("Coffee for the team", ref_id) is None
        assert bs._ref_row_kind("", ref_id) is None


class TestLedgerShape:
    def test_the_status_column_is_last(self):
        """add_entry and update_entry both index by this order."""
        assert bs.LEDGER_COLUMNS[-1] == "status"
        assert bs.LEDGER_WIDTH == len(bs.LEDGER_COLUMNS)

    def test_the_read_ranges_are_as_wide_as_the_columns(self):
        assert bs.LEDGER_RANGE.endswith("G2000")
        assert bs.LEDGER_APPEND_RANGE.endswith("A:G")

    def test_outgoing_and_planned_statuses_are_known_statuses(self):
        assert set(bs.OUTGOING_STATUSES) <= set(bs.ENTRY_STATUSES)
        assert set(bs.PLANNED_STATUSES) <= set(bs.ENTRY_STATUSES)
