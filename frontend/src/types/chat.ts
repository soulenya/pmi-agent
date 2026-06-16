// ── Conversations ─────────────────────────────────────────────────────────────

export interface Conversation {
  id: string;
  user_id: string;
  title: string | null;
  agent_type: string | null;
  is_pinned: boolean;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface ConversationCreate {
  title?: string;
  agent_type?: string;
}

export interface ConversationUpdate {
  title?: string;
  is_pinned?: boolean;
  is_archived?: boolean;
}

// ── WebSocket frames ──────────────────────────────────────────────────────────

export interface WSToolStatusFrame {
  type: "tool_status";
  tool_name: string;
  status: "running" | "done";
  label: string;
  conversation_id: string;
}

// ── Messages ──────────────────────────────────────────────────────────────────

export type MessageRole = "user" | "assistant" | "system" | "tool";

export interface Message {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  agent_type: string | null;
  model_name: string | null;
  cited_chunk_ids: string[];
  tool_calls: unknown[] | null;
  tool_results: unknown[] | null;
  created_at: string;
}

export interface SendMessageRequest {
  content: string;
  conversation_id?: string;
}

// ── Conversation attachments (reference files) ────────────────────────────────

export interface ChatAttachment {
  id: string;
  conversation_id: string;
  file_name: string;
  mime_type: string | null;
  file_size_bytes: number | null;
  char_count: number;
  created_at: string;
}

// ── Approvals ─────────────────────────────────────────────────────────────────

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";
export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface ApprovalIntent {
  id: string;
  user_id: string;
  intent_type: string;
  intent_title: string;
  intent_description: string | null;
  intent_payload: Record<string, unknown>;
  risk_level: RiskLevel;
  status: ApprovalStatus;
  expires_at: string | null;
  resolved_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  execution_result?: Record<string, unknown> | null;
}

export interface ResolveApprovalRequest {
  approved: boolean;
  rejection_reason?: string;
}

// ── Notifications ─────────────────────────────────────────────────────────────

export interface Notification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  message: string | null;
  entity_type: string | null;
  entity_id: string | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}
