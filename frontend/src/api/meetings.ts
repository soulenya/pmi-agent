import { apiClient } from "./client";
import type {
  MeetingNote,
  MeetingNoteCreate,
  SummarizeRequest,
  ExtractedAction,
  EmailDraft,
  EmailDraftCreate,
  EmailDraftUpdate,
} from "@/types/meetings";

// ── Meetings ─────────────────────────────────────────────────────────────────

export async function listMeetings(): Promise<MeetingNote[]> {
  const resp = await apiClient.get<MeetingNote[]>("/meetings");
  return resp.data;
}

export async function createMeeting(body: MeetingNoteCreate): Promise<MeetingNote> {
  const resp = await apiClient.post<MeetingNote>("/meetings", body);
  return resp.data;
}

export async function getMeeting(id: string): Promise<MeetingNote> {
  const resp = await apiClient.get<MeetingNote>(`/meetings/${id}`);
  return resp.data;
}

export async function summarizeMeeting(
  id: string,
  body: SummarizeRequest = { create_tasks: true }
): Promise<MeetingNote> {
  const resp = await apiClient.post<MeetingNote>(`/meetings/${id}/summarize`, body);
  return resp.data;
}

export async function deleteMeeting(id: string): Promise<void> {
  await apiClient.delete(`/meetings/${id}`);
}

export async function extractMeetingActions(id: string): Promise<ExtractedAction[]> {
  const resp = await apiClient.post<ExtractedAction[]>(`/meetings/${id}/extract-actions`, {});
  return resp.data;
}

// ── Email Drafts ──────────────────────────────────────────────────────────────

export async function listEmailDrafts(): Promise<EmailDraft[]> {
  const resp = await apiClient.get<EmailDraft[]>("/emails");
  return resp.data;
}

export async function createEmailDraft(body: EmailDraftCreate): Promise<EmailDraft> {
  const resp = await apiClient.post<EmailDraft>("/emails", body);
  return resp.data;
}

export async function getEmailDraft(id: string): Promise<EmailDraft> {
  const resp = await apiClient.get<EmailDraft>(`/emails/${id}`);
  return resp.data;
}

export async function updateEmailDraft(id: string, body: EmailDraftUpdate): Promise<EmailDraft> {
  const resp = await apiClient.put<EmailDraft>(`/emails/${id}`, body);
  return resp.data;
}

export async function regenerateEmailDraft(id: string): Promise<EmailDraft> {
  const resp = await apiClient.post<EmailDraft>(`/emails/${id}/regenerate`, {});
  return resp.data;
}

export async function submitEmailForApproval(id: string): Promise<EmailDraft> {
  const resp = await apiClient.post<EmailDraft>(`/emails/${id}/submit-for-approval`, {});
  return resp.data;
}

export async function deleteEmailDraft(id: string): Promise<void> {
  await apiClient.delete(`/emails/${id}`);
}
