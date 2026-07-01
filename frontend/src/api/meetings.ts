import { apiClient } from "./client";
import type {
  MeetingNote,
  MeetingNoteCreate,
  SummarizeRequest,
  ExtractedAction,
  RecorderStatus,
  AddToKbResult,
  SttCredentialsStatus,
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

export async function transcribeMeetingAudio(
  file: File,
): Promise<{ transcript: string; provider: string }> {
  const form = new FormData();
  form.append("file", file);
  const resp = await apiClient.post<{ transcript: string; provider: string }>(
    "/meetings/transcribe-audio",
    form,
    {
      headers: { "Content-Type": "multipart/form-data" },
      // Long recordings transcribe via Google STT v2 batchRecognize, which can
      // run for several minutes; override the default 120 s client timeout.
      timeout: 20 * 60 * 1000,
    },
  );
  return resp.data;
}

export async function extractMeetingActions(id: string): Promise<ExtractedAction[]> {
  const resp = await apiClient.post<ExtractedAction[]>(`/meetings/${id}/extract-actions`, {});
  return resp.data;
}

// ── Auto-capture recorder ──────────────────────────────────────────────────────

export async function getRecorderStatus(): Promise<RecorderStatus> {
  const resp = await apiClient.get<RecorderStatus>("/meetings/recorder/status");
  return resp.data;
}

export async function setRecorderEnabled(enabled: boolean): Promise<RecorderStatus> {
  const resp = await apiClient.post<RecorderStatus>("/meetings/recorder/toggle", { enabled });
  return resp.data;
}

export async function startRecording(): Promise<RecorderStatus> {
  const resp = await apiClient.post<RecorderStatus>("/meetings/recorder/start");
  return resp.data;
}

export async function stopRecording(): Promise<RecorderStatus> {
  const resp = await apiClient.post<RecorderStatus>("/meetings/recorder/stop");
  return resp.data;
}

export async function recoverRecordings(): Promise<RecorderStatus> {
  const resp = await apiClient.post<RecorderStatus>("/meetings/recorder/recover");
  return resp.data;
}

export async function discardRecordings(): Promise<RecorderStatus> {
  const resp = await apiClient.post<RecorderStatus>("/meetings/recorder/discard");
  return resp.data;
}

export async function addMeetingToKnowledgeBase(id: string): Promise<AddToKbResult> {
  const resp = await apiClient.post<AddToKbResult>(`/meetings/${id}/add-to-kb`, {});
  return resp.data;
}

// ── Transcription credentials ──────────────────────────────────────────────────

export async function getSttCredentialsStatus(): Promise<SttCredentialsStatus> {
  const resp = await apiClient.get<SttCredentialsStatus>("/meetings/stt/credentials-status");
  return resp.data;
}

export async function fetchSttCredentials(): Promise<{ ok: boolean; path: string }> {
  const resp = await apiClient.post<{ ok: boolean; path: string }>("/meetings/stt/credentials/fetch");
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
