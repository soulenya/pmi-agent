"""
Shared Python enums used by both SQLAlchemy models and Pydantic schemas.
Using (str, enum.Enum) makes values JSON-serialisable without extra conversion.
"""

import enum


class AgentType(str, enum.Enum):
    SUPERVISOR = "supervisor"
    EXECUTIVE_ASSISTANT = "executive_assistant"
    RESEARCH = "research"
    REGULATORY = "regulatory"
    QMS = "qms"
    INVESTOR_RELATIONS = "investor_relations"
    ENGINEERING = "engineering"
    OPERATIONS = "operations"


class MessageRole(str, enum.Enum):
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"
    TOOL = "tool"


class TaskStatus(str, enum.Enum):
    BACKLOG = "backlog"
    TODO = "todo"
    IN_PROGRESS = "in_progress"
    IN_REVIEW = "in_review"
    DONE = "done"
    CANCELLED = "cancelled"


class TaskPriority(str, enum.Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class ApprovalStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    EXPIRED = "expired"
    CANCELLED = "cancelled"


class IntentType(str, enum.Enum):
    SEND_EMAIL = "send_email"
    CREATE_CALENDAR_EVENT = "create_calendar_event"
    MODIFY_DOCUMENT = "modify_document"
    CREATE_REGULATORY_SUBMISSION = "create_regulatory_submission"
    SEND_MESSAGE = "send_message"
    DELETE_RECORD = "delete_record"
    EXTERNAL_API_CALL = "external_api_call"
    CREATE_TASK = "create_task"
    UPDATE_TASK = "update_task"


class DocumentSourceType(str, enum.Enum):
    UPLOAD = "upload"
    GOOGLE_DRIVE = "google_drive"
    GOOGLE_DOCS = "google_docs"
    URL = "url"
    EMAIL = "email"
    GENERATED = "generated"


class DocumentStatus(str, enum.Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"
    ARCHIVED = "archived"


class RegDocType(str, enum.Enum):
    SUBMISSION_510K = "510k"
    DESIGN_CONTROL = "design_control"
    RISK_FILE = "risk_file"
    SOP = "sop"
    WORK_INSTRUCTION = "work_instruction"
    CAPA = "capa"
    NCR = "ncr"
    AUDIT_REPORT = "audit_report"
    TEST_REPORT = "test_report"
    DHR = "dhr"
    DHF = "dhf"
    OTHER = "other"


class RegDocStatus(str, enum.Enum):
    DRAFT = "draft"
    IN_REVIEW = "in_review"
    APPROVED = "approved"
    OBSOLETE = "obsolete"
    SUPERSEDED = "superseded"


class BriefingType(str, enum.Enum):
    DAILY = "daily"
    WEEKLY = "weekly"
    CUSTOM = "custom"


class NotificationType(str, enum.Enum):
    APPROVAL_REQUIRED = "approval_required"
    TASK_DUE = "task_due"
    TASK_ASSIGNED = "task_assigned"
    BRIEFING_READY = "briefing_ready"
    DOCUMENT_INGESTED = "document_ingested"
    RESEARCH_COMPLETE = "research_complete"
    SYSTEM_ALERT = "system_alert"
    REMINDER = "reminder"


class ResearchStatus(str, enum.Enum):
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    ARCHIVED = "archived"


class RiskLevel(str, enum.Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"
