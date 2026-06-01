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
