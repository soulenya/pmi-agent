"""The v2 agents' tool catalogue. Nothing else in the suite imports it, which is
how a string that did not parse shipped in it."""

from services.agent.v2 import lc_tools


def test_the_v2_tool_catalogue_loads_and_builds_every_tool():
    assert "'Tasks'!D2:D500" in lc_tools._TOOL_DOCS["edit_drive_file"]
    assert {t.name for t in lc_tools.make_lc_tools(ctx=None)} == set(lc_tools._TOOL_DOCS)
