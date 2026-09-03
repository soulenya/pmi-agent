import { apiClient } from "./client";
import type {
  Conversation,
  ConversationCreate,
  Message,
  ApprovalIntent,
  Notification,
  ResolveApprovalRequest,
} from "@/types/chat";

// ── Conversations ─────────────────────────────────────────────────────────────

export async function listConversations(): Promise<Conversation[]> {
  const resp = await apiClient.get<Conversation[]>("/conversations");
  return resp.data;
}

export async function createConversation(body: ConversationCreate = {}): Promise<Conversation> {
  const resp = await apiClient.post<Conversation>("/conversations", body);
  return resp.data;
}

export async function getConversation(id: string): Promise<Conversation> {
  const resp = await apiClient.get<Conversation>(`/conversations/${id}`);
  return resp.data;
}

export async function updateConversation(
  id: string,
  body: import("@/types/chat").ConversationUpdate,
): Promise<Conversation> {
  const resp = await apiClient.patch<Conversation>(`/conversations/${id}`, body);
  return resp.data;
}

export interface MessagePage {
  messages: Message[];
  /** True when older messages exist before `messages[0]`. */
  hasMore: boolean;
}

/** A page of messages, newest last. Omit `beforeId` for the latest page. */
export async function listMessagePage(
  conversationId: string,
  opts?: { beforeId?: string; limit?: number }
): Promise<MessagePage> {
  const resp = await apiClient.get<Message[]>(
    `/conversations/${conversationId}/messages`,
    { params: { limit: opts?.limit ?? 100, before_id: opts?.beforeId } }
  );
  return {
    messages: resp.data,
    hasMore: resp.headers["x-has-more"] === "true",
  };
}

export async function listMessages(conversationId: string): Promise<Message[]> {
  return (await listMessagePage(conversationId)).messages;
}

/** Ask the running turn to stop. `stopping` is false when nothing was running. */
export async function stopTurn(
  conversationId: string,
): Promise<{ stopping: boolean }> {
  const resp = await apiClient.post<{ stopping: boolean }>(
    `/conversations/${conversationId}/stop`
  );
  return resp.data;
}

// ── Approvals ─────────────────────────────────────────────────────────────────

export async function listPendingApprovals(params?: {
  conversation_id?: string;
  thread_id?: string;
}): Promise<ApprovalIntent[]> {
  const resp = await apiClient.get<ApprovalIntent[]>("/approvals/pending", { params });
  return resp.data;
}

export async function getPendingApprovalCount(): Promise<number> {
  const resp = await apiClient.get<{ count: number }>("/approvals/count");
  return resp.data.count;
}

export async function resolveApproval(
  id: string,
  body: ResolveApprovalRequest
): Promise<ApprovalIntent> {
  const resp = await apiClient.post<ApprovalIntent>(`/approvals/${id}/resolve`, body);
  return resp.data;
}

export interface EditApprovalRequest {
  to?: string;
  cc?: string;
  subject?: string;
  body?: string;
}

export async function editApproval(
  id: string,
  body: EditApprovalRequest
): Promise<ApprovalIntent> {
  const resp = await apiClient.patch<ApprovalIntent>(`/approvals/${id}`, body);
  return resp.data;
}

export async function clearExpiredApprovals(): Promise<{ deleted: number }> {
  const resp = await apiClient.delete<{ deleted: number }>("/approvals/expired");
  return resp.data;
}

// ── Notifications ─────────────────────────────────────────────────────────────

export async function listNotifications(): Promise<Notification[]> {
  const resp = await apiClient.get<Notification[]>("/notifications");
  return resp.data;
}

export async function markNotificationRead(id: string): Promise<void> {
  await apiClient.post(`/notifications/${id}/read`);
}

export async function markAllNotificationsRead(): Promise<void> {
  await apiClient.post("/notifications/read-all");
}
