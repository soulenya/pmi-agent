import type { AccessTokenResponse, HealthCheck, LoginResponse, User } from "@/types";
import { apiClient } from "./client";

export async function login(email: string, password: string): Promise<LoginResponse> {
  const resp = await apiClient.post<LoginResponse>("/auth/login", { email, password });
  return resp.data;
}

export async function refreshAccessToken(refreshToken: string): Promise<AccessTokenResponse> {
  const resp = await apiClient.post<AccessTokenResponse>("/auth/refresh", {
    refresh_token: refreshToken,
  });
  return resp.data;
}

export async function logout(refreshToken: string): Promise<void> {
  await apiClient.post("/auth/logout", { refresh_token: refreshToken });
}

export async function getMe(): Promise<User> {
  const resp = await apiClient.get<User>("/auth/me");
  return resp.data;
}

export async function getHealth(): Promise<HealthCheck> {
  const resp = await apiClient.get<HealthCheck>("/health");
  return resp.data;
}

export async function googleInitiate(): Promise<{ auth_id: string }> {
  const resp = await apiClient.post<{ auth_id: string }>("/auth/google/initiate");
  return resp.data;
}

export type GooglePollResult =
  | { status: "pending" }
  | { status: "error"; message: string }
  | { status: "success"; access_token: string; refresh_token: string; expires_in: number; user: User };

export async function googlePoll(authId: string): Promise<GooglePollResult> {
  const resp = await apiClient.get<GooglePollResult>(`/auth/google/poll/${authId}`);
  return resp.data;
}

export interface CredentialsStatus {
  present: boolean;
  download_available: boolean;
}

/** Whether the Google OAuth client file exists and whether a download is offered. */
export async function getCredentialsStatus(): Promise<CredentialsStatus> {
  const resp = await apiClient.get<CredentialsStatus>("/auth/credentials-status");
  return resp.data;
}

/** Download the company google_credentials.json and place it in the backend folder. */
export async function fetchCredentials(): Promise<{ ok: boolean; path: string }> {
  const resp = await apiClient.post<{ ok: boolean; path: string }>("/auth/credentials/fetch");
  return resp.data;
}
