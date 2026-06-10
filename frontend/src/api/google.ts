import { apiClient } from "./client";

const G = "/api/google";

export interface GoogleStatus {
  connected: boolean;
  status: string;
  email?: string;
}

export async function getGoogleStatus(): Promise<GoogleStatus> {
  const r = await apiClient.get<{ connected: boolean; status: string; email?: string }>(`${G}/status`);
  return { connected: r.data.status === "connected", status: r.data.status, email: r.data.email };
}

/** Launch the Google OAuth flow in the system browser. */
export async function startGoogleAuth(): Promise<void> {
  await apiClient.post(`${G}/auth/start`, {});
}

export interface DriveItem {
  id: string;
  name: string;
  type: string;
  modified: string;
  url: string;
}

export interface SharedDrive {
  id: string;
  name: string;
  type: "shared_drive";
}

export async function listSharedDrives(): Promise<SharedDrive[]> {
  const r = await apiClient.get<{ drives: SharedDrive[] }>(`${G}/drive/shared-drives`);
  return r.data.drives;
}

export async function driveListFolder(folderId = "root", driveId?: string): Promise<DriveItem[]> {
  const r = await apiClient.get<{ items: DriveItem[] }>(`${G}/drive/list`, {
    params: { folder_id: folderId, ...(driveId ? { drive_id: driveId } : {}) },
  });
  return r.data.items;
}

export async function driveSearch(query: string, max = 20): Promise<DriveItem[]> {
  const r = await apiClient.get<{ files: DriveItem[] }>(`${G}/drive/search`, {
    params: { q: query, max },
  });
  return r.data.files;
}

export interface DriveImportResult {
  id: string;
  title: string;
  filename: string;
  status: string;
  drive_file_id: string;
  drive_url: string;
}

export async function driveImportToKnowledgeBase(
  file_id: string,
  title: string,
  category_id?: string,
  is_regulated = false,
): Promise<DriveImportResult> {
  const r = await apiClient.post<DriveImportResult>(`${G}/drive/import`, {
    file_id, title, category_id, is_regulated,
  });
  return r.data;
}

export interface GoogleTask {
  id: string;
  title: string;
  notes?: string;
  due?: string;
  status: string;
}

export async function listGoogleTasks(max_results = 50, show_completed = false): Promise<GoogleTask[]> {
  const r = await apiClient.get<{ tasks: GoogleTask[] }>(`${G}/tasks`, {
    params: { max_results, show_completed },
  });
  return r.data.tasks;
}

export async function importGoogleTasks(taskIds: string[]): Promise<{ imported: number; task_ids: string[] }> {
  const r = await apiClient.post<{ imported: number; task_ids: string[] }>(`${G}/tasks/import`, {
    task_ids: taskIds,
  });
  return r.data;
}

export interface GoogleCalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  location?: string;
  url?: string;
}

export async function listGoogleCalendarEvents(days_behind = 0, days_ahead = 30): Promise<GoogleCalendarEvent[]> {
  const r = await apiClient.get<{ events: GoogleCalendarEvent[] }>(`${G}/calendar/events`, {
    params: { days_behind, days_ahead },
  });
  return r.data.events;
}

export interface DriveUploadResult {
  id: string;
  name: string;
  url: string;
}

export async function driveUploadBlob(blob: Blob, name: string, folderId?: string): Promise<DriveUploadResult> {
  const form = new FormData();
  form.append("file", blob, name);
  if (folderId) form.append("folder_id", folderId);
  const r = await apiClient.post<DriveUploadResult>(`${G}/drive/upload`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return r.data;
}
