/**
 * First-Use Setup Wizard
 *
 * A one-time, guided onboarding shown after the very first successful login
 * (while `user.onboarding_complete` is false). It walks a new user through:
 *
 *   1  Welcome / what Little Gerry is
 *   2  How it works — why Docker (database) and Python (backend) were installed
 *   3  Connect Claude (Anthropic API key)   — the default chat model
 *   4  Connect Voyage (embeddings API key)  — the default search model
 *   5  Connect Google Workspace (optional)
 *   6  Using Little Gerry — import, edit, chat, submit feedback
 *   7  Roles & privileges
 *   8  Finish
 *
 * Claude + Voyage are pre-selected as the default stack; the user only needs to
 * paste the keys their team already has access to. Completion is recorded on the
 * server (POST /settings/onboarding/complete) so the wizard never shows again.
 */

import { useState, useEffect, useCallback } from "react";
import {
  updateSettings,
  testConnection,
  getSettings,
  completeOnboarding,
} from "@/api/settings";
import { getGoogleStatus, startGoogleAuth } from "@/api/google";
import {
  Sparkles,
  Database,
  Server,
  ShieldCheck,
  KeyRound,
  Boxes,
  Cloud,
  Upload,
  Pencil,
  MessageSquare,
  MessageSquarePlus,
  Users,
  Shield,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronRight,
  ChevronLeft,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  /** Called after the wizard is dismissed (completed or skipped to the end). */
  onComplete: () => void;
}

const STEPS = [
  "Welcome",
  "How it works",
  "Claude",
  "Voyage",
  "Google",
  "Using it",
  "Roles",
  "Done",
] as const;

const LAST_STEP = STEPS.length - 1;

