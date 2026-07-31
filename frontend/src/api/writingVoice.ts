import { apiClient } from "./client";

export interface WritingVoice {
  profile: string | null;
  use_for_documents: boolean;
  updated_at: string | null;
}

export interface WritingVoiceAnalysis {
  profile: string;
  messages_analyzed: number;
}

const BASE = "/writing-voice";

export async function getWritingVoice(): Promise<WritingVoice> {
  const r = await apiClient.get<WritingVoice>(BASE);
  return r.data;
}

export async function saveWritingVoice(payload: {
  profile?: string | null;
  use_for_documents?: boolean;
}): Promise<WritingVoice> {
  const r = await apiClient.put<WritingVoice>(BASE, payload);
  return r.data;
}

export async function uploadWritingVoice(file: File): Promise<WritingVoice> {
  const form = new FormData();
  form.append("file", file);
  const r = await apiClient.post<WritingVoice>(`${BASE}/upload`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return r.data;
}

export async function deleteWritingVoice(): Promise<WritingVoice> {
  const r = await apiClient.delete<WritingVoice>(BASE);
  return r.data;
}

/** Read the user's sent mail and write a profile. Slow — minutes, not seconds. */
export async function analyzeWritingVoice(maxMessages = 120): Promise<WritingVoiceAnalysis> {
  const r = await apiClient.post<WritingVoiceAnalysis>(
    `${BASE}/analyze`,
    { max_messages: maxMessages },
    { timeout: 15 * 60 * 1000 },
  );
  return r.data;
}
