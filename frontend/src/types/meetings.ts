export interface MeetingNote {
  id: string;
  title: string;
  raw_transcript: string;
  summary: string | null;
  decisions: string | null;
  action_items: string | null;
  next_steps: string | null;
  meeting_date: string | null;
  attendees: string[];
  tags: string[];
  generated_task_ids: string[];
  kb_document_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MeetingNoteCreate {
  title: string;
  raw_transcript: string;
  meeting_date?: string;
  attendees?: string[];
  tags?: string[];
}

export interface SummarizeRequest {
  create_tasks?: boolean;
}

export type EmailDraftStatus = "draft" | "pending_approval" | "approved" | "rejected";

export interface EmailDraft {
  id: string;
  subject: string;
  recipient_name: string | null;
  recipient_email: string | null;
  cc: string | null;
  bcc: string | null;
  purpose: string;
  tone: string;
  key_points: string | null;
  draft_body: string | null;
  status: EmailDraftStatus;
  approval_intent_id: string | null;
  is_archived: boolean;
  tags: string[];
  attachments: { filename: string; display_name: string }[];
  verification: { sources?: string[]; flags?: string[]; recorded_at?: string } | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmailDraftCreate {
  subject: string;
  recipient_name?: string;
  recipient_email?: string;
  cc?: string;
  bcc?: string;
  purpose: string;
  tone?: string;
  key_points?: string;
  tags?: string[];
}

export interface EmailDraftUpdate {
  subject?: string;
  recipient_name?: string;
  recipient_email?: string;
  purpose?: string;
  tone?: string;
  key_points?: string;
  draft_body?: string;
  tags?: string[];
}

export interface ExtractedAction {
  index: number;
  title: string;
}

export type RecorderState = "idle" | "meeting_detected" | "recording" | "processing";

export interface RecorderStatus {
  enabled: boolean;
  supported: boolean;
  configured: boolean;
  state: RecorderState;
  platform: string | null;
  started_at: string | null;
  last_meeting_id: string | null;
  last_error: string | null;
  pending: number;
}

export interface AddToKbResult {
  document_id: string;
  title: string;
  chunk_count: number;
}

export interface SttCredentialsStatus {
  present: boolean;
  download_available: boolean;
  configured: boolean;
}

export const EMAIL_TONES = ["professional", "friendly", "formal", "concise", "empathetic", "persuasive"] as const;
export type EmailTone = typeof EMAIL_TONES[number];
