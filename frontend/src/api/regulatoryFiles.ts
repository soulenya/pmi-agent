import { apiClient } from "./client";

// ── Regulatory file explorer ────────────────────────────────────────────────

export interface RegNode {
  id: string;
  parent_id: string | null;
  node_type: "folder" | "file";
  name: string;
  size_bytes?: number | null;
  mime_type?: string | null;
  extension?: string | null;
  source_type?: string | null;
  source_url?: string | null;
  source_modified_at?: string | null;
  sync_status?: string | null;
  sync_detail?: string | null;
  last_checked_at?: string | null;
  last_synced_at?: string | null;
  is_editable: boolean;
  created_at: string;
  updated_at: string;
}

export interface RegBreadcrumb {
  id: string | null;
  name: string;
}

export interface RegListing {
  parent_id: string | null;
  breadcrumb: RegBreadcrumb[];
  nodes: RegNode[];
}

const BASE = "/regulatory-files";

export async function listRegNodes(parentId?: string | null): Promise<RegListing> {
  const r = await apiClient.get<RegListing>(BASE, {
    params: parentId ? { parent_id: parentId } : undefined,
  });
  return r.data;
}

export async function createRegFolder(name: string, parentId: string | null): Promise<RegNode> {
  const r = await apiClient.post<RegNode>(`${BASE}/folder`, { name, parent_id: parentId });
  return r.data;
}

export async function uploadRegFile(file: File, parentId: string | null): Promise<RegNode> {
  const form = new FormData();
  form.append("file", file);
  if (parentId) form.append("parent_id", parentId);
  const r = await apiClient.post<RegNode>(`${BASE}/upload`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return r.data;
}

export async function importRegFromDrive(fileId: string, parentId: string | null): Promise<RegNode> {
  const r = await apiClient.post<RegNode>(`${BASE}/import-drive`, {
    file_id: fileId,
    parent_id: parentId,
  });
  return r.data;
}

// ── Drive selective sync (regulated — review & approve per file) ─────────────

export interface RegSyncChange {
  id: string;
  name: string;
  sync_status: "modified" | "renamed" | "deleted";
  detail: string | null;
}

export interface RegCheckUpdatesSummary {
  checked: number;
  changed: number;
  errors: number;
  items: RegSyncChange[];
  skipped?: string | null;
}

export async function checkRegUpdates(): Promise<RegCheckUpdatesSummary> {
  const r = await apiClient.post<RegCheckUpdatesSummary>(`${BASE}/check-updates`);
  return r.data;
}

export async function applyRegUpdate(id: string): Promise<RegNode> {
  const r = await apiClient.post<RegNode>(`${BASE}/${id}/apply-update`);
  return r.data;
}

export async function dismissRegUpdate(id: string): Promise<RegNode> {
  const r = await apiClient.post<RegNode>(`${BASE}/${id}/dismiss-update`);
  return r.data;
}

export async function renameRegNode(id: string, name: string): Promise<RegNode> {
  const r = await apiClient.patch<RegNode>(`${BASE}/${id}`, { name });
  return r.data;
}

export async function moveRegNode(id: string, parentId: string | null): Promise<RegNode> {
  const r = await apiClient.patch<RegNode>(`${BASE}/${id}`, { move: true, parent_id: parentId });
  return r.data;
}

export async function deleteRegNode(id: string): Promise<void> {
  await apiClient.delete(`${BASE}/${id}`);
}

export async function getRegText(id: string): Promise<{ id: string; name: string; content: string }> {
  const r = await apiClient.get<{ id: string; name: string; content: string }>(`${BASE}/${id}/text`);
  return r.data;
}

export async function saveRegText(id: string, content: string): Promise<RegNode> {
  const r = await apiClient.put<RegNode>(`${BASE}/${id}/text`, { content });
  return r.data;
}

export function regDownloadUrl(id: string): string {
  return `${BASE}/${id}/download`;
}

export async function downloadRegFile(id: string, filename: string): Promise<void> {
  const r = await apiClient.get(`${BASE}/${id}/download`, { responseType: "blob" });
  const url = URL.createObjectURL(r.data as Blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
