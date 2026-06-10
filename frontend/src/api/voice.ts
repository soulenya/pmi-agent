import { apiClient } from "./client";

export interface VoiceInfo {
  name: string;
  gender: string;
  language_codes: string[];
}

const BASE = "/voice";

/** List available TTS voices (premium tiers first). */
export async function listVoices(): Promise<VoiceInfo[]> {
  const r = await apiClient.get<VoiceInfo[]>(`${BASE}/voices`);
  return r.data;
}

/** Transcribe a recorded audio clip to text. */
export async function transcribeAudio(blob: Blob): Promise<string> {
  const form = new FormData();
  form.append("file", blob, "recording.webm");
  const r = await apiClient.post<{ text: string }>(`${BASE}/transcribe`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return r.data.text;
}

/** Synthesize speech for text; returns an MP3 blob ready for an Audio element. */
export async function speakText(text: string, voice?: string): Promise<Blob> {
  const r = await apiClient.post(`${BASE}/speak`, { text, voice }, {
    responseType: "blob",
  });
  return r.data as Blob;
}
