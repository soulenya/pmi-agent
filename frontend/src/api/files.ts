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
