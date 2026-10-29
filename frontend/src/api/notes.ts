/**
 * Personal notes — yours alone. A note is kept on the hub when this install
 * is connected to it (so the phone and the laptop share one list), else here.
 */
import { apiClient } from "@/api/client";
import type { Source } from "@/api/tasks";

export interface Note {
  id: string;
  content: string;
  source: "voice" | "text" | "gerry";
  conversation_id: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

function at(source: Source, path: string): string {
  return source === "hub" ? `/hub/api${path}` : path;
}

export async function listNotes(
  params: { q?: string; include_archived?: boolean; limit?: number } = {},
  source: Source = "local",
): Promise<Note[]> {
  const resp = await apiClient.get<Note[]>(at(source, "/notes"), { params });
  return resp.data;
}

export async function createNote(
  content: string,
  source: Source = "local",
  kind: Note["source"] = "text",
): Promise<Note> {
  const resp = await apiClient.post<Note>(at(source, "/notes"), { content, source: kind });
  return resp.data;
}

export async function updateNote(
  id: string,
  body: { content?: string; archived?: boolean },
  source: Source = "local",
): Promise<Note> {
  const resp = await apiClient.patch<Note>(at(source, `/notes/${id}`), body);
  return resp.data;
}

export async function deleteNote(id: string, source: Source = "local"): Promise<void> {
  await apiClient.delete(at(source, `/notes/${id}`));
}
