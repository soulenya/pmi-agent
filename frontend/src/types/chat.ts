import type { User } from "@/types";

// ── Conversations ─────────────────────────────────────────────────────────────

export interface Conversation {
  id: string;
  user_id: string;
  title: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface ConversationCreate {
  title?: string;
}

// ── Messages ──────────────────────────────────────────────────────────────────

export type MessageRole = "user" | "assistant" | "system" | "tool";

export interface Message {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  cited_chunk_ids: string[] | null;
  tool_calls: unknown[] | null;
  tool_results: unknown[] | null;
  token_count: number | null;
  model_used: string | null;
  created_at: string;
}

export interface SendMessageRequest {
  content: string;
  conversation_id?: string;
}

// ── Approvals ─────────────────────────────────────────────────────────────────

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";
export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface ApprovalIntent {
  id: string;
  action_type: string;
  description: string | null;
  intent_payload: Record<string, unknown>;
  risk_level: RiskLevel;
  status: ApprovalStatus;
  expires_at: string;
  resolved_at: string | null;
  rejection_reason: string | null;
  created_at: string;
}

export interface ResolveApprovalRequest {
  approved: boolean;
  rejection_reason?: string;
}

// ── Notifications ─────────────────────────────────────────────────────────────

export interface Notification {
  id: string;
  type: string;
  title: string;
  message: string | null;
  entity_type: string | null;
  entity_id: string | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}