export function SetupWizard({ onComplete }: Props) {
  const [step, setStep] = useState(0);

  // ── Claude (Anthropic) ──────────────────────────────────────────────────────
  const [anthropicKey, setAnthropicKey] = useState("");
  const [claudeSaving, setClaudeSaving] = useState(false);
  const [claudeResult, setClaudeResult] = useState<{ ok: boolean; message: string } | null>(null);

  // ── Voyage (embeddings) ─────────────────────────────────────────────────────
  const [voyageKey, setVoyageKey] = useState("");
  const [voyageSaving, setVoyageSaving] = useState(false);
  const [voyageResult, setVoyageResult] = useState<{ ok: boolean; message: string } | null>(null);

  // ── Google ──────────────────────────────────────────────────────────────────
  const [googleConnected, setGoogleConnected] = useState<boolean | null>(null);
  const [googleConnecting, setGoogleConnecting] = useState(false);

  // ── Finish ──────────────────────────────────────────────────────────────────
  const [finishing, setFinishing] = useState(false);

  // ── Pre-fill key-set state so returning-mid-wizard reflects reality ─────────
  useEffect(() => {
    getSettings()
      .then((s) => {
        if (s.anthropic_key_set) setClaudeResult({ ok: true, message: "Already connected." });
        if (s.voyage_key_set) setVoyageResult({ ok: true, message: "Already connected." });
      })
      .catch(() => {});
  }, []);

  // ── Save Claude key + verify ────────────────────────────────────────────────
  async function handleSaveClaude() {
    if (anthropicKey.trim().length < 10) return;
    setClaudeSaving(true);
    setClaudeResult(null);
    try {
      await updateSettings({
        llm_provider: "anthropic",
        llm_model: "claude-sonnet-4-6",
        anthropic_api_key: anthropicKey.trim(),
      });
      const result = await testConnection("anthropic");
      setClaudeResult(result);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to save the key.";
      setClaudeResult({ ok: false, message: msg });
    } finally {
      setClaudeSaving(false);
    }
  }

  // ── Save Voyage key ─────────────────────────────────────────────────────────
  async function handleSaveVoyage() {
    if (voyageKey.trim().length < 10) return;
    setVoyageSaving(true);
    setVoyageResult(null);
    try {
      const s = await updateSettings({
        embedding_provider: "voyage",
        embedding_model: "voyage-3",
        voyage_api_key: voyageKey.trim(),
      });
      setVoyageResult(
        s.voyage_key_set
          ? { ok: true, message: "Voyage key saved. Document search is ready." }
          : { ok: false, message: "The key did not save — please try again." },
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to save the key.";
      setVoyageResult({ ok: false, message: msg });
    } finally {
      setVoyageSaving(false);
    }
  }

  // ── Google connect + status polling ─────────────────────────────────────────
  const refreshGoogle = useCallback(async () => {
    try {
      const s = await getGoogleStatus();
      setGoogleConnected(s.connected);
      return s.connected;
    } catch {
      setGoogleConnected(false);
      return false;
    }
  }, []);

  useEffect(() => {
    if (step === 4) void refreshGoogle();
  }, [step, refreshGoogle]);

  async function handleConnectGoogle() {
    setGoogleConnecting(true);
    try {
      await startGoogleAuth();
    } catch {
      /* ignore — the browser may still open */
    }
    // Poll for up to ~60s while the user completes OAuth in the browser.
    let tries = 0;
    const timer = setInterval(async () => {
      tries += 1;
      const connected = await refreshGoogle();
      if (connected || tries >= 30) {
        clearInterval(timer);
        setGoogleConnecting(false);
      }
    }, 2000);
  }

  // ── Finish ──────────────────────────────────────────────────────────────────
  async function handleFinish() {
    setFinishing(true);
    try {
      await completeOnboarding();
    } catch {
      /* best-effort — still let the user in */
    } finally {
      setFinishing(false);
      onComplete();
    }
  }

  const goNext = () => setStep((s) => Math.min(LAST_STEP, s + 1));
  const goBack = () => setStep((s) => Math.max(0, s - 1));

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="flex w-full max-w-2xl flex-col rounded-xl border bg-card shadow-2xl">
        {/* Header */}
        <div className="border-b px-6 py-5">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Welcome to Little Gerry</h2>
            <span className="ml-auto text-xs text-muted-foreground">
              Step {step + 1} of {STEPS.length}
            </span>
          </div>
          {/* Step dots */}
          <div className="mt-4 flex items-center gap-1.5">
            {STEPS.map((label, i) => (
              <div key={label} className="flex flex-1 flex-col items-center gap-1">
                <div
                  className={cn(
                    "h-1.5 w-full rounded-full transition-colors",
                    i < step ? "bg-primary" : i === step ? "bg-primary/70" : "bg-muted",
                  )}
                />
                <span
                  className={cn(
                    "hidden text-[10px] sm:block",
                    i === step ? "font-medium text-foreground" : "text-muted-foreground",
                  )}
                >
                  {label}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="min-h-[20rem] px-6 py-6">
          {/* ── 0 Welcome ─────────────────────────────────────────────────── */}
          {step === 0 && (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-primary/10 p-2.5">
                  <Sparkles className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="text-base font-semibold">Your private AI assistant for PMI</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Little Gerry chats with your knowledge base, drafts and summarizes documents,
                    tracks tasks, and connects to your Google Workspace — all running locally on
                    your machine so your data stays with you.
                  </p>
                </div>
              </div>
              <div className="rounded-lg border bg-muted/40 p-4 text-sm">
                This quick guide sets up the few things Little Gerry needs and shows you around.
                It only appears once and takes about a minute. You can change anything later in{" "}
                <span className="font-medium">Settings</span>.
              </div>
            </div>
          )}

          {/* ── 1 How it works ────────────────────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                The installer set up a couple of background pieces so everything runs privately on
                your computer. You don&apos;t need to touch these — here&apos;s what they do:
              </p>
              <InfoRow
                icon={<Database className="h-5 w-5 text-blue-500" />}
                title="Docker — your local database"
                desc="Docker runs a PostgreSQL database that stores your documents, conversations, and the
                      searchable index of your knowledge base. Keeping it local means your content never
                      leaves your machine."
              />
              <InfoRow
                icon={<Server className="h-5 w-5 text-emerald-500" />}
                title="Python — the backend engine"
                desc="A small Python service is the brain that connects the app to the AI models, manages
                      your files, and handles secure sign-in."
              />
              <InfoRow
                icon={<ShieldCheck className="h-5 w-5 text-primary" />}
                title="Your API keys stay private"
                desc="The keys you enter next are stored in your operating system's secure keyring — never in
                      plain text and never shared."
              />
            </div>
          )}

          {/* ── 2 Claude ──────────────────────────────────────────────────── */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-orange-500/10 p-2.5">
                  <Boxes className="h-6 w-6 text-orange-500" />
                </div>
                <div>
                  <p className="text-base font-semibold">Connect Claude (Anthropic)</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Claude is the default chat model — it powers conversations, summaries, and drafting.
                    Your team already has access through the PMI Anthropic project; just paste your key.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-1.5 text-sm font-medium">
                  <KeyRound className="h-4 w-4" /> Anthropic API key
                </label>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={anthropicKey}
                    onChange={(e) => { setAnthropicKey(e.target.value); setClaudeResult(null); }}
                    placeholder="sk-ant-..."
                    className="flex-1 rounded-md border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
                    autoFocus
                  />
                  <button
                    onClick={handleSaveClaude}
                    disabled={claudeSaving || anthropicKey.trim().length < 10}
                    className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow hover:bg-primary/90 disabled:opacity-50"
                  >
                    {claudeSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                    {claudeSaving ? "Verifying…" : "Save & verify"}
                  </button>
                </div>
                <a
                  href="https://console.anthropic.com/settings/keys"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  Get a key at console.anthropic.com <ExternalLink className="h-3 w-3" />
                </a>
              </div>

              <ResultBanner result={claudeResult} />
              <DefaultNote>
                Default model: <span className="font-mono">claude-sonnet-4-6</span>. Change it anytime
                in Settings → Chat Model.
              </DefaultNote>
            </div>
          )}

          {/* ── 3 Voyage ──────────────────────────────────────────────────── */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-violet-500/10 p-2.5">
                  <Sparkles className="h-6 w-6 text-violet-500" />
                </div>
                <div>
                  <p className="text-base font-semibold">Connect Voyage (document search)</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Voyage turns your documents into a searchable index so Little Gerry can find the
                    right information when you ask. It&apos;s Anthropic&apos;s embedding partner and the
                    default here. Your team already has access through the PMI Voyage project.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-1.5 text-sm font-medium">
                  <KeyRound className="h-4 w-4" /> Voyage API key
                </label>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={voyageKey}
                    onChange={(e) => { setVoyageKey(e.target.value); setVoyageResult(null); }}
                    placeholder="pa-..."
                    className="flex-1 rounded-md border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
                    autoFocus
                  />
                  <button
                    onClick={handleSaveVoyage}
                    disabled={voyageSaving || voyageKey.trim().length < 10}
                    className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow hover:bg-primary/90 disabled:opacity-50"
                  >
                    {voyageSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                    {voyageSaving ? "Saving…" : "Save key"}
                  </button>
                </div>
                <a
                  href="https://dashboard.voyageai.com/api-keys"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  Get a key at dashboard.voyageai.com <ExternalLink className="h-3 w-3" />
                </a>
              </div>

              <ResultBanner result={voyageResult} />
              <DefaultNote>
                Default model: <span className="font-mono">voyage-3</span> (1024 dimensions). Change it
                anytime in Settings → Embeddings.
              </DefaultNote>
            </div>
          )}

          {/* ── 4 Google ──────────────────────────────────────────────────── */}
          {step === 4 && (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-sky-500/10 p-2.5">
                  <Cloud className="h-6 w-6 text-sky-500" />
                </div>
                <div>
                  <p className="text-base font-semibold">Connect Google Workspace (optional)</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Link your company Google account to import from Drive, search Gmail, and sync
                    Calendar and Tasks. You can always do this later from the Google page.
                  </p>
                </div>
              </div>

              {googleConnected ? (
                <div className="flex items-center gap-2 rounded-md bg-green-500/10 px-3 py-2.5 text-sm text-green-700 dark:text-green-400">
                  <CheckCircle2 className="h-4 w-4 shrink-0" /> Google Workspace is connected.
                </div>
              ) : (
                <button
                  onClick={handleConnectGoogle}
                  disabled={googleConnecting}
                  className="flex items-center gap-2 rounded-md border bg-background px-4 py-2.5 text-sm font-semibold shadow-sm hover:bg-accent disabled:opacity-60"
                >
                  {googleConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}
                  {googleConnecting ? "Waiting for browser…" : "Connect Google Workspace"}
                </button>
              )}

              {googleConnecting && (
                <p className="text-xs text-muted-foreground">
                  A browser window has opened. Sign in with your{" "}
                  <span className="font-medium">@pmi-llc.com</span> or{" "}
                  <span className="font-medium">@precisianmedical.com</span> account, then return here.
                </p>
              )}

              <DefaultNote>This step is optional — you can skip it and connect later.</DefaultNote>
            </div>
          )}

          {/* ── 5 Using it ────────────────────────────────────────────────── */}
          {step === 5 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">A few things you&apos;ll do every day:</p>
              <InfoRow
                icon={<Upload className="h-5 w-5 text-blue-500" />}
                title="Import"
                desc="Upload files or pull documents from Google Drive on the Documents page to add them to
                      your knowledge base."
              />
              <InfoRow
                icon={<Pencil className="h-5 w-5 text-amber-500" />}
                title="Edit"
                desc="Browse, create, rename, move, and edit files in the Regulatory file explorer (write
                      access depends on your permissions — see the next step)."
              />
              <InfoRow
                icon={<MessageSquare className="h-5 w-5 text-emerald-500" />}
                title="Communicate"
                desc="Ask questions in Chat — Little Gerry answers using your imported knowledge and cites
                      its sources."
              />
              <InfoRow
                icon={<MessageSquarePlus className="h-5 w-5 text-violet-500" />}
                title="Report bugs & request features"
                desc="Use the feedback button in the top bar to report an issue or request a feature — it goes
                      straight to the team."
              />
            </div>
          )}

          {/* ── 6 Roles ───────────────────────────────────────────────────── */}
          {step === 6 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Access is based on your role and a per-user permission:
              </p>
              <InfoRow
                icon={<Shield className="h-5 w-5 text-primary" />}
                title="Admin"
                desc="Full access: manage users, change settings, and read/write every section — including
                      Regulatory."
              />
              <InfoRow
                icon={<Users className="h-5 w-5 text-blue-500" />}
                title="Member"
                desc="Can read and write every section except Regulatory, which is read-only unless granted
                      write access."
              />
              <InfoRow
                icon={<ShieldCheck className="h-5 w-5 text-emerald-500" />}
                title="Regulatory write (per-user)"
                desc="A permission an admin grants to specific people so they can edit the Regulatory file
                      store. Admins always have it."
              />
            </div>
          )}

          {/* ── 7 Done ────────────────────────────────────────────────────── */}
          {step === 7 && (
            <div className="space-y-4 py-6 text-center">
              <CheckCircle2 className="mx-auto h-14 w-14 text-green-500" />
              <div>
                <p className="text-lg font-semibold">You&apos;re all set!</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Claude and Voyage are configured as your defaults. Everything you set up here can be
                  changed anytime in Settings.
                </p>
              </div>
              <button
                onClick={handleFinish}
                disabled={finishing}
                className="mx-auto flex items-center justify-center gap-2 rounded-md bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground shadow hover:bg-primary/90 disabled:opacity-60"
              >
                {finishing && <Loader2 className="h-4 w-4 animate-spin" />}
                Open Little Gerry
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        {step < LAST_STEP && (
          <div className="flex items-center justify-between border-t px-6 py-4">
            <button
              onClick={goBack}
              disabled={step === 0}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground disabled:opacity-0"
            >
              <ChevronLeft className="h-4 w-4" /> Back
            </button>
            <button
              onClick={goNext}
              className="flex items-center gap-1.5 rounded-md bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground shadow hover:bg-primary/90"
            >
              {step === 2 || step === 3 || step === 4 ? "Continue" : "Next"}
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Small presentational helpers ──────────────────────────────────────────────

function InfoRow({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border bg-background/50 p-3.5">
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{desc}</p>
      </div>
    </div>
  );
}

function ResultBanner({ result }: { result: { ok: boolean; message: string } | null }) {
  if (!result) return null;
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md px-3 py-2 text-sm",
        result.ok
          ? "bg-green-500/10 text-green-700 dark:text-green-400"
          : "bg-destructive/10 text-destructive",
      )}
    >
      {result.ok ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
      ) : (
        <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
      )}
      {result.message}
    </div>
  );
}

function DefaultNote({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}
