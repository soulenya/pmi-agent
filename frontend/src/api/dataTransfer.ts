import { apiClient } from "./client";

export interface DataSummary {
  counts: Record<string, number>;
  database_bytes: number;
  document_files: number;
  document_bytes: number;
  generated_files: number;
  generated_bytes: number;
  docker_running: boolean;
  /** Absolute folder on this machine where backup files are written. */
  directory: string;
  archives: ArchiveInfo[];
}

export interface ArchiveInfo {
  filename: string;
  bytes: number;
  created_at: string;
}

export interface ExportResult extends ArchiveInfo {
  path: string;
  skipped_files: number;
}

export interface ArchiveManifest {
  format_version: number;
  created_at: string;
  app_version: string;
  documents?: number;
  attachments?: number;
  generated_files?: number;
  reconnect_required: boolean;
  note?: string;
}

export interface RestoreResult {
  restored: { documents: number; attachments: number; generated_files: number };
  reconnect_required: boolean;
  safety_copy: string;
  created_at: string | null;
  app_version: string | null;
}

export async function getDataSummary(): Promise<DataSummary> {
  const { data } = await apiClient.get<DataSummary>("/api/data/summary");
  return data;
}

export async function createDataExport(): Promise<ExportResult> {
  // A full pg_dump plus every document — minutes, not seconds, on a large install.
  const { data } = await apiClient.post<ExportResult>("/api/data/export", null, {
    timeout: 30 * 60_000,
  });
  return data;
}

export async function deleteDataExport(filename: string): Promise<void> {
  await apiClient.delete(`/api/data/export/${encodeURIComponent(filename)}`);
}

export function dataExportUrl(filename: string): string {
  return `/api/data/export/${encodeURIComponent(filename)}`;
}

export async function downloadDataExport(filename: string): Promise<Blob> {
  const { data } = await apiClient.get<Blob>(dataExportUrl(filename), {
    responseType: "blob",
    timeout: 30 * 60_000,
  });
  return data;
}

export async function inspectDataImport(file: File): Promise<ArchiveManifest> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await apiClient.post<ArchiveManifest>("/api/data/import/inspect", form, {
    timeout: 10 * 60_000,
  });
  return data;
}

export async function runDataImport(file: File): Promise<RestoreResult> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await apiClient.post<RestoreResult>("/api/data/import", form, {
    timeout: 60 * 60_000,
  });
  return data;
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
