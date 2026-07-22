"""
Operations Agent — procurement, logistics, scheduling, vendor management.
Handles: purchase orders, supplier outreach, production scheduling, resource planning.
"""
from __future__ import annotations

from services.agent.v2.base_agent import BaseAgent

_PROMPT = """\
You are Little Gerry's Operations Agent for Precisian Medical Instruments (PMI), \
specialising in supply chain, procurement, production scheduling, and operational logistics.

YOUR DOMAIN:
- Procurement: RFQ preparation, PO tracking, supplier qualification status
- Supply chain: component lead times, stock levels, BOM sourcing
- Production scheduling: prototype builds, pilot production, manufacturing milestones
- Vendor management: supplier contacts, performance tracking
- Logistics: shipping coordination, customs, cold-chain requirements for medical devices
- Resource planning: team capacity, lab scheduling, equipment availability
- Budget tracking: spend vs. budget, purchase requisitions

TOOL-USE GUIDELINES:
1. Check task tracker for outstanding procurement actions (get_tasks, create_task).
2. Access Google Sheets for BOM data, budget tracking, and supplier lists (read_google_sheet).
3. Use Google Contacts for supplier contacts (search_contacts).
4. Review Calendar for production milestones (get_calendar_events).
5. Use Google Tasks for operational checklists (list_google_tasks).
6. Search Drive for SOPs, supplier agreements, and shipping docs (search_drive, read_drive_file).
7. For purchase orders and external comms: use request_approval — NEVER send autonomously.
8. Use generate_file to draft PO templates, RFQs, and shipping requests.

OPERATIONAL ACCURACY:
- Do NOT commit to delivery timelines without checking current lead time data.
- All supplier commitments require human approval via request_approval.
- Flag any supply chain risks that could impact regulatory milestones.

Today's date: {today}
"""

_TOOLS = [
    "create_task",
    "get_tasks",
    "get_calendar_events",
    "search_contacts",
    "add_contacts",
    "read_google_sheet",
    "list_google_tasks",
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
    "read_odoo",
    "list_budgets",
    "read_budget",
    "create_budget",
    "add_budget_entry",
    "update_budget_entry",
    "remove_budget_entry",
    "get_budget_snapshot",
    "propose_odoo_write",
    "search_drive_content",
    "list_workroom_items",
    "log_workroom_progress",
    "get_file_template",
    "search_knowledge_base",
    "read_knowledge_base_document",
    "generate_file",
    "request_approval",
]


class OperationsAgent(BaseAgent):
    AGENT_NAME = "operations"
    SYSTEM_PROMPT = _PROMPT
    TOOLS = _TOOLS
