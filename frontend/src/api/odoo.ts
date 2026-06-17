import { apiClient } from "@/api/client";

const PREFIX = "/api/odoo";

export interface OdooStatus {
  connected: boolean;
  url?: string | null;
  database?: string | null;
  username?: string | null;
  display_name?: string | null;
  server_version?: string | null;
  last_connected_at?: string | null;
}

export interface OdooConnectRequest {
  url: string;
  database: string;
  username: string;
  api_key: string;
}

export interface OdooModelInfo {
  key: string;
  label: string;
  model: string;
}

export interface OdooDataResponse {
  key: string;
  label: string;
  model: string;
  fields: string[];
  rows: Array<Record<string, unknown>>;
}

export async function getOdooStatus(): Promise<OdooStatus> {
  const res = await apiClient.get(`${PREFIX}/status`);
  return res.data;
}

export async function connectOdoo(body: OdooConnectRequest): Promise<OdooStatus> {
  const res = await apiClient.post(`${PREFIX}/connect`, body);
  return res.data;
}

export async function disconnectOdoo(): Promise<{ status: string }> {
  const res = await apiClient.delete(`${PREFIX}/disconnect`);
  return res.data;
}

export async function getOdooModels(): Promise<OdooModelInfo[]> {
  const res = await apiClient.get(`${PREFIX}/models`);
  return res.data.models;
}

export async function getOdooData(
  key: string,
  opts?: { search?: string; limit?: number },
): Promise<OdooDataResponse> {
  const res = await apiClient.get(`${PREFIX}/data/${key}`, {
    params: { search: opts?.search || undefined, limit: opts?.limit ?? 50 },
  });
  return res.data;
}

export interface OdooIngestResult {
  imported: number;
  skipped: number;
  failed: number;
}

export async function ingestOdoo(
  key: string,
  opts?: { ids?: number[]; limit?: number },
): Promise<OdooIngestResult> {
  const res = await apiClient.post(`${PREFIX}/ingest`, {
    key,
    ids: opts?.ids,
    limit: opts?.limit ?? 50,
  });
  return res.data;
}
