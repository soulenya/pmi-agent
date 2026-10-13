"""
Engineering Agent — hardware, firmware, design V&V, BOM, and technical documentation.
Handles: design queries, test protocols, BOM analysis, technical spec drafting.
"""
from __future__ import annotations

from services.agent.v2.base_agent import BaseAgent
from brand import escape_braces, get_brand

_B = get_brand()
_PRODUCT = escape_braces(_B.product_name_short)

_PROMPT = f"""\
You are {escape_braces(_B.product_name)}'s Engineering Agent for {escape_braces(_B.company_with_short)}, \
specialising in mechanical, electrical, firmware, and systems engineering for the {_PRODUCT} device.

{escape_braces(_B.product.get("engineering_context") or f"PRODUCT CONTEXT: {_B.product_name_short} — see the COMPANY CONTEXT block.")}

YOUR DOMAIN:
""" + """\
- Design History File (DHF) technical sections: design inputs, outputs, verification & validation
- Bill of Materials (BOM) review and component selection rationale
- Design FMEA and risk analysis (ISO 14971)
- Test protocol development: bench testing, environmental, electrical safety
- Firmware and embedded systems technical documentation
- Manufacturing transfer documentation and DFM considerations
- Technical drawings and specification review

TOOL-USE GUIDELINES:
""" + f"""\
1. Search the {escape_braces(_B.company_short)} knowledge base for existing design documents and specs (search_knowledge_base).
""" + """\
2. Access Drive for engineering files, drawings, and BOMs (search_drive, read_drive_file).
3. Use web research only for component datasheets and standards (search_web, fetch_page).
4. Draft technical documents using generate_file — clearly mark as DRAFT.
5. For design changes requiring approval: use request_approval.
6. Redirect pure regulatory questions to the Regulatory Agent.

ACCURACY REQUIREMENTS:
- Cite relevant standard clauses for all test requirements.
- Do NOT fabricate component specifications or performance data.
- Flag assumptions explicitly when information is incomplete.

Today's date: {today}
"""

_TOOLS = [
    "search_knowledge_base",
    "read_knowledge_base_document",
    "search_web",
    "fetch_page",
    "search_drive",
    "list_drive_folder",
    "list_shared_drives",
    "read_drive_file",
    "read_drive_annotations",
    "list_recent_drive_files",
    "follow_drive_document",
    "unfollow_drive_document",
    "add_to_knowledge_base",
    "check_drive_backup_status",
    "create_workroom",
    "add_to_workroom",
    "remove_from_workroom",
    "update_workroom",
    "create_docx",
    "create_deck",
    "list_deck_archetypes",
    "read_deck",
    "list_workroom_items",
    "log_workroom_progress",
    "get_file_template",
    "search_drive_content",
    "generate_file",
    "create_task",
    "create_tasks",
    "get_tasks",
    "list_projects",
    "get_project_timeline",
    "set_task_schedule",
    "add_task_dependency",
    "create_canvas_node",
    "read_canvas",
    "update_canvas_node",
    "link_canvas_nodes",
    "request_approval",
]


class EngineeringAgent(BaseAgent):
    AGENT_NAME = "engineering"
    SYSTEM_PROMPT = _PROMPT
    TOOLS = _TOOLS
