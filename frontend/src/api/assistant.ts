import { apiClient } from "./client";

export type SuggestionKind =
  | "followup_email"
  | "followup_task"
  | "task_recommendation"
  | "meeting_import"
  | "workroom_todo"
  | "budget_entry"
  | "gmail_invoice";

export type SuggestionStatus = "pending" | "accepted" | "dismissed" | "completed";

export interface AssistantSuggestion {
  id: string;
  kind: SuggestionKind;
  status: SuggestionStatus;
  title: string;
  summary?: string | null;
  source_type: string;
  source_id: string;
  source_url?: string | null;
  payload: Record<string, unknown>;
  result_entity_type?: string | null;
  result_entity_id?: string | null;
  dismissal_count: number;
  created_at: string;
  resolved_at?: string | null;
}

export interface AssistantSettings {
  enabled: boolean;
  hour_local: number;
  last_run?: string | null;
}

export interface AcceptResult {
  status: string;
  suggestion_id: string;
  task_id?: string | null;
}

export interface ScanResult {
  created: number;
  imported: number;
  skipped?: string | null;
}

export interface BulkResult {
  processed: number;
  skipped: number;
}

/** Lifetime accept/dismiss history for one kind of suggestion. */
export interface KindStats {
  kind: SuggestionKind;
  pending: number;
  accepted: number;
  dismissed: number;
  completed: number;
}

// ── Settings ──────────────────────────────────────────────────────────────────

export async function getAssistantSettings(): Promise<AssistantSettings> {
  const resp = await apiClient.get<AssistantSettings>("/assistant/settings");
  return resp.data;
}

export async function updateAssistantSettings(
  body: Partial<Pick<AssistantSettings, "enabled" | "hour_local">>,
): Promise<AssistantSettings> {
  const resp = await apiClient.put<AssistantSettings>("/assistant/settings", body);
  return resp.data;
}

// ── Suggestions ───────────────────────────────────────────────────────────────

export async function listSuggestions(params?: {
  status?: SuggestionStatus | "all";
  kind?: SuggestionKind;
}): Promise<AssistantSuggestion[]> {
  const resp = await apiClient.get<AssistantSuggestion[]>("/assistant/suggestions", {
    params,
  });
  return resp.data;
}

export async function getPendingSuggestionCount(): Promise<number> {
  const resp = await apiClient.get<{ pending: number }>("/assistant/suggestions/count");
  return resp.data.pending;
}

export async function getSuggestionStats(): Promise<KindStats[]> {
  const resp = await apiClient.get<KindStats[]>("/assistant/suggestions/stats");
  return resp.data;
}

export async function acceptSuggestion(id: string): Promise<AcceptResult> {
  const resp = await apiClient.post<AcceptResult>(`/assistant/suggestions/${id}/accept`);
  return resp.data;
}

export async function dismissSuggestion(id: string): Promise<AcceptResult> {
  const resp = await apiClient.post<AcceptResult>(`/assistant/suggestions/${id}/dismiss`);
  return resp.data;
}

/** Mark a suggestion as already done — it will never be recommended again. */
export async function completeSuggestion(id: string): Promise<AcceptResult> {
  const resp = await apiClient.post<AcceptResult>(`/assistant/suggestions/${id}/complete`);
  return resp.data;
}

/** Complete or dismiss many suggestions in one call. */
export async function bulkResolveSuggestions(
  ids: string[],
  action: "complete" | "dismiss",
): Promise<BulkResult> {
  const resp = await apiClient.post<BulkResult>("/assistant/suggestions/bulk", {
    ids,
    action,
  });
  return resp.data;
}

export async function undoDismissSuggestion(id: string): Promise<AcceptResult> {
  const resp = await apiClient.post<AcceptResult>(
    `/assistant/suggestions/${id}/undo-dismiss`,
  );
  return resp.data;
}

// ── Manual scan ───────────────────────────────────────────────────────────────

export async function triggerAssistantScan(): Promise<ScanResult> {
  const resp = await apiClient.post<ScanResult>("/assistant/scan");
  return resp.data;
}
