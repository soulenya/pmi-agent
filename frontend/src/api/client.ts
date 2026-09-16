import axios from "axios";
import { useAuthStore } from "@/stores/authStore";
import { useToastStore } from "@/stores/toastStore";

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000",
  timeout: 120_000,
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
});

// ── Where we are ───────────────────────────────────────────────────────────────────
// Shared work is addressed as /hub/api/<path>, which on a desktop is a proxy
// to the hub. When this app IS the hub there is no proxy: the same rows are
// served at <path>. Remembered across reloads so the first requests of a
// session are already right.
const ON_HUB_KEY = "lg.onHub";
let onHub = typeof localStorage !== "undefined" && localStorage.getItem(ON_HUB_KEY) === "1";

export function setOnHub(value: boolean): void {
  onHub = value;
  try {
    if (value) localStorage.setItem(ON_HUB_KEY, "1");
    else localStorage.removeItem(ON_HUB_KEY);
  } catch {
    /* storage unavailable */
  }
}

export function isOnHub(): boolean {
  return onHub;
}

// ── Request interceptor: attach access token ─────────────────────────────────────
apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  if (onHub && config.url && /^\/hub\/api(\/|$)/.test(config.url)) {
    config.url = config.url.slice("/hub/api".length) || "/";
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
