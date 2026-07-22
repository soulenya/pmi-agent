import { apiClient } from "./client";

// ── Budgets — personal Drive-backed budgets (Sheet = system of record) ──────

export interface BudgetEntry {
  row: number;
  date: string;
  description: string;
  category: string;
  amount: number | null;
  source: string;
  note: string;
}

export interface BudgetCategory {
  name: string;
  cap: number | null;
}

export interface BudgetSummary {
  total_spent?: number;
  allotment?: number | null;
  remaining?: number | null;
  by_category?: Record<string, number>;
  entry_count?: number;
}

export interface Budget {
  id: string;
  title: string;
  drive_file_id: string;
  drive_url: string;
  allotment: number | null;
  currency: string;
  gerry_write_enabled: boolean;
  external_readonly: boolean;
  cached_summary: BudgetSummary;
  cached_at: string | null;
  created_at: string;
}

export interface BudgetDetail extends Budget {
  cached_ledger: BudgetEntry[];
  cached_categories: BudgetCategory[];
}

export async function listBudgets(): Promise<Budget[]> {
  const { data } = await apiClient.get<Budget[]>("/budgets");
  return data;
}

export async function createBudget(body: {
  title: string;
  allotment?: number | null;
  currency?: string;
  categories?: string[];
}): Promise<BudgetDetail> {
  const { data } = await apiClient.post<BudgetDetail>("/budgets", body);
  return data;
}

export async function linkBudget(fileId: string): Promise<BudgetDetail> {
  const { data } = await apiClient.post<BudgetDetail>("/budgets/link", { file_id: fileId });
  return data;
}

export async function getBudget(id: string): Promise<BudgetDetail> {
  const { data } = await apiClient.get<BudgetDetail>(`/budgets/${id}`);
  return data;
}

export async function refreshBudget(id: string): Promise<BudgetDetail> {
  const { data } = await apiClient.post<BudgetDetail>(`/budgets/${id}/refresh`);
  return data;
}

export async function updateBudget(
  id: string,
  body: {
    title?: string;
    allotment?: number;
    clear_allotment?: boolean;
    gerry_write_enabled?: boolean;
  },
): Promise<BudgetDetail> {
  const { data } = await apiClient.patch<BudgetDetail>(`/budgets/${id}`, body);
  return data;
}

export async function unlinkBudget(id: string): Promise<{ sheet_kept_at: string }> {
  const { data } = await apiClient.delete<{ unlinked: string; sheet_kept_at: string }>(
    `/budgets/${id}`,
  );
  return data;
}

export async function addBudgetEntry(
  id: string,
  entry: { date?: string; description: string; category?: string; amount: number; note?: string },
): Promise<BudgetDetail> {
  const { data } = await apiClient.post<BudgetDetail>(`/budgets/${id}/entries`, entry);
  return data;
}

export async function updateBudgetEntry(
  id: string,
  row: number,
  body: {
    expected: { description?: string; amount?: number | null };
    date?: string;
    description?: string;
    category?: string;
    amount?: number;
    note?: string;
  },
): Promise<BudgetDetail> {
  const { data } = await apiClient.patch<BudgetDetail>(`/budgets/${id}/entries/${row}`, body);
  return data;
}

export async function deleteBudgetEntry(
  id: string,
  row: number,
  expected: { description?: string; amount?: number | null },
): Promise<BudgetDetail> {
  const { data } = await apiClient.post<BudgetDetail>(`/budgets/${id}/entries/${row}/delete`, {
    expected,
  });
  return data;
}
