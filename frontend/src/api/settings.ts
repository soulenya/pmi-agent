import { apiClient } from "./client";
import type { User } from "@/types";

export interface AppSettings {
  llm_provider: string;
  llm_model: string;
  ollama_url: string;
  embedding_model: string;
  theme: string;
  timezone: string;
  notifications_email_enabled: boolean;
  openai_key_set: boolean;
  anthropic_key_set: boolean;
}

export interface SettingsUpdate {
  llm_provider?: string;
  llm_model?: string;
  ollama_url?: string;
  embedding_model?: string;
  theme?: string;
  timezone?: string;
  notifications_email_enabled?: boolean;
  openai_api_key?: string;
  anthropic_api_key?: string;
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
