import { apiClient } from "./client";
import type { User } from "@/types";

export interface AppSettings {
  llm_provider: string;
  llm_model: string;
  ollama_url: string;
  embedding_model: string;
  embedding_provider: string;
  theme: string;
  timezone: string;
  notifications_email_enabled: boolean;
  openai_key_set: boolean;
  anthropic_key_set: boolean;
  voyage_key_set: boolean;
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
  openai_api_key?: string;
  anthropic_api_key?: string;
  voyage_api_key?: string;
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

export interface HealthCheckResult {
  status: string;
  timestamp: string;
  checks: {
    database?: { status: string; detail?: string };
    /** Active LLM provider health (replaces legacy "ollama" key). */
    llm?: { status: string; provider?: string; detail?: string };
    /** Legacy key kept for backward-compat — prefer `llm`. */
    ollama?: { status: string; detail?: string };
    disk?: { status: string; free_gb?: number; detail?: string };
  };
}

export async function getSystemHealth(): Promise<HealthCheckResult> {
  const resp = await apiClient.get<HealthCheckResult>("/health");
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
