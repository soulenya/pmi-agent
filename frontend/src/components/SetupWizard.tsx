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
 *   6  Voice (optional) — Google Cloud API key for speech-to-text / text-to-speech
 *   7  Using Little Gerry — import, edit, chat, generate documents, voice, feedback
 *   8  Roles & privileges
 *   9  Finish
 *
 * Claude + Voyage are pre-selected as the default stack; the user only needs to
 * paste the keys their team already has access to. Completion is recorded on the
 * server (POST /settings/onboarding/complete) so the wizard never shows again.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  updateSettings,
  testConnection,
  getSettings,
  completeOnboarding,
  getMyProfile,
  updateMyProfile,
  getCompanyContext,
  refreshCompanyContext,
  setCompanyContextFileId,
} from "@/api/settings";
import { apiClient } from "@/api/client";
import { getWritingVoice, analyzeWritingVoice } from "@/api/writingVoice";
import {
  listScheduledTasks,
  createScheduledTask,
  updateScheduledTask,
} from "@/api/scheduledTasks";
import {
  inspectDataImport,
  runDataImport,
  type ArchiveManifest,
  type RestoreResult,
} from "@/api/dataTransfer";
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
  Mic,
  FileText,
  HardDrive,
  AlertTriangle,
  Clock,
  Building2,
  PenLine,
  SlidersHorizontal,
  Video,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  /** Called after the wizard is dismissed (completed or skipped to the end). */
  onComplete: () => void;
  /**
   * The wizard revision this user has already been through. 0 (or undefined)
   * means they have never seen it and get the full run; an existing user with a
   * lower version than ONBOARDING_VERSION is shown only the steps added since.
   */
  onboardingVersion?: number;
}

/**
 * Bump this whenever steps are added, and tag the new steps with the same
 * number in `since`. Must match ONBOARDING_VERSION in backend/routers/settings.py.
 */
export const ONBOARDING_VERSION = 2;

/** The scheduled task the briefing step creates, matched by title so it is only made once. */
const BRIEFING_TITLE = "Daily briefing";
const BRIEFING_PROMPT =
  "Give me my daily briefing: what happened since yesterday across my email, calendar and " +
  "documents, what needs my attention today, and any tasks that are due or overdue. " +
  "Keep it short and lead with anything urgent.";

type StepId =
  | "welcome"
  | "how"
  | "restore"
  | "claude"
  | "voyage"
  | "google"
  | "you"
  | "company"
  | "writing-voice"
  | "voice"
  | "meetings"
  | "briefing"
  | "backups"
  | "models"
  | "using"
  | "roles"
  | "done";

interface StepDef {
  id: StepId;
  label: string;
  /** Wizard revision that introduced this step. */
  since: number;
}

const ALL_STEPS: StepDef[] = [
  { id: "welcome", label: "Welcome", since: 1 },
  { id: "how", label: "How it works", since: 1 },
  { id: "restore", label: "Restore", since: 2 },
  { id: "claude", label: "Claude", since: 1 },
  { id: "voyage", label: "Voyage", since: 1 },
  { id: "google", label: "Google", since: 1 },
  { id: "you", label: "You", since: 2 },
  { id: "company", label: "Company", since: 2 },
  { id: "writing-voice", label: "Your voice", since: 2 },
  { id: "voice", label: "Speech", since: 1 },
  { id: "meetings", label: "Meetings", since: 2 },
  { id: "briefing", label: "Briefing", since: 2 },
  { id: "backups", label: "Backups", since: 2 },
  { id: "models", label: "Models", since: 2 },
  { id: "using", label: "Using it", since: 1 },
  { id: "roles", label: "Roles", since: 1 },
  { id: "done", label: "Done", since: 1 },
];

/** Steps where the user has just done something, so "Continue" reads better than "Next". */
const CONTINUE_STEPS = new Set<StepId>([
  "restore",
  "claude",
  "voyage",
  "google",
  "you",
  "company",
  "writing-voice",
  "voice",
  "backups",
]);

/**
 * A first-time user (version 0) gets everything. Someone who has already been
 * through an earlier revision gets only what is new to them, plus the closing
 * step so there is always a way out.
 */
