import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { googleInitiate, googlePoll, getCredentialsStatus, fetchCredentials } from "@/api/auth";
import type { CredentialsStatus } from "@/api/auth";
import { useAuthStore } from "@/stores/authStore";
import { SetupWizard } from "@/components/SetupWizard";
import { cn } from "@/lib/utils";
import { Loader2, CheckCircle2, XCircle, Download } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000";

type BackendStatus = "checking" | "ready" | "down";
type SsoState = "idle" | "waiting" | "error";

/** Poll /health until the backend is up — with inflight guard to avoid overlapping requests. */
function useBackendStatus(): BackendStatus {
  const [status, setStatus] = useState<BackendStatus>("checking");
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const inflightRef = useRef(false);

  async function check() {
    if (inflightRef.current) return;   // skip if a request is already in-flight
    inflightRef.current = true;
    try {
      await axios.get(`${API_BASE}/health`, { timeout: 6000 });
      setStatus("ready");
      if (timerRef.current) clearInterval(timerRef.current);
    } catch {
      setStatus("down");
    } finally {
      inflightRef.current = false;
    }
  }

  useEffect(() => {
    check();
    timerRef.current = setInterval(check, 5000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return status;
}

/** Pull a human-readable message out of an axios error whose detail may be an object. */
function credErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const detail = err.response?.data?.detail;
    if (typeof detail === "string") return detail;
    if (detail && typeof detail === "object" && "message" in detail) {
      return String((detail as { message: unknown }).message);
    }
    if (!err.response) return "Could not reach the backend.";
  }
  return "Couldn't download the credentials. Please try again.";
}

export function LoginPage() {
  const navigate = useNavigate();
  const { setTokens, setUser } = useAuthStore();
  const backendStatus = useBackendStatus();

  const [ssoState, setSsoState] = useState<SsoState>("idle");
  const [ssoError, setSsoError] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const authIdRef = useRef<string | null>(null);

  // Company Google OAuth credentials (the file needed before anyone can sign in).
  const [creds, setCreds] = useState<CredentialsStatus | null>(null);
  const [fetchingCreds, setFetchingCreds] = useState(false);
  const [credError, setCredError] = useState<string | null>(null);

  // Once the backend is up, check whether the OAuth client file is present.
  useEffect(() => {
    if (backendStatus !== "ready") return;
    let cancelled = false;
    getCredentialsStatus()
      .then((s) => { if (!cancelled) setCreds(s); })
      .catch(() => { if (!cancelled) setCreds(null); });
    return () => { cancelled = true; };
  }, [backendStatus]);

  async function handleDownloadCreds() {
    setCredError(null);
    setFetchingCreds(true);
    try {
      await fetchCredentials();
      const s = await getCredentialsStatus();
      setCreds(s);
    } catch (err) {
      setCredError(credErrorMessage(err));
    } finally {
      setFetchingCreds(false);
    }
  }

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    authIdRef.current = null;
  }

  useEffect(() => () => stopPolling(), []);

  async function handleSignIn() {
    if (backendStatus !== "ready") return;
    setSsoError(null);
    setSsoState("waiting");

    try {
      const { auth_id } = await googleInitiate();
      authIdRef.current = auth_id;

      pollRef.current = setInterval(async () => {
        const currentAuthId = authIdRef.current;
        if (!currentAuthId) return;

        try {
          const result = await googlePoll(currentAuthId);

          if (result.status === "pending") return; // still waiting

          stopPolling();

          if (result.status === "error") {
            setSsoError(result.message);
            setSsoState("error");
            return;
          }

          // success
          setTokens(result.access_token, result.refresh_token);
          setUser(result.user);

          // Show the one-time setup wizard on first use (per-user flag).
          if (!result.user.onboarding_complete) {
            setShowSetup(true);
            return; // don't navigate yet
          }

          navigate("/");
        } catch {
          stopPolling();
          setSsoError("Lost connection to backend while waiting for sign-in.");
          setSsoState("error");
        }
      }, 2000);

    } catch (err) {
      setSsoState("error");
      if (axios.isAxiosError(err) && !err.response) {
        setSsoError("Could not reach the backend. Check the service status below.");
      } else {
        setSsoError("Failed to start sign-in. Please try again.");
      }
    }
  }

  function handleRetry() {
    stopPolling();
    setSsoState("idle");
    setSsoError(null);
  }

  const buttonDisabled = ssoState === "waiting" || backendStatus !== "ready";

  // Credentials are "missing" only once the backend has confirmed their absence.
  const credentialsMissing = backendStatus === "ready" && creds !== null && !creds.present;
  const signInDisabled = buttonDisabled || credentialsMissing;

  return (
    <>
      {showSetup && <SetupWizard onComplete={() => navigate("/")} />}
      <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm rounded-lg border bg-card p-8 shadow-md">
        <h1 className="mb-1 text-2xl font-bold">Little Gerry</h1>
        <p className="mb-6 text-sm text-muted-foreground">Sign in with your company account</p>

        {/* Backend status indicator */}
        <div className={cn(
          "mb-6 flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium",
          backendStatus === "ready"    && "bg-green-500/10 text-green-700 dark:text-green-400",
          backendStatus === "down"     && "bg-destructive/10 text-destructive",
          backendStatus === "checking" && "bg-muted text-muted-foreground",
        )}>
          {backendStatus === "checking" && <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />}
          {backendStatus === "ready"    && <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
          {backendStatus === "down"     && <XCircle className="h-3.5 w-3.5 shrink-0" />}
          {backendStatus === "checking" && "Connecting to backend…"}
          {backendStatus === "ready"    && "Backend connected"}
          {backendStatus === "down"     && "Backend not reachable — retrying…"}
        </div>

        {/* Missing-credentials helper: download the company OAuth client file. */}
        {credentialsMissing && (
          <div className="mb-6 rounded-md border border-amber-300 bg-amber-50 px-3 py-3 text-xs dark:border-amber-700/50 dark:bg-amber-900/20">
            <p className="mb-2 font-medium text-amber-800 dark:text-amber-300">
              This computer doesn&apos;t have the company Google credentials yet.
            </p>
            {creds?.download_available ? (
              <>
                <p className="mb-3 text-amber-700 dark:text-amber-400/90">
                  Download them once to enable sign-in. Little Gerry places the file
                  in the right folder for you — no manual move needed.
                </p>
                <button
                  onClick={handleDownloadCreds}
                  disabled={fetchingCreds}
                  className={cn(
                    "flex w-full items-center justify-center gap-2 rounded-md border border-amber-400 bg-background px-4 py-2 text-sm font-semibold text-amber-800 shadow-sm transition-opacity dark:text-amber-300",
                    fetchingCreds ? "opacity-60 cursor-not-allowed" : "hover:bg-accent",
                  )}
                >
                  {fetchingCreds ? (
                    <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                  ) : (
                    <Download className="h-4 w-4 shrink-0" />
                  )}
                  {fetchingCreds ? "Downloading…" : "Download credentials"}
                </button>
                {credError && (
                  <p className="mt-2 text-destructive">{credError}</p>
                )}
              </>
            ) : (
              <div className="text-amber-700 dark:text-amber-400/90">
                <p className="mb-1">
                  Ask your administrator for the company{" "}
                  <span className="font-mono">google_credentials.json</span> file and place it here:
                </p>
                <ul className="ml-4 list-disc space-y-0.5">
                  <li>
                    <span className="font-medium">Windows:</span>{" "}
                    <span className="font-mono">%LOCALAPPDATA%\Little Gerry\backend</span>
                  </li>
                  <li>
                    <span className="font-medium">macOS:</span>{" "}
                    <span className="font-mono">~/Applications/Little Gerry/backend</span>
                  </li>
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Sign-in button */}
        <button
          onClick={handleSignIn}
          disabled={signInDisabled}
          className={cn(
            "w-full flex items-center justify-center gap-3 rounded-md border bg-background px-4 py-2.5 text-sm font-semibold shadow-sm transition-opacity",
            signInDisabled && "opacity-60 cursor-not-allowed",
            !signInDisabled && "hover:bg-accent",
          )}
        >
          {ssoState === "waiting" ? (
            <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          ) : (
            <GoogleIcon />
          )}
          {ssoState === "waiting"
            ? "Waiting for browser…"
            : backendStatus === "checking"
            ? "Waiting for backend…"
            : backendStatus === "down"
            ? "Backend not ready"
            : credentialsMissing
            ? "Download credentials to continue"
            : "Sign in with Google"}
        </button>

        {/* Waiting hint */}
        {ssoState === "waiting" && (
          <p className="mt-3 text-center text-xs text-muted-foreground">
            A browser window has opened. Sign in with your{" "}
            <span className="font-medium">@pmi-llc.com</span> or{" "}
            <span className="font-medium">@precisianmedical.com</span> account.
          </p>
        )}

        {/* Error */}
        {ssoState === "error" && ssoError && (
          <div className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <p>{ssoError}</p>
            <button
              onClick={handleRetry}
              className="mt-2 text-xs underline underline-offset-2 hover:opacity-80"
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
    </>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

