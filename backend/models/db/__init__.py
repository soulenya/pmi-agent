"""Export all ORM models so Alembic autogenerate discovers them."""

from models.db.approval import ApprovalIntent
from models.db.assistant import AssistantSuggestion
from models.db.audit import AuditEvent
from models.db.base import Base
from models.db.briefing import Briefing
from models.db.budget import Budget, BudgetFolder, BudgetReference
from models.db.conversation import AgentRun, Conversation, ConversationAttachment, Message
from models.db.device_token import DeviceToken
from models.db.document import Document, DocumentCategory, DocumentChunk
from models.db.document_extraction import DocumentExtraction
from models.db.drive_grant import DriveEditGrant
from models.db.email_draft import EmailDraft
from models.db.feedback import Feedback
from models.db.google import GoogleCredential, GoogleSyncState
from models.db.meeting import MeetingNote
from models.db.notification import Notification
from models.db.odoo import OdooConnection
from models.db.regulatory import CAPA, RegulatoryDocument, RegulatoryNode, RiskItem
from models.db.research import ResearchReport, ResearchSource
from models.db.scheduled_task import ScheduledTask
from models.db.settings import ModelRoutingRule, SystemSetting
from models.db.task import Project, Task, TaskComment
from models.db.user import User, UserSession
from models.db.workroom import Workroom, WorkroomItem, WorkroomJournalEntry

__all__ = [
    "Base",
    "User",
    "UserSession",
    "GoogleCredential",
    "GoogleSyncState",
    "DocumentCategory",
    "Document",
    "DocumentChunk",
    "Conversation",
    "AgentRun",
    "Message",
    "ConversationAttachment",
    "ApprovalIntent",
    "Project",
    "Task",
    "TaskComment",
    "ResearchReport",
    "ResearchSource",
    "RegulatoryDocument",
    "RiskItem",
    "CAPA",
    "RegulatoryNode",
    "Notification",
    "Briefing",
    "SystemSetting",
    "ModelRoutingRule",
    "AuditEvent",
    "MeetingNote",
    "EmailDraft",
    "Feedback",
    "AssistantSuggestion",
    "ScheduledTask",
    "OdooConnection",
    "DeviceToken",
    "Workroom",
    "WorkroomItem",
    "WorkroomJournalEntry",
    "Budget",
    "BudgetFolder",
    "BudgetReference",
    "DriveEditGrant",
]
