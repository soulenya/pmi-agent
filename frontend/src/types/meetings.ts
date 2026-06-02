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
  purpose: string;
  tone: string;
  key_points: string | null;
  draft_body: string | null;
  status: EmailDraftStatus;
  approval_intent_id: string | null;
  is_archived: boolean;
  tags: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmailDraftCreate {
  subject: string;
  recipient_name?: string;
  recipient_email?: string;
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

export const EMAIL_TONES = ["professional", "friendly", "formal", "concise", "empathetic", "persuasive"] as const;
export type EmailTone = typeof EMAIL_TONES[number];
