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
