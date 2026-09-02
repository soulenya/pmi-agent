import axios from "axios";
import { useAuthStore } from "@/stores/authStore";
import { useToastStore } from "@/stores/toastStore";

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000",
  timeout: 120_000,
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
});

// ── Request interceptor: attach access token ─────────────────────────────────
apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ── Response interceptor: handle 401 by refreshing or clearing session ────────
let isRefreshing = false;
let refreshSubscribers: Array<(token: string) => void> = [];

function subscribeTokenRefresh(cb: (token: string) => void) {
  refreshSubscribers.push(cb);
}

function onRefreshed(token: string) {
  refreshSubscribers.forEach((cb) => cb(token));
  refreshSubscribers = [];
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // A 409 is the server refusing on a rule the person can act on — most often
    // work held by a shared project. Say so, or it reads as a dead button.
    if (error.response?.status === 409) {
      const detail = error.response?.data?.detail;
      if (typeof detail === "string") {
        useToastStore.getState().push("error", detail, 9000);
      }
      return Promise.reject(error);
    }

    if (error.response?.status !== 401 || originalRequest._retry) {
      return Promise.reject(error);
    }

    const refreshToken = useAuthStore.getState().refreshToken;
    if (!refreshToken) {
      useAuthStore.getState().logout();
      return Promise.reject(error);
    }

    if (isRefreshing) {
      return new Promise((resolve) => {
        subscribeTokenRefresh((newToken) => {
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
          resolve(apiClient(originalRequest));
        });
      });
    }

    originalRequest._retry = true;
    isRefreshing = true;

    try {
      const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000";
      const resp = await axios.post(`${API_BASE}/auth/refresh`, {
        refresh_token: refreshToken,
      });
      const newAccessToken: string = resp.data.access_token;
      useAuthStore.getState().setAccessToken(newAccessToken);
      onRefreshed(newAccessToken);
      originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
      return apiClient(originalRequest);
    } catch {
      useAuthStore.getState().logout();
      return Promise.reject(error);
    } finally {
      isRefreshing = false;
    }
  },
);