function visibleSteps(seenVersion: number): StepDef[] {
  if (seenVersion <= 0) return ALL_STEPS;
  const fresh = ALL_STEPS.filter((s) => s.since > seenVersion);
  if (!fresh.length) return [ALL_STEPS[ALL_STEPS.length - 1]];
  return [...fresh, ALL_STEPS[ALL_STEPS.length - 1]];
}

export function SetupWizard({ onComplete, onboardingVersion = 0 }: Props) {
  const isUpdate = onboardingVersion > 0;
  const [steps] = useState(() => visibleSteps(onboardingVersion));
  const [step, setStep] = useState(0);
  const lastStep = steps.length - 1;
  const stepId = steps[Math.min(step, lastStep)].id;

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

  // ── Voice (Google Cloud API key) ──────────────────────────────────────
  const [googleCloudKey, setGoogleCloudKey] = useState("");
  const [voiceSaving, setVoiceSaving] = useState(false);
  const [voiceResult, setVoiceResult] = useState<{ ok: boolean; message: string } | null>(null);

  // ── Finish ──────────────────────────────────────────────────────────────────
  const [finishing, setFinishing] = useState(false);

  // ── Pre-fill key-set state so returning-mid-wizard reflects reality ─────────
  useEffect(() => {
    getSettings()
      .then((s) => {
        if (s.anthropic_key_set) setClaudeResult({ ok: true, message: "Already connected." });
        if (s.voyage_key_set) setVoyageResult({ ok: true, message: "Already connected." });
        if (s.google_key_set) setVoiceResult({ ok: true, message: "Already connected — voice is ready." });
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

  // ── Save Google Cloud (voice) key ───────────────────────────────────────
  async function handleSaveGoogleCloud() {
    if (googleCloudKey.trim().length < 10) return;
    setVoiceSaving(true);
    setVoiceResult(null);
    try {
      const s = await updateSettings({ google_api_key: googleCloudKey.trim() });
      setVoiceResult(
        s.google_key_set
          ? { ok: true, message: "Key saved. The microphone button and spoken replies are now available." }
          : { ok: false, message: "The key did not save — please try again." },
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to save the key.";
      setVoiceResult({ ok: false, message: msg });
    } finally {
      setVoiceSaving(false);
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
    if (stepId === "google") void refreshGoogle();
  }, [stepId, refreshGoogle]);

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

  // ── Restore from a backup ───────────────────────────────────────────────────
  const restoreFileRef = useRef<HTMLInputElement>(null);
  const [restorePending, setRestorePending] = useState<{ file: File; manifest: ArchiveManifest } | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreDone, setRestoreDone] = useState<RestoreResult | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  async function handlePickRestore(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setRestoreError(null);
    setRestoreBusy(true);
    try {
      setRestorePending({ file, manifest: await inspectDataImport(file) });
    } catch (err: unknown) {
      setRestoreError(err instanceof Error ? err.message : "That is not a Little Gerry backup file.");
    } finally {
      setRestoreBusy(false);
    }
  }

  async function handleRunRestore() {
    if (!restorePending) return;
    setRestoreBusy(true);
    setRestoreError(null);
    try {
      setRestoreDone(await runDataImport(restorePending.file));
      setRestorePending(null);
    } catch (err: unknown) {
      setRestoreError(err instanceof Error ? err.message : "The restore failed.");
    } finally {
      setRestoreBusy(false);
    }
  }

  // ── Your details ────────────────────────────────────────────────────────────
  const [displayName, setDisplayName] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameResult, setNameResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    getMyProfile()
      .then((u) => setDisplayName(u.display_name ?? ""))
      .catch(() => {});
  }, []);

  async function handleSaveName() {
    if (!displayName.trim()) return;
    setNameSaving(true);
    setNameResult(null);
    try {
      await updateMyProfile({ display_name: displayName.trim() });
      setNameResult({ ok: true, message: "Saved — Little Gerry will address you by this name." });
    } catch (e: unknown) {
      setNameResult({ ok: false, message: e instanceof Error ? e.message : "Could not save." });
    } finally {
      setNameSaving(false);
    }
  }

  // ── Company profile ─────────────────────────────────────────────────────────
  const [companyFolder, setCompanyFolder] = useState("");
  const [companySaving, setCompanySaving] = useState(false);
  const [companyResult, setCompanyResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (stepId !== "company") return;
    getCompanyContext()
      .then((c) => {
        setCompanyFolder(c.drive_file_id ?? "");
        if (c.synced_at) {
          setCompanyResult({
            ok: true,
            message: `Already loaded — ${(c.sections ?? []).length} section(s), last read ${new Date(c.synced_at).toLocaleDateString()}.`,
          });
        }
      })
      .catch(() => {});
  }, [stepId]);

  async function handleSaveCompany() {
    setCompanySaving(true);
    setCompanyResult(null);
    try {
      const r = companyFolder.trim()
        ? await setCompanyContextFileId(companyFolder.trim())
        : await refreshCompanyContext();
      setCompanyResult(
        r.ok
          ? { ok: true, message: `Loaded ${(r.sections ?? []).length} section(s) from Drive.` }
          : { ok: false, message: r.error ?? "Could not read that folder." },
      );
    } catch (e: unknown) {
      setCompanyResult({ ok: false, message: e instanceof Error ? e.message : "Could not read that folder." });
    } finally {
      setCompanySaving(false);
    }
  }

  // ── Writing voice ───────────────────────────────────────────────────────────
  const [voiceAnalyzing, setVoiceAnalyzing] = useState(false);
  const [voiceProfileResult, setVoiceProfileResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (stepId !== "writing-voice") return;
    getWritingVoice()
      .then((v) => {
        if (v.profile) {
          setVoiceProfileResult({ ok: true, message: "Your writing voice is already on file." });
        }
      })
      .catch(() => {});
  }, [stepId]);

  async function handleAnalyzeVoice() {
    setVoiceAnalyzing(true);
    setVoiceProfileResult(null);
    try {
      const r = await analyzeWritingVoice();
      setVoiceProfileResult({
        ok: true,
        message: `Done — learned from ${r.messages_analyzed} of your sent emails.`,
      });
    } catch (e: unknown) {
      setVoiceProfileResult({
        ok: false,
        message:
          e instanceof Error
            ? e.message
            : "Could not read your sent mail. Connect Google Workspace first, or add this later in Settings.",
      });
    } finally {
      setVoiceAnalyzing(false);
    }
  }

  // ── Automatic backups ───────────────────────────────────────────────────────
  const [backupsEnabled, setBackupsEnabled] = useState(true);
  const [backupHour, setBackupHour] = useState(2);
  const [backupsSaving, setBackupsSaving] = useState(false);
  const [backupsResult, setBackupsResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (stepId !== "backups") return;
    apiClient
      .get<{ config: { enabled: boolean; hour: number } }>("/api/backups/status")
      .then(({ data }) => {
        setBackupsEnabled(data.config.enabled);
        setBackupHour(data.config.hour);
      })
      .catch(() => {});
  }, [stepId]);

  async function handleSaveBackups() {
    setBackupsSaving(true);
    setBackupsResult(null);
    try {
      await apiClient.put("/api/backups/settings", { enabled: backupsEnabled, hour: backupHour });
      setBackupsResult({
        ok: true,
        message: backupsEnabled
          ? `Saved — your conversations will be copied to Google Drive every day at ${String(backupHour).padStart(2, "0")}:00.`
          : "Saved — automatic backups are off.",
      });
    } catch (e: unknown) {
      setBackupsResult({ ok: false, message: e instanceof Error ? e.message : "Could not save." });
    } finally {
      setBackupsSaving(false);
    }
  }

  // ── Daily briefing ──────────────────────────────────────────────────────────
  const [briefingHour, setBriefingHour] = useState(7);
  const [briefingSaving, setBriefingSaving] = useState(false);
  const [briefingResult, setBriefingResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleCreateBriefing() {
    setBriefingSaving(true);
    setBriefingResult(null);
    try {
      const existing = await listScheduledTasks();
      const already = existing.find((t) => t.title === BRIEFING_TITLE);
      if (already) {
        await updateScheduledTask(already.id, { hour: briefingHour, minute: 0, enabled: true });
      } else {
        await createScheduledTask({
          title: BRIEFING_TITLE,
          prompt: BRIEFING_PROMPT,
          frequency: "daily",
          hour: briefingHour,
          minute: 0,
          enabled: true,
        });
      }
      setBriefingResult({
        ok: true,
        message: `Scheduled for ${String(briefingHour).padStart(2, "0")}:00 every day.`,
      });
    } catch (e: unknown) {
      setBriefingResult({ ok: false, message: e instanceof Error ? e.message : "Could not schedule it." });
    } finally {
      setBriefingSaving(false);
    }
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

  const goNext = () => setStep((s) => Math.min(lastStep, s + 1));
  const goBack = () => setStep((s) => Math.max(0, s - 1));

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border bg-card shadow-2xl">
        {/* Header */}
        <div className="border-b px-6 py-5">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">
              {isUpdate ? "What's new to set up" : "Welcome to Little Gerry"}
            </h2>
            <span className="ml-auto text-xs text-muted-foreground">
              Step {step + 1} of {steps.length}
            </span>
          </div>
          {/* Step dots */}
          <div className="mt-4 flex items-center gap-1.5">
            {steps.map(({ id, label }, i) => (
              <div key={id} className="flex flex-1 flex-col items-center gap-1">
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
        <div className="min-h-[20rem] flex-1 overflow-y-auto px-6 py-6">
          {/* ── 0 Welcome ─────────────────────────────────────────────────── */}
          {stepId === "welcome" && (
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
          {stepId === "how" && (
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
          {stepId === "claude" && (
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
          {stepId === "voyage" && (
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
          {stepId === "google" && (
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

          {/* ── 5 Voice ───────────────────────────────────────────────────── */}
          {stepId === "voice" && (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-rose-500/10 p-2.5">
                  <Mic className="h-6 w-6 text-rose-500" />
                </div>
                <div>
                  <p className="text-base font-semibold">Voice — talk to Little Gerry (optional)</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    With a Google Cloud API key, a microphone button appears in chat — speak and
                    your words become editable text — and Little Gerry can read replies aloud in a
                    natural voice. Audio goes only to the company&apos;s own Google Cloud project and
                    is never stored.
                  </p>
                </div>
              </div>

              <div className="rounded-lg border bg-muted/40 p-4 text-sm space-y-1.5">
                <p className="font-medium">Where to get the key</p>
                <p className="text-muted-foreground">
                  PMI already has this key in the company&apos;s Google Cloud project — ask your admin
                  for the <span className="font-medium">Google Cloud API key</span>. If you need to
                  create one: open the Google Cloud Console → <span className="font-medium">APIs &amp;
                  Services → Credentials → Create credentials → API key</span>, and make sure the{" "}
                  <span className="font-medium">Speech-to-Text</span> and{" "}
                  <span className="font-medium">Text-to-Speech</span> APIs are enabled on the project.
                </p>
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-1.5 text-sm font-medium">
                  <KeyRound className="h-4 w-4" /> Google Cloud API key
                </label>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={googleCloudKey}
                    onChange={(e) => { setGoogleCloudKey(e.target.value); setVoiceResult(null); }}
                    placeholder="AIza..."
                    className="flex-1 rounded-md border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                  <button
                    onClick={handleSaveGoogleCloud}
                    disabled={voiceSaving || googleCloudKey.trim().length < 10}
                    className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow hover:bg-primary/90 disabled:opacity-50"
                  >
                    {voiceSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                    {voiceSaving ? "Saving…" : "Save key"}
                  </button>
                </div>
                <a
                  href="https://console.cloud.google.com/apis/credentials"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  Open Google Cloud Console credentials <ExternalLink className="h-3 w-3" />
                </a>
              </div>

              <ResultBanner result={voiceResult} />
              <DefaultNote>
                This step is optional — you can add the key later in Settings → Voice, where you can
                also pick a voice and turn on spoken replies.
              </DefaultNote>
            </div>
          )}

          {/* ── 6 Using it ──────────────────────────────────────────────── */}
          {stepId === "using" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">A few things you&apos;ll do every day:</p>
              <InfoRow
                icon={<Upload className="h-5 w-5 text-blue-500" />}
                title="Import"
                desc="Upload files or pull documents from Google Drive on the Documents page to add them to
                      your knowledge base."
              />
              <InfoRow
                icon={<MessageSquare className="h-5 w-5 text-emerald-500" />}
                title="Communicate — type or talk"
                desc="Ask questions in Chat — Little Gerry answers using your imported knowledge and cites
                      its sources. With voice set up, use the microphone button to dictate and have replies
                      read aloud."
              />
              <InfoRow
                icon={<FileText className="h-5 w-5 text-amber-500" />}
                title="Edit & generate regulatory documents"
                desc="Browse, create, and edit files in the Regulatory file explorer, or use the Generate
                      Document wizard to draft FDA and ISO documents (510(k) outlines, SOPs, Quality
                      Manuals, and more) from curated templates — each draft comes with a recommended
                      human review."
              />
              <InfoRow
                icon={<Sparkles className="h-5 w-5 text-primary" />}
                title="Start the day on the Dashboard"
                desc="The Dashboard gathers today's calendar events, tasks, and meetings with a daily
                      briefing. Once Google is connected, the Daily Assistant also scans Gmail and Google
                      Tasks each morning and collects follow-ups and to-dos for you to review."
              />
              <InfoRow
                icon={<Boxes className="h-5 w-5 text-orange-500" />}
                title="Tune your AI models"
                desc="Settings → Models per Task lets each kind of work (chat, briefings, regulatory drafting,
                      research…) use its own model — fast and cheap for daily scans, most capable for
                      regulatory writing. Recommendations are marked with a ★."
              />
              <InfoRow
                icon={<MessageSquarePlus className="h-5 w-5 text-violet-500" />}
                title="Report bugs & request features"
                desc="Use the feedback button in the top bar to report an issue or request a feature — it goes
                      straight to the team."
              />
            </div>
          )}

          {/* ── 7 Roles ───────────────────────────────────────────────────── */}
          {stepId === "roles" && (
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

          {/* ── Restore from a backup ─────────────────────────────────────── */}
          {stepId === "restore" && (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-sky-500/10 p-2.5">
                  <HardDrive className="h-6 w-6 text-sky-500" />
                </div>
                <div>
                  <p className="text-base font-semibold">Moving from another computer?</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    If you made a backup from a previous installation, load it now and everything
                    comes back — conversations, tasks, documents and the whole knowledge base. If
                    this is a fresh start, just skip ahead.
                  </p>
                </div>
              </div>

              <input
                ref={restoreFileRef}
                type="file"
                accept=".lgbackup"
                onChange={handlePickRestore}
                className="hidden"
              />

              {!restoreDone && (
                <button
                  onClick={() => restoreFileRef.current?.click()}
                  disabled={restoreBusy}
                  className="flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
                >
                  {restoreBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  Choose a backup file…
                </button>
              )}

              {restoreError && (
                <p className="flex items-start gap-1.5 text-sm text-red-600">
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0" /> {restoreError}
                </p>
              )}

              {restorePending && (
                <div className="rounded-lg border border-amber-400/70 bg-amber-50 p-4 text-sm dark:bg-amber-950/30">
                  <p className="font-medium">{restorePending.file.name}</p>
                  <p className="mt-1 text-muted-foreground">
                    Made {new Date(restorePending.manifest.created_at).toLocaleString()} —{" "}
                    {restorePending.manifest.documents ?? 0} document(s).
                  </p>
                  <p className="mt-2 flex items-start gap-1.5 text-amber-800 dark:text-amber-200">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    Anything already in Little Gerry will be replaced by the contents of this file.
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={handleRunRestore}
                      disabled={restoreBusy}
                      className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow hover:bg-primary/90 disabled:opacity-50"
                    >
                      {restoreBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                      {restoreBusy ? "Restoring…" : "Restore this backup"}
                    </button>
                    <button
                      onClick={() => setRestorePending(null)}
                      disabled={restoreBusy}
                      className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {restoreDone && (
                <div className="rounded-lg border border-green-500/60 bg-green-50 p-4 text-sm dark:bg-green-950/30">
                  <p className="flex items-center gap-1.5 font-medium text-green-700 dark:text-green-300">
                    <CheckCircle2 className="h-4 w-4" /> Restored{" "}
                    {restoreDone.restored.documents} document(s).
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    Carry on through the rest of this guide to put your API keys back
                    {restoreDone.reconnect_required ? " and reconnect Google Workspace" : ""}, then
                    close and reopen Little Gerry.
                  </p>
                </div>
              )}

              <DefaultNote>
                You can make a backup at any time from Settings → Backup &amp; Restore.
              </DefaultNote>
            </div>
          )}

          {/* ── Your details ──────────────────────────────────────────────── */}
          {stepId === "you" && (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-primary/10 p-2.5">
                  <Users className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="text-base font-semibold">What should Little Gerry call you?</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    This name is used when it addresses you, and when it signs off drafts and emails
                    it writes on your behalf.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Your name</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => { setDisplayName(e.target.value); setNameResult(null); }}
                    placeholder="Morgan Keane"
                    className="flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                    autoFocus
                  />
                  <button
                    onClick={handleSaveName}
                    disabled={nameSaving || !displayName.trim()}
                    className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow hover:bg-primary/90 disabled:opacity-50"
                  >
                    {nameSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                    Save
                  </button>
                </div>
              </div>

              <ResultBanner result={nameResult} />
            </div>
          )}

          {/* ── Company profile ───────────────────────────────────────────── */}
          {stepId === "company" && (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-blue-500/10 p-2.5">
                  <Building2 className="h-6 w-6 text-blue-500" />
                </div>
                <div>
                  <p className="text-base font-semibold">Teach it about your company</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Point Little Gerry at a Google Drive folder holding your company background —
                    who you are, what you make, your standards and terminology. It reads those
                    documents and keeps them in mind in every conversation.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Google Drive folder ID</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={companyFolder}
                    onChange={(e) => { setCompanyFolder(e.target.value); setCompanyResult(null); }}
                    placeholder="Leave blank to use the PMI default folder"
                    className="flex-1 rounded-md border bg-background px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-ring"
                  />
                  <button
                    onClick={handleSaveCompany}
                    disabled={companySaving}
                    className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow hover:bg-primary/90 disabled:opacity-50"
                  >
                    {companySaving && <Loader2 className="h-4 w-4 animate-spin" />}
                    {companySaving ? "Reading…" : "Load"}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  The ID is the long code in the folder&apos;s Drive address, after{" "}
                  <span className="font-mono">/folders/</span>. This needs Google Workspace
                  connected.
                </p>
              </div>

              <ResultBanner result={companyResult} />
            </div>
          )}

          {/* ── Writing voice ─────────────────────────────────────────────── */}
          {stepId === "writing-voice" && (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-rose-500/10 p-2.5">
                  <PenLine className="h-6 w-6 text-rose-500" />
                </div>
                <div>
                  <p className="text-base font-semibold">Write the way you write</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Little Gerry can study the emails you have already sent and learn how you
                    phrase things — how formal you are, how you open and close, the words you
                    favour — then use that when it drafts for you.
                  </p>
                </div>
              </div>

              <div className="rounded-lg border bg-muted/40 p-4 text-sm">
                It reads up to 120 of your own sent messages from the last six months. Nothing
                leaves your machine except the text sent to your chosen AI model, and only the
                resulting description of your style is kept — not the emails.
              </div>

              <button
                onClick={handleAnalyzeVoice}
                disabled={voiceAnalyzing}
                className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow hover:bg-primary/90 disabled:opacity-50"
              >
                {voiceAnalyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />}
                {voiceAnalyzing ? "Reading your sent mail…" : "Learn my writing voice"}
              </button>

              <ResultBanner result={voiceProfileResult} />
              <DefaultNote>
                Optional. You can do this later, or paste in a writing sample instead, from
                Settings → Writing Voice.
              </DefaultNote>
            </div>
          )}

          {/* ── Meetings ──────────────────────────────────────────────────── */}
          {stepId === "meetings" && (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-indigo-500/10 p-2.5">
                  <Video className="h-6 w-6 text-indigo-500" />
                </div>
                <div>
                  <p className="text-base font-semibold">Meeting notes, taken for you</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Little Gerry can listen to a meeting through your microphone, transcribe it live
                    and hand you a summary with the decisions and action items when it ends.
                  </p>
                </div>
              </div>
              <InfoRow
                icon={<Mic className="h-5 w-5 text-indigo-500" />}
                title="Start it from the Meetings page"
                desc="Open Meetings, press Start, and put your laptop where it can hear the room. You can
                      type notes alongside the transcript as it runs."
              />
              <InfoRow
                icon={<KeyRound className="h-5 w-5 text-primary" />}
                title="Uses the speech key from the next step"
                desc="Live transcription runs on Google Cloud Speech-to-Text, so it needs the same Google
                      Cloud API key used for voice chat."
              />
              <DefaultNote>
                Nothing is recorded to disk unless you ask for it — the transcript is what gets
                kept.
              </DefaultNote>
            </div>
          )}

          {/* ── Daily briefing ────────────────────────────────────────────── */}
          {stepId === "briefing" && (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-amber-500/10 p-2.5">
                  <Clock className="h-6 w-6 text-amber-500" />
                </div>
                <div>
                  <p className="text-base font-semibold">A briefing every morning</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Little Gerry can run itself before you sit down — checking your email, calendar
                    and tasks — and leave a short briefing waiting for you.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <label className="text-sm font-medium">Run it at</label>
                <select
                  value={briefingHour}
                  onChange={(e) => { setBriefingHour(Number(e.target.value)); setBriefingResult(null); }}
                  className="rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, "0")}:00
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleCreateBriefing}
                  disabled={briefingSaving}
                  className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow hover:bg-primary/90 disabled:opacity-50"
                >
                  {briefingSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                  Schedule it
                </button>
              </div>

              <ResultBanner result={briefingResult} />
              <DefaultNote>
                Optional. Change the time, edit what it looks at, or turn it off from the Scheduled
                Tasks page.
              </DefaultNote>
            </div>
          )}

          {/* ── Automatic backups ─────────────────────────────────────────── */}
          {stepId === "backups" && (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-emerald-500/10 p-2.5">
                  <ShieldCheck className="h-6 w-6 text-emerald-500" />
                </div>
                <div>
                  <p className="text-base font-semibold">Keep a copy in Google Drive</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Once a day Little Gerry can copy your conversations to your own Google Drive, so
                    a lost laptop doesn&apos;t mean lost work.
                  </p>
                </div>
              </div>

              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={backupsEnabled}
                  onChange={(e) => { setBackupsEnabled(e.target.checked); setBackupsResult(null); }}
                  className="h-4 w-4"
                />
                Back up automatically every day
              </label>

              <div className="flex flex-wrap items-center gap-2">
                <label className="text-sm font-medium">At</label>
                <select
                  value={backupHour}
                  disabled={!backupsEnabled}
                  onChange={(e) => { setBackupHour(Number(e.target.value)); setBackupsResult(null); }}
                  className="rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, "0")}:00
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleSaveBackups}
                  disabled={backupsSaving}
                  className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow hover:bg-primary/90 disabled:opacity-50"
                >
                  {backupsSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                  Save
                </button>
              </div>

              <ResultBanner result={backupsResult} />
              <DefaultNote>
                This needs Google Workspace connected. For a complete copy — documents and knowledge
                base as well — use Settings → Backup &amp; Restore.
              </DefaultNote>
            </div>
          )}

          {/* ── Models per task ───────────────────────────────────────────── */}
          {stepId === "models" && (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-violet-500/10 p-2.5">
                  <SlidersHorizontal className="h-6 w-6 text-violet-500" />
                </div>
                <div>
                  <p className="text-base font-semibold">Different jobs, different models</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Chatting, summarising a long document, extracting fields from a scan and
                    drafting a report don&apos;t all need the same model. Little Gerry picks a
                    sensible one for each job out of the box.
                  </p>
                </div>
              </div>
              <InfoRow
                icon={<Boxes className="h-5 w-5 text-orange-500" />}
                title="The defaults are already good"
                desc="Claude Sonnet handles conversation and drafting; lighter models take the quick,
                      repetitive jobs so you spend less and wait less."
              />
              <InfoRow
                icon={<SlidersHorizontal className="h-5 w-5 text-violet-500" />}
                title="Change any of them later"
                desc="Settings → Models Per Task lists every job with the model it uses, and lets you swap
                      in anything you have a key for."
              />
              <DefaultNote>Nothing to do here — this is just so you know it exists.</DefaultNote>
            </div>
          )}

          {/* ── Done ────────────────────────────────────────────────────── */}
          {stepId === "done" && (
            <div className="space-y-4 py-6 text-center">
              <CheckCircle2 className="mx-auto h-14 w-14 text-green-500" />
              <div>
                <p className="text-lg font-semibold">You&apos;re all set!</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {isUpdate
                    ? "That's everything new. Anything you skipped is waiting for you in Settings."
                    : "Claude and Voyage are configured as your defaults. Everything you set up here can be changed anytime in Settings."}
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
        {step < lastStep && (
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
              {CONTINUE_STEPS.has(stepId) ? "Continue" : "Next"}
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
