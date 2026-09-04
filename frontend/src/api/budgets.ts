import { apiClient } from "./client";
import type { Source } from "./tasks";

/** A hub project's budget lives on the hub, so its reads go through the proxy. */
function at(source: Source, path: string): string {
  return source === "hub" ? `/hub/api${path}` : path;
}

// ── Budgets — personal Drive-backed budgets (Sheet = system of record) ──────

/**
 * Whether a ledger line has actually happened, and which way the money goes.
 *
 *   Spent      out, already gone
 *   Allocated  out, committed but not yet paid
 *   Collected  in, already received
 *   Expected   in, invoiced or forecast but not yet collected
 *
 * Rows written before this existed have no status and count as Spent.
 */
export type EntryStatus = "Spent" | "Allocated" | "Collected" | "Expected";

export const ENTRY_STATUSES: EntryStatus[] = ["Spent", "Allocated", "Collected", "Expected"];

/** Money leaving the budget. The rest is money arriving. */
export function isOutgoing(status: EntryStatus): boolean {
  return status === "Spent" || status === "Allocated";
}

/** Promised rather than settled. */
export function isPlanned(status: EntryStatus): boolean {
  return status === "Allocated" || status === "Expected";
}

export interface BudgetEntry {
  row: number;
  date: string;
  description: string;
  category: string;
  amount: number | null;
  source: string;
  note: string;
  status?: EntryStatus;
}

export interface BudgetCategory {
  name: string;
  cap: number | null;
}

export interface BudgetSummary {
  /** Money actually gone. */
  total_spent?: number;
  /** Money committed but not yet paid. */
  total_allocated?: number;
  /** Money actually received. */
  total_collected?: number;
  /** Money invoiced or forecast but not yet in. */
  total_expected?: number;
  /** total_spent + total_allocated. */
  committed?: number;
  allotment?: number | null;
  /** allotment − spent − allocated: what is still free to promise. */
  remaining?: number | null;
  by_category?: Record<string, number>;
  by_status?: Partial<Record<EntryStatus, number>>;
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
  total_allocated?: number;
  total_collected?: number;
  total_expected?: number;
  committed?: number;
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
  external_readonly?: boolean;
}

/** The same, with the ledger — what everyone on the project may read. */
export interface ProjectBudgetDetail extends ProjectBudget {
  cached_ledger: BudgetEntry[];
  cached_categories: BudgetCategory[];
  references: BudgetReference[];
}

export async function listProjectBudgets(
  projectId: string,
  source: Source = "local",
): Promise<ProjectBudget[]> {
  const { data } = await apiClient.get<ProjectBudget[]>(
    at(source, `/projects/${projectId}/budgets`),
  );
  return data;
}

/**
 * One attached budget's ledger, readable by anyone on the project.
 *
 * Serves the cached copy only. Refreshing from Drive needs the owner's Google
 * credentials, so that stays on the owner's own route.
 */
export async function getProjectBudget(
  projectId: string,
  budgetId: string,
  source: Source = "local",
): Promise<ProjectBudgetDetail> {
  const { data } = await apiClient.get<ProjectBudgetDetail>(
    at(source, `/projects/${projectId}/budgets/${budgetId}`),
  );
  return data;
}

export interface BudgetDetail extends Budget {
  cached_ledger: BudgetEntry[];
  cached_categories: BudgetCategory[];
  folders: BudgetFolder[];
  references: BudgetReference[];
}

export async function listBudgets(source: Source = "local"): Promise<Budget[]> {
  const { data } = await apiClient.get<Budget[]>(at(source, "/budgets"));
  return data;
}

export async function createBudget(
  body: {
    title: string;
    allotment?: number | null;
    currency?: string;
    categories?: string[];
  },
  source: Source = "local",
): Promise<BudgetDetail> {
  const { data } = await apiClient.post<BudgetDetail>(at(source, "/budgets"), body);
  return data;
}

export async function linkBudget(
  fileId: string,
  source: Source = "local",
): Promise<BudgetDetail> {
  const { data } = await apiClient.post<BudgetDetail>(at(source, "/budgets/link"), {
    file_id: fileId,
  });
  return data;
}

export async function getBudget(id: string, source: Source = "local"): Promise<BudgetDetail> {
  const { data } = await apiClient.get<BudgetDetail>(at(source, `/budgets/${id}`));
  return data;
}

export async function refreshBudget(id: string, source: Source = "local"): Promise<BudgetDetail> {
  const { data } = await apiClient.post<BudgetDetail>(at(source, `/budgets/${id}/refresh`));
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
  source: Source = "local",
): Promise<BudgetDetail> {
  const { data } = await apiClient.patch<BudgetDetail>(at(source, `/budgets/${id}`), body);
  return data;
}

export async function unlinkBudget(
  id: string,
  source: Source = "local",
): Promise<{ sheet_kept_at: string }> {
  const { data } = await apiClient.delete<{ unlinked: string; sheet_kept_at: string }>(
    at(source, `/budgets/${id}`),
  );
  return data;
}

export async function addBudgetEntry(
  id: string,
  entry: {
    date?: string;
    description: string;
    category?: string;
    amount: number;
    note?: string;
    status?: EntryStatus;
  },
  source: Source = "local",
): Promise<BudgetDetail> {
  const { data } = await apiClient.post<BudgetDetail>(at(source, `/budgets/${id}/entries`), entry);
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
    status?: EntryStatus;
  },
  source: Source = "local",
): Promise<BudgetDetail> {
  const { data } = await apiClient.patch<BudgetDetail>(
    at(source, `/budgets/${id}/entries/${row}`),
    body,
  );
  return data;
}

export async function deleteBudgetEntry(
  id: string,
  row: number,
  expected: { description?: string; amount?: number | null },
  source: Source = "local",
): Promise<BudgetDetail> {
  const { data } = await apiClient.post<BudgetDetail>(
    at(source, `/budgets/${id}/entries/${row}/delete`),
    { expected },
  );
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
  source: Source = "local",
): Promise<void> {
  await apiClient.post(at(source, `/budgets/${id}/references`), body);
}

export async function removeBudgetReference(
  id: string,
  referenceId: string,
  removeRow: boolean,
  source: Source = "local",
): Promise<{ row_removed: boolean }> {
  const { data } = await apiClient.delete<{ removed: string; row_removed: boolean }>(
    at(source, `/budgets/${id}/references/${referenceId}`),
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
