/**
 * Financial data, read-only, for people on the finance list. Kept on the hub:
 * a desktop reaches it through the hub proxy, a browser on the hub directly.
 */
import { apiClient } from "@/api/client";

const F = "/hub/api/finance";

export interface FinanceAccess {
  can_view: boolean;
  /** May change who is on the finance list. */
  can_manage: boolean;
  viewers: string[];
  /** sandbox | certification | production. Anything but production is test data. */
  environment: string;
  bank_configured: boolean;
  last_synced: string | null;
}

export interface BankAccount {
  id: string;
  name: string;
  last4: string;
  account_type: string;
  bank_name: string;
  currency: string;
  ledger_balance: number | null;
  available_balance: number | null;
  balance_as_of: string | null;
  synced_at: string | null;
}

export interface BankTransaction {
  id: string;
  account_id: string;
  account: string;
  posted_on: string;
  /** Signed: money in is positive. */
  amount: number;
  currency: string;
  kind: string;
  description: string;
  counterparty: string;
  reference: string;
}

export interface SyncReport {
  environment: string;
  accounts: number;
  new_transactions: number;
  skipped: { account: string; reason: string }[];
}

export async function getFinanceAccess(): Promise<FinanceAccess> {
  return (await apiClient.get<FinanceAccess>(`${F}/access`)).data;
}

export async function setFinanceViewers(emails: string[]): Promise<void> {
  await apiClient.put(`${F}/viewers`, { emails });
}

export async function listBankAccounts(): Promise<BankAccount[]> {
  return (await apiClient.get<BankAccount[]>(`${F}/bank/accounts`)).data;
}

export async function listBankTransactions(params: { account_id?: string; q?: string }): Promise<BankTransaction[]> {
  return (await apiClient.get<BankTransaction[]>(`${F}/bank/transactions`, { params })).data;
}

export async function syncBank(): Promise<SyncReport> {
  return (await apiClient.post<SyncReport>(`${F}/bank/sync`, null, { timeout: 180_000 })).data;
}

// ── QuickBooks: the accountants' books, read-only ────────────────────────────

const Q = `${F}/quickbooks`;

export interface QuickBooksStatus {
  /** sandbox | production. A sandbox company is test data. */
  environment: string;
  /** The Intuit app's keys are on the server. */
  configured: boolean;
  keys_source: "server" | "keyring" | "app" | null;
  can_save_keys: boolean;
  /** The address that has to be listed in the Intuit app. */
  redirect_uri: string;
  connected: boolean;
  needs_reconnect: boolean;
  company_name: string;
  connected_at: string | null;
  connected_by: string | null;
}

export interface ReportLine {
  kind: "section" | "row" | "total";
  depth: number;
  cells: string[];
}

export interface QuickBooksReport {
  report: string;
  title: string;
  kind: "period" | "as_of";
  start: string | null;
  end: string;
  company: string;
  environment: string;
  columns: string[];
  lines: ReportLine[];
  basis: string;
  currency: string;
}

export interface QuickBooksList {
  dataset: string;
  title: string;
  columns: { key: string; label: string; kind: "text" | "date" | "money" }[];
  rows: Record<string, string | number | null>[];
  total: number;
  capped: boolean;
  since: string | null;
  company: string;
  environment: string;
}

export async function getQuickBooksStatus(): Promise<QuickBooksStatus> {
  return (await apiClient.get<QuickBooksStatus>(`${Q}/status`)).data;
}

export async function saveQuickBooksKeys(body: {
  client_id: string;
  client_secret: string;
  environment: string;
}): Promise<QuickBooksStatus> {
  return (await apiClient.put<QuickBooksStatus>(`${Q}/keys`, body)).data;
}

/** The Intuit address where the person approves the connection. */
export async function startQuickBooksConnect(): Promise<string> {
  return (await apiClient.post<{ url: string }>(`${Q}/connect`)).data.url;
}

export async function disconnectQuickBooks(): Promise<void> {
  await apiClient.post(`${Q}/disconnect`);
}

export async function getQuickBooksReport(
  name: string,
  params: { start?: string; end?: string; by?: string },
): Promise<QuickBooksReport> {
  return (await apiClient.get<QuickBooksReport>(`${Q}/reports/${name}`, { params, timeout: 60_000 })).data;
}

export async function getQuickBooksList(
  dataset: string,
  params: { search?: string; days?: number; limit?: number },
): Promise<QuickBooksList> {
  return (await apiClient.get<QuickBooksList>(`${Q}/lists/${dataset}`, { params, timeout: 60_000 })).data;
}
