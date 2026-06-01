import { apiClient } from "./client";
import type { ApiResponse } from "@/types";
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
  const resp = await apiClient.get<ApiResponse<Conversation[]>>("/conversations");
  return resp.data.data ?? [];
}

export async function createConversation(body: ConversationCreate = {}): Promise<Conversation> {
  const resp = await apiClient.post<ApiResponse<Conversation>>("/conversations", body);
  return resp.data.data!;
}

export async function getConversation(id: string): Promise<Conversation> {
  const resp = await apiClient.get<ApiResponse<Conversation>>(`/conversations/${id}`);
  return resp.data.data!;
}

export async function listMessages(conversationId: string): Promise<Message[]> {
  const resp = await apiClient.get<ApiResponse<Message[]>>(
    `/conversations/${conversationId}/messages`
  );
  return resp.data.data ?? [];
}

// ── Approvals ─────────────────────────────────────────────────────────────────

export async function listPendingApprovals(): Promise<ApprovalIntent[]> {
  const resp = await apiClient.get<ApiResponse<ApprovalIntent[]>>(
    "/approvals?status=pending"
  );
  return resp.data.data ?? [];
}

export async function resolveApproval(
  id: string,
  body: ResolveApprovalRequest
): Promise<ApprovalIntent> {
  const resp = await apiClient.post<ApiResponse<ApprovalIntent>>(
    `/approvals/${id}/resolve`,
    body
  );
  return resp.data.data!;
}

// ── Notifications ─────────────────────────────────────────────────────────────

export async function listNotifications(unreadOnly = false): Promise<Notification[]> {
  const params = unreadOnly ? "?unread=true" : "";
  const resp = await apiClient.get<ApiResponse<Notification[]>>(`/notifications${params}`);
  return resp.data.data ?? [];
}

export async function markNotificationRead(id: string): Promise<void> {
  await apiClient.patch(`/notifications/${id}/read`);
}

export async function markAllNotificationsRead(): Promise<void> {
  await apiClient.post("/notifications/read-all");
}
