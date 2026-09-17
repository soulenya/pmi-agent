"""Budget estimates: the arithmetic of a cost plan.

The Estimate tab is typed by hand as often as by the app, so these pin down
what a line is worth when its cells disagree, and what the loaded total is
when the rates are on. The failure that matters is a proposal priced wrong
because a percentage was read as a fraction or a pool was applied to the
wrong base.
"""

from services import budget_estimate_service as est


def line(kind="Labor", amount=None, qty=None, unit_cost=None, phase="", row=2):
    return {
        "row": row, "phase": phase, "kind": kind, "description": "x",
        "qty": qty, "unit_cost": unit_cost, "amount": amount, "note": "",
    }


class TestParseLines:
    def test_qty_times_unit_wins_over_typed_amount(self):
        rows = [["", "Labor", "Eng", "100", "95", "1"]]
        assert est.parse_lines(rows)[0]["amount"] == 9500.0

    def test_typed_amount_stands_when_a_factor_is_missing(self):
        rows = [["", "Materials", "Steel", "", "", "$1,250.50"]]
        assert est.parse_lines(rows)[0]["amount"] == 1250.5

    def test_blank_rows_are_skipped_and_row_numbers_kept(self):
        rows = [["", "", "", "", "", ""], ["Base", "Travel", "Trip", "", "", "300"]]
        parsed = est.parse_lines(rows)
        assert len(parsed) == 1
        assert parsed[0]["row"] == 3

    def test_unknown_kind_reads_as_other(self):
        assert est.parse_lines([["", "Widgets", "x", "", "", "1"]])[0]["kind"] == "Other"
        assert est.parse_lines([["", "labour", "x", "", "", "1"]])[0]["kind"] == "Labor"


class TestRates:
    def test_percent_accepts_30_or_30pct_or_0_30(self):
        for raw in ("30", "30%", "0.30", 30):
            assert est._pct(raw) == 30.0

    def test_blank_rate_is_zero(self):
        assert est._pct("") == 0.0
        assert est._pct("abc") == 0.0

    def test_mode_defaults_to_simple(self):
        assert est.parse_rates({})["mode"] == est.MODE_SIMPLE
        assert est.parse_rates({"Estimate Mode": "cost build-up"})["mode"] == est.MODE_COST


class TestSummarize:
    def test_simple_is_the_sum(self):
        s = est.summarize([line(amount=100), line("Travel", amount=50)], est.parse_rates({}))
        assert s["total"] == 150.0
        assert s["fee"] == 0.0
        assert s["by_kind"] == {"Labor": 100.0, "Travel": 50.0}

    def test_cost_build_up_order(self):
        """Fringe on labor; overhead on labor+fringe; G&A on everything; fee on cost."""
        rates = est.parse_rates({
            "Estimate Mode": "Cost build-up", "Fringe %": "30", "Overhead %": "50",
            "G&A %": "10", "Fee %": "8",
        })
        s = est.summarize([line(amount=1000), line("Materials", amount=200)], rates)
        assert s["labor"] == 1000.0
        assert s["fringe"] == 300.0
        assert s["overhead"] == 650.0          # (1000 + 300) × 50%
        assert s["odc"] == 200.0
        assert s["ga"] == 215.0                # (1000 + 300 + 650 + 200) × 10%
        assert s["cost"] == 2365.0
        assert s["fee"] == 189.2               # 2365 × 8%
        assert s["total"] == 2554.2

    def test_by_phase_uses_the_same_build_up(self):
        rates = est.parse_rates({"Estimate Mode": "Cost build-up", "Fee %": "10"})
        s = est.summarize(
            [line(amount=100, phase="Base"), line(amount=200, phase="Option 1"), line("Other", amount=50)],
            rates,
        )
        assert s["by_phase"] == {"Base": 110.0, "Option 1": 220.0, "(no phase)": 55.0}
        assert s["total"] == 385.0

    def test_unpriced_lines_do_not_count(self):
        s = est.summarize([line(amount=None), line(amount=10)], est.parse_rates({}))
        assert s["total"] == 10.0
        assert s["line_count"] == 2


class TestCommitMark:
    def test_committed_on_reads_the_date_from_a_note(self):
        class B:
            cached_ledger = [{"note": "estimate-commit:2026-09-18 — 100 × 95"}]

        assert est.committed_on(B()) == "2026-09-18"

    def test_no_mark_means_not_committed(self):
        class B:
            cached_ledger = [{"note": "budget-ref:abc"}]

        assert est.committed_on(B()) is None
