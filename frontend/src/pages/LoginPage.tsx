import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { login } from "@/api/auth";
import { useAuthStore } from "@/stores/authStore";
import { cn } from "@/lib/utils";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";

const SAVED_EMAIL_KEY = "pmi-remembered-email";
const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000";

type BackendStatus = "checking" | "ready" | "down";

function classifyError(err: unknown): string {
  if (!axios.isAxiosError(err)) return "Something went wrong — please try again.";
  if (!err.response) {
    return "Could not reach the backend. Check the service status below.";
  }
  const status = err.response.status;
  if (status === 401 || status === 403 || status === 422) {
    return "Invalid email or password.";
  }
  if (status >= 500) {
    const detail = (err.response.data as { detail?: string })?.detail;
    return detail
      ? `Server error: ${detail}`
      : "Server error — try again in a moment.";
  }
  return "Login failed — please try again.";
}

/** Poll /health every 3 s, resolve immediately once the backend is up. */
function useBackendStatus(): BackendStatus {
  const [status, setStatus] = useState<BackendStatus>("checking");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function check() {
    try {
      await axios.get(`${API_BASE}/health`, { timeout: 4000 });
      setStatus("ready");
      if (timerRef.current) clearInterval(timerRef.current);
    } catch {
      setStatus("down");
    }
  }

  useEffect(() => {
    check();
    timerRef.current = setInterval(check, 3000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return status;
}

export function LoginPage() {
  const navigate = useNavigate();
  const { setTokens, setUser } = useAuthStore();
  const backendStatus = useBackendStatus();

  const savedEmail = localStorage.getItem(SAVED_EMAIL_KEY) ?? "";
  const [email, setEmail] = useState(savedEmail);
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(savedEmail !== "");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const formDisabled = loading || backendStatus !== "ready";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (backendStatus !== "ready") return;
    setError(null);
    setLoading(true);
    try {
      const data = await login(email, password);
      if (remember) {
        localStorage.setItem(SAVED_EMAIL_KEY, email);
      } else {
        localStorage.removeItem(SAVED_EMAIL_KEY);
      }
      setTokens(data.access_token, data.refresh_token);
      setUser(data.user);
      navigate("/");
    } catch (err) {
      setError(classifyError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm rounded-lg border bg-card p-8 shadow-md">
        <h1 className="mb-1 text-2xl font-bold">Little Gerry</h1>
        <p className="mb-6 text-sm text-muted-foreground">Sign in to your account</p>

        {/* Backend status indicator */}
        <div className={cn(
          "mb-4 flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium",
          backendStatus === "ready"  && "bg-green-500/10 text-green-700 dark:text-green-400",
          backendStatus === "down"   && "bg-destructive/10 text-destructive",
          backendStatus === "checking" && "bg-muted text-muted-foreground",
        )}>
          {backendStatus === "checking" && <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />}
          {backendStatus === "ready"    && <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
          {backendStatus === "down"     && <XCircle className="h-3.5 w-3.5 shrink-0" />}
          {backendStatus === "checking" && "Connecting to backend…"}
          {backendStatus === "ready"    && "Backend connected"}
          {backendStatus === "down"     && "Backend not reachable — retrying…"}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              disabled={formDisabled}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              disabled={formDisabled}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <div className="flex items-center gap-2">
            <input
              id="remember"
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-4 w-4 rounded border accent-primary"
            />
            <label htmlFor="remember" className="text-sm text-muted-foreground select-none cursor-pointer">
              Remember my email
            </label>
          </div>

          <button
            type="submit"
            disabled={formDisabled}
            className={cn(
              "w-full rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity",
              formDisabled && "opacity-60 cursor-not-allowed",
            )}
          >
            {loading ? "Signing in…"
              : backendStatus === "checking" ? "Waiting for backend…"
              : backendStatus === "down" ? "Backend not ready"
              : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}

