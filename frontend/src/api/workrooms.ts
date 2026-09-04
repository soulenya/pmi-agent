import { apiClient } from "./client";
import type { Source } from "./tasks";

/** A hub project's room lives on the hub, so its calls go through the proxy. */
function at(source: Source, path: string): string {
  return source === "hub" ? `/hub/api${path}` : path;
}

// ── Workrooms — persistent co-work spaces with Gerry ────────────────────────

export type WorkroomItemKind =
  | "drive_doc"
  | "kb_doc"
  | "generated_file"
  | "note"
  | "email_thread"
  | "task"
  | "odoo_record"
  | "regulatory_doc"
  | "budget"
  | "website";

export const ITEM_KIND_LABELS: Record<WorkroomItemKind, string> = {
  drive_doc: "Drive doc",
  kb_doc: "KB document",
  generated_file: "Generated file",
  note: "Note",
  email_thread: "Email thread",
  task: "Task",
  odoo_record: "Odoo record",
  regulatory_doc: "Regulatory doc",
  budget: "Budget",
  website: "Website",
};

export interface WorkroomItem {
  id: string;
  kind: WorkroomItemKind;
  ref_id: string;
  label: string;
  created_at: string;
}

export interface WorkroomJournalEntry {
  id: string;
  entry: string;
  created_at: string;
}

export interface Workroom {
  id: string;
  title: string;
  goal: string;
  status: "active" | "archived";
  conversation_id: string | null;
  share_file_id: string | null;
  created_at: string;
  updated_at: string;
  item_count: number;
}

export interface WorkroomDetail extends Workroom {
  items: WorkroomItem[];
  journal: WorkroomJournalEntry[];
}

export interface SharedRoomManifest {
  file_id: string;
  file_name: string;
  title: string;
  goal: string;
  item_count?: number;
  modified: string;
  url: string;
  joined: boolean;
}

export async function listWorkrooms(
  includeArchived = false,
  source: Source = "local",
): Promise<Workroom[]> {
  const { data } = await apiClient.get<Workroom[]>(at(source, "/workrooms"), {
    params: { include_archived: includeArchived },
  });
  return data;
}

export async function createWorkroom(
  title: string,
  goal: string,
  source: Source = "local",
): Promise<Workroom> {
  const { data } = await apiClient.post<Workroom>(at(source, "/workrooms"), { title, goal });
  return data;
}

/** Upload an OS file into the room — stored in the file workspace and pinned. */
export async function uploadWorkroomFile(
  roomId: string,
  file: File,
  source: Source = "local",
): Promise<WorkroomItem> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await apiClient.post<WorkroomItem>(
    at(source, `/workrooms/${roomId}/upload`),
    form,
    { headers: { "Content-Type": "multipart/form-data" } },
  );
  return data;
}

export async function getWorkroom(
  id: string,
  source: Source = "local",
): Promise<WorkroomDetail> {
  const { data } = await apiClient.get<WorkroomDetail>(at(source, `/workrooms/${id}`));
  return data;
}

export async function updateWorkroom(
  id: string,
  fields: Partial<Pick<Workroom, "title" | "goal" | "status">>,
  source: Source = "local",
): Promise<Workroom> {
  const { data } = await apiClient.patch<Workroom>(at(source, `/workrooms/${id}`), fields);
  return data;
}

export async function deleteWorkroom(id: string, source: Source = "local"): Promise<void> {
  await apiClient.delete(at(source, `/workrooms/${id}`));
}

export async function addWorkroomItem(
  roomId: string,
  item: { kind: WorkroomItemKind; ref_id?: string; label: string },
  source: Source = "local",
): Promise<WorkroomItem> {
  const { data } = await apiClient.post<WorkroomItem>(at(source, `/workrooms/${roomId}/items`), {
    kind: item.kind,
    ref_id: item.ref_id ?? "",
    label: item.label,
  });
  return data;
}

export async function removeWorkroomItem(
  roomId: string,
  itemId: string,
  source: Source = "local",
): Promise<void> {
  await apiClient.delete(at(source, `/workrooms/${roomId}/items/${itemId}`));
}

export async function addWorkroomJournal(
  roomId: string,
  entry: string,
  source: Source = "local",
): Promise<WorkroomJournalEntry> {
  const { data } = await apiClient.post<WorkroomJournalEntry>(
    at(source, `/workrooms/${roomId}/journal`),
    { entry },
  );
  return data;
}

// ── Sharing — room manifests on the shared Drive ─────────────────────────────

export async function shareWorkroom(
  roomId: string,
  source: Source = "local",
): Promise<{ file_id: string; url: string }> {
  const { data } = await apiClient.post<{ file_id: string; url: string }>(
    at(source, `/workrooms/${roomId}/share`),
  );
  return data;
}

export async function pullWorkroom(
  roomId: string,
  source: Source = "local",
): Promise<{ added_items: number; title: string }> {
  const { data } = await apiClient.post<{ added_items: number; title: string }>(
    at(source, `/workrooms/${roomId}/pull`),
  );
  return data;
}

export async function listSharedRooms(source: Source = "local"): Promise<SharedRoomManifest[]> {
  const { data } = await apiClient.get<SharedRoomManifest[]>(
    at(source, "/workrooms/shared/available"),
  );
  return data;
}

export async function joinSharedRoom(
  fileId: string,
  source: Source = "local",
): Promise<Workroom> {
  const { data } = await apiClient.post<Workroom>(at(source, `/workrooms/shared/${fileId}/join`));
  return data;
}
