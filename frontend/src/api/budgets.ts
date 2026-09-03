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

export interface BudgetFolder {
  id: string;
  kind: "invoice" | "receipt";
  folder_id: string;
  folder_name: string;
  folder_url: string;
  auto_scan: boolean;
  last_scan_at: string | null;
  files_scanned: number;
  extracted_total: number;
}

export interface FolderScanSummary {
  scanned: number;
  suggested: number;
  no_amount: number;
  errors: number;
  remaining: number;
  skipped_unsupported: number;
  total_extracted: number;
}

export interface BudgetReference {
  id: string;
  ref_budget_id: string;
  ref_title: string;
  include_as_entry: boolean;
  total_spent: number;
  allotment: number | null;
  remaining: number | null;
  entry_count: number;
  external_readonly: boolean;
}

export interface OdooCompareResult {
  budget: {
    title: string;
    total_spent: number;
    allotment: number | null;
    remaining: number | null;
    entry_count: number;
    currency: string;
  };
  odoo: {
    label: string;
    search?: string;
    total: number | null;
    count: number;
    rows: string[];
    currency?: string;
  };
  advisory: string;
}

export interface Budget {
  id: string;
  title: string;
  drive_file_id: string;
  drive_url: string;
  allotment: number | null;
  currency: string;
  project_id: string | null;
  gerry_write_enabled: boolean;
  gmail_check_enabled: boolean;
  external_readonly: boolean;
  cached_summary: BudgetSummary;
  cached_at: string | null;
  created_at: string;
}

/** A budget as the project shows it: the figures, without the owner's controls. */
export interface ProjectBudget {
  id: string;
  title: string;
  currency: string;
  allotment: number | null;
  drive_url: string;
  cached_summary: BudgetSummary;
  cached_at: string | null;
  is_mine: boolean;
}

export async function listProjectBudgets(projectId: string): Promise<ProjectBudget[]> {
  const { data } = await apiClient.get<ProjectBudget[]>(`/projects/${projectId}/budgets`);
  return data;
}

export interface BudgetDetail extends Budget {
  cached_ledger: BudgetEntry[];
  cached_categories: BudgetCategory[];
  folders: BudgetFolder[];
  references: BudgetReference[];
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
    gmail_check_enabled?: boolean;
    project_id?: string | null;
    clear_project?: boolean;
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

// ── Linked folders (read-only to Gerry) ────────────────────────────

export async function linkBudgetFolder(
  id: string,
  body: { kind: "invoice" | "receipt"; ref: string },
): Promise<BudgetFolder> {
  const { data } = await apiClient.post<BudgetFolder>(`/budgets/${id}/folders`, body);
  return data;
}

export async function updateBudgetFolder(
  id: string,
  folderRowId: string,
  body: { auto_scan?: boolean },
): Promise<BudgetFolder> {
  const { data } = await apiClient.patch<BudgetFolder>(
    `/budgets/${id}/folders/${folderRowId}`,
    body,
  );
  return data;
}

export async function unlinkBudgetFolder(id: string, folderRowId: string): Promise<void> {
  await apiClient.delete(`/budgets/${id}/folders/${folderRowId}`);
}

export async function scanBudgetFolder(
  id: string,
  folderRowId: string,
): Promise<FolderScanSummary> {
  const { data } = await apiClient.post<FolderScanSummary>(
    `/budgets/${id}/folders/${folderRowId}/scan`,
  );
  return data;
}

// ── Cross-budget references ─────────────────────────────────────

export async function addBudgetReference(
  id: string,
  body: { ref_budget_id: string; include_as_entry: boolean },
): Promise<void> {
  await apiClient.post(`/budgets/${id}/references`, body);
}

export async function removeBudgetReference(
  id: string,
  referenceId: string,
  removeRow: boolean,
): Promise<{ row_removed: boolean }> {
  const { data } = await apiClient.delete<{ removed: string; row_removed: boolean }>(
    `/budgets/${id}/references/${referenceId}`,
    { params: { remove_row: removeRow } },
  );
  return data;
}

// ── Odoo cross-check (advisory, read-only) ───────────────────────────

export async function compareBudgetToOdoo(
  id: string,
  body: { dataset: string; search?: string },
): Promise<OdooCompareResult> {
  const { data } = await apiClient.post<OdooCompareResult>(`/budgets/${id}/odoo-compare`, body);
  return data;
}
