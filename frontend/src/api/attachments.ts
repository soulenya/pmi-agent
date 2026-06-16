import { apiClient } from "./client";
import type { ChatAttachment } from "@/types/chat";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000";

/** Reference files attached to a conversation (kept out of the Knowledge Base). */
export async function listAttachments(
  conversationId: string,
): Promise<ChatAttachment[]> {
  const { data } = await apiClient.get<ChatAttachment[]>(
    `/conversations/${conversationId}/attachments`,
  );
  return data;
}

export async function uploadAttachment(
  conversationId: string,
  file: File,
): Promise<ChatAttachment> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await apiClient.post<ChatAttachment>(
    `/conversations/${conversationId}/attachments`,
    form,
    { headers: { "Content-Type": "multipart/form-data" } },
  );
  return data;
}

export async function deleteAttachment(
  conversationId: string,
  attachmentId: string,
): Promise<void> {
  await apiClient.delete(
    `/conversations/${conversationId}/attachments/${attachmentId}`,
  );
}

/** Direct URL to download the original (decrypted) file. */
export function getAttachmentDownloadUrl(
  conversationId: string,
  attachmentId: string,
): string {
  return `${API_BASE}/conversations/${conversationId}/attachments/${attachmentId}/download`;
}
