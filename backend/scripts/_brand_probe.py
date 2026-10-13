"""Phase-1 brand probe.

Mode "dump": import the backend and write the texts PMI users actually receive
(system prompts, tool schemas, guardrails, roster, key settings) to a JSON file.
Run once on HEAD (worktree) and once on the working tree, then compare.

Mode "noctu": same dump under a throwaway brand (BRAND_FILE), plus assertions
that nothing PMI-specific leaks and the gated features are gone.
"""
import json
import os
import sys
from pathlib import Path

mode, out = sys.argv[1], Path(sys.argv[2])
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("JWT_SECRET", "probe")
os.environ.setdefault("FERNET_KEY", "x" * 43 + "=")

from config import settings  # noqa: E402
from services.agent import executor, guardrails, tools  # noqa: E402
from services.agent.v2 import (  # noqa: E402
    engineering_agent, executive_assistant, house_manager, ir_agent, lc_tools,
    operations_agent, qms_agent, regulatory_agent, research_agent, supervisor,
)
from routers import agents as agents_router, briefings  # noqa: E402
from services.projects import access  # noqa: E402
from services.regulatory import generator  # noqa: E402

dump = {
    "settings": {
        k: getattr(settings, k) for k in (
            "app_name", "admin_email", "company_domains", "company_short_name", "hub_url",
            "installer_download_url", "feedback_recipient_email", "vapid_subject", "storage_root",
            "company_context_drive_file_id", "file_templates_drive_folder_id",
            "workrooms_share_folder_id", "hub_client_drive_file_id", "gcp_stt_bucket",
            "database_url", "database_url_sync",
        )
    },
    "allowed_domains": sorted(access.ALLOWED_DOMAINS),
    "executor_prompt": executor.SYSTEM_PROMPT.format(today="DATE"),
    "guardrails": {
        n: getattr(guardrails, n) for n in (
            "HONESTY_CONTRACT", "RESTRICTED_SOURCES_NOTE", "EDIT_GRANT_NOTE",
            "EMAIL_FACT_CHECK_NOTE", "PERIOD_REPORT_NOTE", "WRITING_STYLE_NOTE",
        )
    },
    "v2_prompts": {
        m.__name__.rsplit(".", 1)[-1]: m._PROMPT.format(today="DATE") for m in (
            engineering_agent, executive_assistant, house_manager, ir_agent,
            operations_agent, qms_agent, regulatory_agent, research_agent,
        )
    },
    "supervisor_prompt": supervisor._SUPERVISOR_PROMPT,
    "supervisor_agents": dict(supervisor._AGENT_DESCRIPTIONS),
    "house_delegatable": sorted(house_manager._DELEGATABLE),
    "roster": sorted(agents_router._v2_agent_classes().keys()),
    "roster_descriptions": agents_router._DESCRIPTIONS,
    "briefing_system": briefings._BRIEFING_SYSTEM,
    "regulatory_company_context": generator.COMPANY_CONTEXT,
    "tool_definitions": tools.TOOL_DEFINITIONS,
    "tool_executors": sorted(tools.TOOL_EXECUTORS.keys()),
    "primary_arg": tools._PRIMARY_ARG,
    "lc_tool_docs": lc_tools._TOOL_DOCS,
}
out.write_text(json.dumps(dump, indent=1, sort_keys=True, ensure_ascii=False), encoding="utf-8")
print(f"wrote {out} ({out.stat().st_size} bytes); tools={len(dump['tool_definitions'])} agents={dump['roster']}")

if mode == "noctu":
    # The dev-only default DB password is parameterised with compose/init_db in Phase 5.
    blob = json.dumps(dump, ensure_ascii=False).replace("pmi_dev_password", "")
    for word in ("Precisian", "PMI", "VACTOR", "pmi-llc", "precisianmedical", "morganjkeane", "soulenya", "pmi_app", "pmi_dev"):
        hits = [line for line in blob.split("\\n") if word in line]
        assert not hits, f"{word!r} leaked: {hits[:3]}"
    names = {t["function"]["name"] for t in dump["tool_definitions"]}
    assert "get_regulatory_status" not in names and "get_regulatory_status" not in dump["tool_executors"]
    assert "get_regulatory_status" not in dump["lc_tool_docs"]
    assert "regulatory" not in dump["roster"] and "qms" not in dump["roster"]
    assert "regulatory" not in dump["supervisor_agents"] and "qms" not in dump["supervisor_agents"]
    assert "regulatory" not in dump["house_delegatable"]
    assert dump["guardrails"]["RESTRICTED_SOURCES_NOTE"] == "" and dump["guardrails"]["EDIT_GRANT_NOTE"] == ""
    assert "confirm_restricted" not in blob, "confirm_restricted survived"
    assert dump["settings"]["database_url"].startswith("postgresql+asyncpg://lg_app:"), dump["settings"]["database_url"]
    assert dump["allowed_domains"] == ["noctu.co"], dump["allowed_domains"]
    assert "Noctu" in dump["executor_prompt"] and "Little Gerry" in dump["executor_prompt"]
    from fastapi.testclient import TestClient
    import main
    client = TestClient(main.app)
    assert client.get("/regulatory-templates").status_code == 404, "regulatory routes still mounted"
    assert client.get("/health/live").status_code == 200
    print("noctu assertions OK; executor prompt opens:", dump["executor_prompt"].splitlines()[0][:160])
