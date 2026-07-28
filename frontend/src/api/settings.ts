import { apiClient } from "./client";
import type { User } from "@/types";

export interface AppSettings {
  llm_provider: string;
  llm_model: string;
  ollama_url: string;
  embedding_model: string;
  embedding_provider: string;
  embedding_dimension: number;
  reindex_required: boolean;
  theme: string;
  timezone: string;
  notifications_email_enabled: boolean;
  voice_speak_replies: boolean;
  voice_voice_name: string;
  openai_key_set: boolean;
  anthropic_key_set: boolean;
  voyage_key_set: boolean;
  google_key_set: boolean;
}

export interface SettingsUpdate {
  llm_provider?: string;
  llm_model?: string;
  ollama_url?: string;
  embedding_model?: string;
  embedding_provider?: string;
  theme?: string;
  timezone?: string;
  notifications_email_enabled?: boolean;
  voice_speak_replies?: boolean;
  voice_voice_name?: string;
  openai_api_key?: string;
  anthropic_api_key?: string;
  voyage_api_key?: string;
  google_api_key?: string;
}

export interface ProfileUpdate {
  display_name?: string;
  current_password?: string;
  new_password?: string;
}

export interface TestConnectionResult {
  ok: boolean;
  message: string;
}

export async function getSettings(): Promise<AppSettings> {
  const resp = await apiClient.get<AppSettings>("/settings");
  return resp.data;
}

export async function updateSettings(body: SettingsUpdate): Promise<AppSettings> {
  const resp = await apiClient.put<AppSettings>("/settings", body);
  return resp.data;
}

// ── Company context (Drive-backed, read-only cache) ─────────────────────────

export interface CompanyContext {
  content: string;
  synced_at: string | null;
  drive_file_id: string | null;
  source_kind: "file" | "folder";
  sections: { name: string; file_id: string; chars: number; skipped?: string }[];
}

export interface SystemNotice {
  id: string;
  severity: "error" | "warning" | "info";
  title: string;
  message: string;
  route: string;
}

export async function getSystemNotices(): Promise<SystemNotice[]> {
  const resp = await apiClient.get<{ notices: SystemNotice[] }>("/settings/notices");
  return resp.data.notices;
}

export interface CompanyContextRefreshResult extends CompanyContext {
  ok: boolean;
  error: string | null;
}

export async function getCompanyContext(): Promise<CompanyContext> {
  const resp = await apiClient.get<CompanyContext>("/settings/company-context");
  return resp.data;
}

export async function refreshCompanyContext(): Promise<CompanyContextRefreshResult> {
  const resp = await apiClient.post<CompanyContextRefreshResult>(
    "/settings/company-context/refresh",
    undefined,
    { timeout: 60_000 },
  );
  return resp.data;
}

export async function setCompanyContextFileId(
  fileId: string,
): Promise<CompanyContextRefreshResult> {
  const resp = await apiClient.put<CompanyContextRefreshResult>(
    "/settings/company-context/file-id",
    { file_id: fileId },
    { timeout: 60_000 },
  );
  return resp.data;
}

/**
 * Read a persisted client UI-state value. Backed by the server (Postgres) so it
 * survives installer updates that reset the embedded webview's localStorage.
 */
export async function getClientState<T = unknown>(key: string): Promise<T | null> {
  const resp = await apiClient.get<{ value: T | null }>(`/settings/client-state/${key}`);
  return resp.data?.value ?? null;
}

export async function setClientState(key: string, value: unknown): Promise<void> {
  await apiClient.put(`/settings/client-state/${key}`, { value });
}

export async function testConnection(provider: string): Promise<TestConnectionResult> {
  const resp = await apiClient.post<TestConnectionResult>("/settings/test-connection", { provider });
  return resp.data;
}

export async function getMyProfile(): Promise<User> {
  const resp = await apiClient.get<User>("/settings/me");
  return resp.data;
}

export async function updateMyProfile(body: ProfileUpdate): Promise<User> {
  const resp = await apiClient.put<User>("/settings/me", body);
  return resp.data;
}

/** Mark the first-use setup wizard as completed for the current user (one-time). */
export async function completeOnboarding(): Promise<User> {
  const resp = await apiClient.post<User>("/settings/onboarding/complete");
  return resp.data;
}

export interface HealthCheckResult {
  status: string;
  timestamp: string;
  checks: {
    database?: { status: string; detail?: string };
    /** Active LLM provider health (replaces legacy "ollama" key). */
    llm?: { status: string; provider?: string; model?: string; detail?: string };
    /** Embedding provider health — added in Phase 3. */
    embedding?: { status: string; provider?: string; model?: string; dimension?: number; detail?: string };
    /** Legacy key kept for backward-compat — prefer `llm`. */
    ollama?: { status: string; detail?: string };
    disk?: { status: string; free_gb?: number; detail?: string };
    kb_needs_reindex?: boolean;
  };
}

export interface SettingsHealthResult {
  llm: { status: string; provider: string; model: string; detail?: string };
  embedding: { status: string; provider: string; model: string; dimension?: number; detail?: string };
  kb_needs_reindex: boolean;
}

export interface AiOptions {
  llm: Record<string, string[]>;
  embedding: Record<string, string[]>;
  /** Models first seen within the last two weeks (badge as NEW). */
  new_models?: string[];
  /** ISO timestamp of the last model catalog scan. */
  updated_at?: string | null;
}

export interface TaskModel {
  task: string;
  label: string;
  description: string;
  recommended_provider: string;
  recommended_model: string;
  recommended_reason: string;
  override_provider: string | null;
  override_model: string | null;
  effective_provider: string;
  effective_model: string;
}

export interface TaskModelUpdate {
  task: string;
  provider?: string;
  model?: string;
}

export async function getTaskModels(): Promise<TaskModel[]> {
  const resp = await apiClient.get<TaskModel[]>("/settings/task-models");
  return resp.data;
}

export async function updateTaskModel(body: TaskModelUpdate): Promise<TaskModel[]> {
  const resp = await apiClient.put<TaskModel[]>("/settings/task-models", body);
  return resp.data;
}

export async function refreshModels(): Promise<{ updated_at: string; llm_providers: string[]; embedding_providers: string[] }> {
  const resp = await apiClient.post("/settings/refresh-models");
  return resp.data;
}

export async function getSystemHealth(): Promise<HealthCheckResult> {
  const resp = await apiClient.get<HealthCheckResult>("/health");
  return resp.data;
}

export async function getSettingsHealth(): Promise<SettingsHealthResult> {
  const resp = await apiClient.get<SettingsHealthResult>("/settings/health");
  return resp.data;
}

export async function getAiOptions(): Promise<AiOptions> {
  const resp = await apiClient.get<AiOptions>("/settings/ai-options");
  return resp.data;
}

export interface UpdateStatus {
  current_sha: string;
  latest_sha: string;
  latest_message: string;
  latest_date: string;
  up_to_date: boolean;
}

export interface UpdateResult {
  success: boolean;
  message: string;
}

export async function checkForUpdate(): Promise<UpdateStatus> {
  const resp = await apiClient.get<UpdateStatus>("/update/check");
  return resp.data;
}

export async function applyUpdate(): Promise<UpdateResult> {
  const resp = await apiClient.post<UpdateResult>("/update/apply");
  return resp.data;
}

export async function getOllamaModels(): Promise<string[]> {
  const resp = await apiClient.get<{ models: string[] }>("/settings/ollama-models");
  return resp.data.models;
}

export async function getAnthropicModels(): Promise<string[]> {
  const resp = await apiClient.get<{ models: string[] }>("/settings/anthropic-models");
  return resp.data.models;
}
