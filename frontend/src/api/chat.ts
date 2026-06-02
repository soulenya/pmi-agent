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

export async function listMessages(conversationId: string): Promise<Message[]> {
  const resp = await apiClient.get<Message[]>(
    `/conversations/${conversationId}/messages`
  );
  return resp.data;
}

// ── Approvals ─────────────────────────────────────────────────────────────────

export async function listPendingApprovals(): Promise<ApprovalIntent[]> {
  const resp = await apiClient.get<ApprovalIntent[]>("/approvals/pending");
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
