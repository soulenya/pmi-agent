import { apiClient } from "@/api/client";

// The same handlers are mounted at /api/odoo (historical) and /api/erp.
const PREFIX = "/api/erp";

export interface OdooStatus {
  connected: boolean;
  provider: string;
  label: string;
  url?: string | null;
  database?: string | null;
  username?: string | null;
  display_name?: string | null;
  server_version?: string | null;
  last_connected_at?: string | null;
  details?: Record<string, unknown>;
}

export type ErpStatus = OdooStatus;

export interface ErpConnectField {
  name: string;
  label: string;
  kind: "text" | "password" | "url";
  placeholder: string;
  required: boolean;
}

export interface ErpProviderInfo {
  key: string;
  label: string;
  description: string;
  fields: ErpConnectField[];
  defaults: Record<string, string>;
  supports_writes: boolean;
  supports_bank_balances: boolean;
}

export async function getErpProviders(): Promise<{ providers: ErpProviderInfo[]; default: string }> {
  const res = await apiClient.get(`${PREFIX}/providers`);
  return res.data;
}

export async function connectErp(provider: string, values: Record<string, string>): Promise<OdooStatus> {
  const res = await apiClient.post(`${PREFIX}/connect`, { provider, values });
  return res.data;
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

export interface OdooBankAccountBalance {
  journal: string;
  type: string;
  account: string;
  balance: number;
}

export interface OdooBankBalance {
  accounts: OdooBankAccountBalance[];
  currency: string;
  total: number;
}

export async function getOdooBankBalance(): Promise<OdooBankBalance> {
  const res = await apiClient.get(`${PREFIX}/bank-balance`);
  return res.data;
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

export type OdooWriteAction =
  | "confirm_quotation"
  | "register_payment"
  | "create_lead"
  | "log_note"
  | "update_field"
  | "create_contact";

export interface OdooProposeResult {
  approval_id: string;
  title: string;
  risk_level: string;
}

export async function proposeOdooAction(
  action: OdooWriteAction,
  params: Record<string, unknown>,
): Promise<OdooProposeResult> {
  const res = await apiClient.post(`${PREFIX}/actions/propose`, { action, params });
  return res.data;
}
