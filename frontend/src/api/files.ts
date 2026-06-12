import { apiClient } from "./client";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000";

export interface GeneratedFile {
  name: string;
  size: number;
  modified: number;
}

export async function listGeneratedFiles(): Promise<GeneratedFile[]> {
  const r = await apiClient.get<{ files: GeneratedFile[] }>("/api/files");
  return r.data.files;
}

export async function deleteGeneratedFile(name: string): Promise<void> {
  await apiClient.delete(`/api/files/${encodeURIComponent(name)}`);
}

export function getFileDownloadUrl(name: string): string {
  return `${API_BASE}/api/files/${encodeURIComponent(name)}`;
}

export async function fetchGeneratedFileBlob(name: string): Promise<Blob> {
  const r = await apiClient.get(`/api/files/${encodeURIComponent(name)}`, { responseType: "blob" });
  return r.data as Blob;
}

export interface KbMoveResult {
  document_id: string;
  title: string;
  moved: string;
}

/** Ingest a generated file into the Knowledge Base and remove it from generated files. */
export async function moveGeneratedFileToKB(name: string, title: string): Promise<KbMoveResult> {
  const r = await apiClient.post<KbMoveResult>(
    `/api/files/${encodeURIComponent(name)}/to-knowledge-base`,
    { title },
  );
  return r.data;
}

export interface DriveUploadInfo {
  id: string;
  name: string;
  url: string;
}

/** Upload a generated file to the user's Google Drive (My Drive root). */
export async function uploadGeneratedFileToDrive(
  name: string,
  targetName: string,
): Promise<DriveUploadInfo> {
  const r = await apiClient.post<DriveUploadInfo>(
    `/api/files/${encodeURIComponent(name)}/to-drive`,
    { target_name: targetName },
  );
  return r.data;
}
