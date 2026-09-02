import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { User, Cpu, Bell, Palette, Save, Check, Loader2, KeyRound, CheckCircle2, XCircle, RefreshCw, Activity, Database, HardDrive, Wifi, Download, GitBranch, BookOpen, AlertTriangle, RotateCcw, Mic, Star, SlidersHorizontal, Building2, ExternalLink, ScanText, PenLine, Pencil, Trash2, Upload, Sparkles, ChevronDown, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getDataSummary,
  createDataExport,
  deleteDataExport,
  inspectDataImport,
  runDataImport,
  formatBytes,
  type ArchiveManifest,
  type RestoreResult,
} from "@/api/dataTransfer";
import { setTheme, type ThemeValue } from "@/hooks/useTheme";
import { BUILD_NUMBER, BUILD_DATE, CHANGELOG } from "@/version";
import { useAuthStore } from "@/stores/authStore";
import {
  getSettings,
  updateSettings,
  testConnection,
  getMyProfile,
  updateMyProfile,
  getSystemHealth,
  getSettingsHealth,
  checkForUpdate,
  applyUpdate,
  getOllamaModels,
  getAnthropicModels,
  getAiOptions,
  getTaskModels,
  updateTaskModel,
  refreshModels,
  getCompanyContext,
  refreshCompanyContext,
  setCompanyContextFileId,
  type AppSettings,
  type SettingsUpdate,
  type ProfileUpdate,
  type SettingsHealthResult,
  type TaskModel,
  type TaskModelUpdate,
} from "@/api/settings";
import { listVoices } from "@/api/voice";
import {
  getWritingVoice,
  saveWritingVoice,
  uploadWritingVoice,
  deleteWritingVoice,
  analyzeWritingVoice,
} from "@/api/writingVoice";
import { listExtractionSchemas, saveExtractionSchemas } from "@/api/extractions";
import { listDriveEditGrants, revokeDriveEdit } from "@/api/google";
import { connectHub, disconnectHub, getHubStatus } from "@/api/hub";

// ── Section wrapper ───────────────────────────────────────────────────────────

const REVIEW_STORE_KEY = "lg.settings.reviewed";

function readReviewed(): Record<string, string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(REVIEW_STORE_KEY) ?? "null");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeReviewed(id: string, revision: string) {
  try {
    localStorage.setItem(REVIEW_STORE_KEY, JSON.stringify({ ...readReviewed(), [id]: revision }));
  } catch {
    // Storage unavailable — the highlight simply comes back next launch.
  }
}

/** Signature of a model catalog, so added or removed models flag the section again. */
function catalogRevision(catalog?: Record<string, string[]>): string | undefined {
  if (!catalog) return undefined;
  return Object.entries(catalog)
    .map(([provider, models]) => `${provider}:${[...models].sort().join(",")}`)
    .sort()
    .join("|");
}

function Section({
  id,
  icon: Icon,
  title,
  description,
  revision,
  children,
}: {
  id: string;
  icon: React.ElementType;
  title: string;
  description?: string;
  /** Bump to flag the section again when it has something new — a new build, new models. */
  revision?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<string | undefined>(() => readReviewed()[id]);

  // Falling back to the reviewed value keeps a settled section from flashing a
  // highlight while its revision is still loading.
  const current = revision ?? seen ?? "1";
  const review = seen === undefined ? "unreviewed" : seen !== current ? "updated" : null;

  const markReviewed = () => {
    if (seen === current) return;
    writeReviewed(id, current);
    setSeen(current);
  };

  // Touching a control counts as reviewing the section; opening it to look does not.
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button, a")) markReviewed();
  };

  return (
    <div
      className={cn(
        "rounded-xl border bg-card shadow-sm transition-colors",
        review && "border-amber-400/70 ring-1 ring-amber-400/30"
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-3 rounded-t-xl px-5 py-4 text-left transition-colors hover:bg-accent/40",
          !open && "rounded-b-xl"
        )}
      >
        <Icon className="h-5 w-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-sm">{title}</h2>
            {review && (
              <span className="rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400">
                {review === "updated" ? "New" : "Review"}
              </span>
            )}
          </div>
          {description && <p className="truncate text-xs text-muted-foreground">{description}</p>}
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
        />
      </button>
      <div
        hidden={!open}
        className="border-t p-5 space-y-4"
        onChangeCapture={markReviewed}
        onClickCapture={handleClick}
      >
        {children}
      </div>
    </div>
  );
}

// ── Field ──────────────────────────────────────────────────────────────────────

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
      {hint && <p className="text-xs text-muted-foreground/70">{hint}</p>}
    </div>
  );
}

// ── Save indicator ────────────────────────────────────────────────────────────

function SaveButton({
  onClick,
  loading,
  saved,
  disabled,
}: {
  onClick: () => void;
  loading: boolean;
  saved: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={cn(
        "flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50",
        saved
          ? "bg-green-100 text-green-700"
          : "bg-primary text-primary-foreground hover:bg-primary/90"
      )}
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : saved ? (
        <Check className="h-3.5 w-3.5" />
      ) : (
        <Save className="h-3.5 w-3.5" />
      )}
      {saved ? "Saved" : "Save"}
    </button>
  );
}

// ── Profile section ───────────────────────────────────────────────────────────

function ProfileSection() {
  const qc = useQueryClient();
  const [saved, setSaved] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [error, setError] = useState("");

  const { data: profile } = useQuery({
    queryKey: ["settings", "me"],
    queryFn: getMyProfile,
  });

  const mutation = useMutation({
    mutationFn: (body: ProfileUpdate) => updateMyProfile(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings", "me"] });
      setSaved(true);
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
      setTimeout(() => setSaved(false), 2500);
    },
    onError: (e: Error) => setError(e.message),
  });

  const handleSave = () => {
    setError("");
    if (newPw && newPw !== confirmPw) {
      setError("New passwords do not match.");
      return;
    }
    const body: ProfileUpdate = {};
    if (displayName !== profile?.display_name) body.display_name = displayName;
    if (newPw) {
      body.current_password = currentPw;
      body.new_password = newPw;
    }
    if (Object.keys(body).length === 0) return;
    mutation.mutate(body);
  };

  return (
    <Section id="profile" icon={User} title="Profile" description="Your account information">
      <Field label="Email">
        <input
          value={profile?.email ?? ""}
          disabled
          className="w-full rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground cursor-not-allowed"
        />
      </Field>
      <Field label="Display Name">
        <input
          value={displayName || profile?.display_name || ""}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder={profile?.display_name}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
      </Field>
      <Field label="Role">
        <input
          value={profile?.role ?? ""}
          disabled
          className="w-full rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground cursor-not-allowed capitalize"
        />
      </Field>

      {/* Password change */}
      <div className="border-t pt-4 space-y-3">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <KeyRound className="h-3.5 w-3.5" />
          Change Password
        </p>
        <Field label="Current Password">
          <input
            type="password"
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
            placeholder="Leave blank to keep current"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="New Password">
            <input
              type="password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              placeholder="Min 8 characters"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          <Field label="Confirm New Password">
            <input
              type="password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
        </div>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <SaveButton
        onClick={handleSave}
        loading={mutation.isPending}
        saved={saved}
        disabled={!displayName && !newPw}
      />
    </Section>
  );
}

// ── LLM config section ────────────────────────────────────────────────────────

// Embedding model options per provider
const EMBEDDING_MODEL_OPTIONS: Record<string, { value: string; label: string }[]> = {
  voyage: [
    { value: "voyage-3", label: "voyage-3 (1024 dims — recommended)" },
    { value: "voyage-3-lite", label: "voyage-3-lite (512 dims — faster)" },
  ],
  openai: [
    { value: "text-embedding-3-large", label: "text-embedding-3-large (3072 dims — highest quality)" },
    { value: "text-embedding-3-small", label: "text-embedding-3-small (1536 dims — faster)" },
  ],
};

// Static model list for OpenAI (doesn't have a public unauthenticated listing endpoint)
const OPENAI_MODELS = ["gpt-4o", "gpt-4o-mini", "o3", "o4-mini"];

// ── Re-index progress modal ─────────────────────────────────────────────────────────────────────────────────

function ReindexModal({
  open,
  onClose,
  onComplete,
}: {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
}) {
  const [lines, setLines] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLines([]);
    setDone(false);
    setError(null);
    setRunning(true);

    const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000";
    const token = useAuthStore.getState().accessToken;
    const controller = new AbortController();

    fetch(`${API_BASE}/documents/reindex`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token ?? ""}`,
      },
      signal: controller.signal,
    })
      .then(async (resp) => {
        if (!resp.ok) {
          const txt = await resp.text().catch(() => resp.statusText);
          throw new Error(`Re-index failed: ${resp.status} ${txt}`);
        }
        const reader = resp.body!.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
          const { done: streamDone, value } = await reader.read();
          if (streamDone) break;
          buf += decoder.decode(value, { stream: true });
          const parts = buf.split("\n\n");
          buf = parts.pop() ?? "";
          for (const part of parts) {
            const dataLine = part.split("\n").find((l) => l.startsWith("data:"));
            if (!dataLine) continue;
            try {
              const evt = JSON.parse(dataLine.slice(5).trim());
              if (evt.status === "done") {
                setDone(true);
                setRunning(false);
                onComplete();
              } else if (evt.status === "error") {
                setError(evt.detail ?? "Unknown error during re-index");
                setRunning(false);
              } else {
                if (evt.phase === "alter_schema") {
                  setLines((p) => [...p, `⚙ ${evt.detail}`]);
                } else if (evt.processed != null) {
                  const msg = `Embedding: ${evt.doc_title ?? "document"} (${evt.processed}/${evt.total})`;
                  setLines((p) => {
                    const next = [...p];
                    if (next.length > 0 && next[next.length - 1].startsWith("Embedding:")) {
                      next[next.length - 1] = msg;
                    } else {
                      next.push(msg);
                    }
                    return next;
                  });
                }
              }
            } catch {
              // skip malformed SSE line
            }
          }
        }
      })
      .catch((e) => {
        if (e instanceof Error && e.name === "AbortError") return;
        setError(String(e));
        setRunning(false);
      });

    return () => controller.abort();
  }, [open, onComplete]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card rounded-xl border shadow-xl w-full max-w-md mx-4 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <RotateCcw className={cn("h-4 w-4 text-primary", running && "animate-spin")} />
            Re-indexing Knowledge Base
          </h2>
          {!running && (
            <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">
              ✕ Close
            </button>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          All documents are being re-embedded through the active provider. This may take a few minutes.
          {running && " Do not close this window."}
        </p>

        <div className="rounded-md bg-muted p-3 max-h-48 overflow-y-auto space-y-1 font-mono text-xs">
          {lines.length === 0 && running && (
            <p className="text-muted-foreground animate-pulse">Initialising…</p>
          )}
          {lines.map((l, i) => (
            <p key={i} className="text-muted-foreground">{l}</p>
          ))}
          {done && (
            <p className="text-green-600 font-semibold flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 inline" /> Re-index complete — Knowledge Base is up to date.
            </p>
          )}
          {error && (
            <p className="text-destructive">✕ {error}</p>
          )}
        </div>

        {!running && (done || error) && (
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="text-sm rounded-md bg-primary text-primary-foreground px-4 py-2 hover:bg-primary/90"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── LLM config section ─────────────────────────────────────────────────────────────────────────────────

function LLMSection({
  settings,
  onChange,
  onReindexComplete,
}: {
  settings: AppSettings;
  onChange: (s: SettingsUpdate) => void;
  onReindexComplete: () => void;
}) {
  const [openaiKey, setOpenaiKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [voyageKey, setVoyageKey] = useState("");
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [reindexOpen, setReindexOpen] = useState(false);

  const provider = settings.llm_provider ?? "anthropic";
  const embProv = settings.embedding_provider ?? "voyage";

  const { data: ollamaModels = [] } = useQuery({
    queryKey: ["ollama-models"],
    queryFn: getOllamaModels,
    enabled: provider === "ollama" || embProv === "ollama",
    staleTime: 30_000,
  });

  const { data: anthropicModels = [] } = useQuery({
    queryKey: ["anthropic-models"],
    queryFn: getAnthropicModels,
    enabled: provider === "anthropic",
    staleTime: 60_000,
  });

  const { data: aiHealth } = useQuery<SettingsHealthResult>({
    queryKey: ["settings-health"],
    queryFn: getSettingsHealth,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const { data: aiOpts } = useQuery({
    queryKey: ["ai-options"],
    queryFn: getAiOptions,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  // Catalog-driven, key-filtered model list. Providers without an active API
  // key return no models (add the key first, the list refreshes automatically).
  const modelOptions = aiOpts
    ? aiOpts.llm[provider] ?? []
    : provider === "ollama" ? ollamaModels :
      provider === "openai" ? OPENAI_MODELS :
      anthropicModels;

  const embModelOptions =
    embProv === "voyage" ? EMBEDDING_MODEL_OPTIONS.voyage :
    embProv === "openai" ? EMBEDDING_MODEL_OPTIONS.openai :
    ollamaModels.map((m) => ({ value: m, label: m }));

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testConnection(provider);
      setTestResult(result);
    } catch (e) {
      setTestResult({ ok: false, message: String(e) });
    } finally {
      setTesting(false);
    }
  };

  const handleKeyApply = () => {
    const patch: SettingsUpdate = {};
    if (openaiKey) patch.openai_api_key = openaiKey;
    if (anthropicKey) patch.anthropic_api_key = anthropicKey;
    if (voyageKey) patch.voyage_api_key = voyageKey;
    onChange(patch);
    setOpenaiKey("");
    setAnthropicKey("");
    setVoyageKey("");
  };

  const handleReindexComplete = () => {
    setReindexOpen(false);
    onReindexComplete();
  };

  return (
    <>
      <ReindexModal
        open={reindexOpen}
        onClose={() => setReindexOpen(false)}
        onComplete={handleReindexComplete}
      />
      <Section
        id="llm"
        icon={Cpu}
        title="AI / LLM Configuration"
        description="Choose your AI provider and configure models"
        revision={catalogRevision(aiOpts?.llm)}
      >
        {/* ── Compact live status row ────────────────────────────────────────────────── */}
        {aiHealth && (
          <div className="flex flex-wrap items-center gap-3 text-xs rounded-md border bg-muted/50 px-3 py-2">
            <span className="text-muted-foreground font-medium">Live status:</span>
            <span className={cn(
              "flex items-center gap-1",
              aiHealth.llm.status === "ok" ? "text-green-600" : "text-destructive"
            )}>
              <span className={cn(
                "inline-block h-1.5 w-1.5 rounded-full",
                aiHealth.llm.status === "ok" ? "bg-green-500" : "bg-red-500"
              )} />
              LLM ({aiHealth.llm.provider}/{aiHealth.llm.model})
            </span>
            <span className={cn(
              "flex items-center gap-1",
              aiHealth.embedding.status === "ok" ? "text-green-600" : "text-destructive"
            )}>
              <span className={cn(
                "inline-block h-1.5 w-1.5 rounded-full",
                aiHealth.embedding.status === "ok" ? "bg-green-500" : "bg-red-500"
              )} />
              Embeddings ({aiHealth.embedding.provider}/{aiHealth.embedding.model})
              {aiHealth.embedding.status === "ok" && aiHealth.embedding.dimension && (
                <span className="text-muted-foreground">· {aiHealth.embedding.dimension} dims</span>
              )}
            </span>
          </div>
        )}

        {/* Provider selector */}
        <Field label="LLM Provider" hint="Select which AI service powers the assistant.">
          <select
            value={provider}
            onChange={(e) => onChange({ llm_provider: e.target.value })}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="ollama">Ollama (local)</option>
            <option value="openai">OpenAI (cloud)</option>
            <option value="anthropic">Anthropic / Claude (cloud)</option>
          </select>
        </Field>

        {/* Model dropdown */}
        <Field
          label="Chat Model"
          hint={
            provider === "ollama"
              ? "Locally installed Ollama models. Pull more with: ollama pull <model>"
              : provider === "openai"
              ? "OpenAI model to use for chat."
              : "Anthropic Claude model to use for chat."
          }
        >
          <select
            value={settings.llm_model}
            onChange={(e) => onChange({ llm_model: e.target.value })}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            {modelOptions.length === 0 && (
              <option value={settings.llm_model}>{settings.llm_model || "No models found"}</option>
            )}
            {modelOptions.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </Field>

        {/* ── Embedding provider ───────────────────────────────────────────────────────── */}
        <div className="border-t pt-4 space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Document Embeddings</p>
          <p className="text-xs text-muted-foreground">
            Embeddings power Knowledge Base import and Semantic Search — independent of your LLM choice.
            Anthropic has no embedding API; use <strong>Voyage AI</strong> (Anthropic’s partner) or OpenAI.
          </p>
          <Field label="Embedding Provider">
            <select
              value={embProv}
              onChange={(e) => onChange({ embedding_provider: e.target.value })}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="ollama">Ollama (local — nomic-embed-text · 768 dims)</option>
              <option value="voyage">Voyage AI (cloud — voyage-3 · 1024 dims — recommended)</option>
              <option value="openai">OpenAI (cloud — text-embedding-3-small · 1536 dims)</option>
            </select>
          </Field>

          {/* Embedding model — per-provider select */}
          {embProv === "ollama" ? (
            <>
              <Field label="Ollama Server URL" hint="Address of the Ollama server running your embedding model.">
                <input
                  value={settings.ollama_url}
                  onChange={(e) => onChange({ ollama_url: e.target.value })}
                  placeholder="http://localhost:11434"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-ring"
                />
              </Field>
              <Field label="Embedding Model" hint="Ollama model to use for embeddings. Must be pulled first.">
                {ollamaModels.length > 0 ? (
                  <select
                    value={settings.embedding_model}
                    onChange={(e) => onChange({ embedding_model: e.target.value })}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  >
                    {ollamaModels.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                ) : (
                  <input
                    value={settings.embedding_model}
                    onChange={(e) => onChange({ embedding_model: e.target.value })}
                    placeholder="nomic-embed-text"
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                )}
              </Field>
            </>
          ) : (
            <Field
              label="Embedding Model"
              hint={
                embProv === "voyage"
                  ? "voyage-3 gives the highest quality (1024 dims). voyage-3-lite is faster (512 dims)."
                  : "text-embedding-3-large gives the highest quality (3072 dims). text-embedding-3-small is faster (1536 dims)."
              }
            >
              <select
                value={settings.embedding_model}
                onChange={(e) => onChange({ embedding_model: e.target.value })}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              >
                {(embModelOptions.length > 0 ? embModelOptions : [{ value: settings.embedding_model, label: settings.embedding_model }]).map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </Field>
          )}

          {embProv === "voyage" && (
            <div className="rounded-md border border-purple-200 bg-purple-50 dark:bg-purple-950/30 dark:border-purple-800 px-4 py-3 text-xs text-purple-800 dark:text-purple-200 space-y-1">
              <p className="font-semibold">Voyage AI — Anthropic’s recommended embedding partner</p>
              <p>
                {settings.voyage_key_set
                  ? "✓ Voyage API key is configured."
                  : <></>}
                {!settings.voyage_key_set && (
                  <>Get a free key at <strong>dash.voyageai.com</strong> and enter it below.</>
                )}
              </p>
            </div>
          )}

          {embProv === "openai" && (
            <div className="rounded-md border border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800 px-4 py-3 text-xs text-blue-800 dark:text-blue-200 space-y-1">
              <p className="font-semibold">OpenAI Embeddings</p>
              <p>{settings.openai_key_set ? "✓ OpenAI API key is configured." : "Add your OpenAI key below and save."}</p>
            </div>
          )}
        </div>

        {/* ── Re-index warning ───────────────────────────────────────────────────────────────── */}
        {settings.reindex_required && (
          <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 px-4 py-3 space-y-2">
            <p className="flex items-center gap-2 text-xs font-semibold text-amber-800 dark:text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              Knowledge Base re-index required
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-400">
              The embedding provider or model changed and the stored vector dimensions no longer match.
              Semantic search is disabled until you re-index.
            </p>
            <button
              onClick={() => setReindexOpen(true)}
              className="flex items-center gap-1.5 text-xs rounded-md bg-amber-600 text-white px-3 py-1.5 hover:bg-amber-700"
            >
              <RotateCcw className="h-3 w-3" />
              Re-index Now
            </button>
          </div>
        )}

        {/* Voyage AI key */}
        {embProv === "voyage" && (
          <div className="border-t pt-4 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
              <KeyRound className="h-3.5 w-3.5" />
              Voyage AI API Key
            </p>
            {settings.voyage_key_set && (
              <p className="flex items-center gap-1.5 text-xs text-green-600">
                <CheckCircle2 className="h-3.5 w-3.5" /> API key configured
              </p>
            )}
            <Field label={settings.voyage_key_set ? "Replace API Key" : "API Key"} hint="Stored securely in the OS keychain — never saved to disk. Get yours at dash.voyageai.com">
              <input
                type="password"
                value={voyageKey}
                onChange={(e) => setVoyageKey(e.target.value)}
                placeholder="pa-..."
                className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-ring"
              />
            </Field>
            {voyageKey && (
              <button
                onClick={handleKeyApply}
                className="text-xs rounded-md bg-primary text-primary-foreground px-3 py-1.5 hover:bg-primary/90"
              >
                Stage key (save with main Save button)
              </button>
            )}
          </div>
        )}

        {/* Cloud API keys — OpenAI LLM */}
        {provider === "openai" && (
          <div className="border-t pt-4 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
              <KeyRound className="h-3.5 w-3.5" />
              OpenAI API Key
            </p>
            {settings.openai_key_set && (
              <p className="flex items-center gap-1.5 text-xs text-green-600">
                <CheckCircle2 className="h-3.5 w-3.5" /> API key configured
              </p>
            )}
            <Field label="New API Key" hint="Stored securely in the OS keychain — never saved to disk.">
              <input
                type="password"
                value={openaiKey}
                onChange={(e) => setOpenaiKey(e.target.value)}
                placeholder="sk-..."
                className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-ring"
              />
            </Field>
            {openaiKey && (
              <button
                onClick={handleKeyApply}
                className="text-xs rounded-md bg-primary text-primary-foreground px-3 py-1.5 hover:bg-primary/90"
              >
                Stage key (save with main Save button)
              </button>
            )}
          </div>
        )}

        {/* OpenAI key when LLM != openai but embedding = openai */}
        {provider !== "openai" && embProv === "openai" && (
          <div className="border-t pt-4 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
              <KeyRound className="h-3.5 w-3.5" />
              OpenAI API Key <span className="font-normal text-muted-foreground/70">(for embeddings)</span>
            </p>
            {settings.openai_key_set
              ? <p className="flex items-center gap-1.5 text-xs text-green-600"><CheckCircle2 className="h-3.5 w-3.5" /> API key configured</p>
              : (
                <>
                  <Field label="API Key" hint="Stored securely in the OS keychain — never saved to disk.">
                    <input
                      type="password"
                      value={openaiKey}
                      onChange={(e) => setOpenaiKey(e.target.value)}
                      placeholder="sk-..."
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-ring"
                    />
                  </Field>
                  {openaiKey && (
                    <button
                      onClick={handleKeyApply}
                      className="text-xs rounded-md bg-primary text-primary-foreground px-3 py-1.5 hover:bg-primary/90"
                    >
                      Stage key (save with main Save button)
                    </button>
                  )}
                </>
              )
            }
          </div>
        )}

        {provider === "anthropic" && (
          <div className="border-t pt-4 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
              <KeyRound className="h-3.5 w-3.5" />
              Anthropic API Key
            </p>
            {settings.anthropic_key_set && (
              <p className="flex items-center gap-1.5 text-xs text-green-600">
                <CheckCircle2 className="h-3.5 w-3.5" /> API key configured
              </p>
            )}
            <Field label="New API Key" hint="Stored securely in the OS keychain — never saved to disk.">
              <input
                type="password"
                value={anthropicKey}
                onChange={(e) => setAnthropicKey(e.target.value)}
                placeholder="sk-ant-..."
                className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-ring"
              />
            </Field>
            {anthropicKey && (
              <button
                onClick={handleKeyApply}
                className="text-xs rounded-md bg-primary text-primary-foreground px-3 py-1.5 hover:bg-primary/90"
              >
                Stage key (save with main Save button)
              </button>
            )}
          </div>
        )}

        {/* Test connection */}
        <div className="border-t pt-4 flex items-center gap-3">
          <button
            onClick={handleTest}
            disabled={testing}
            className="flex items-center gap-2 text-xs rounded-md border px-3 py-1.5 hover:bg-muted transition-colors disabled:opacity-50"
          >
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Test Connection
          </button>
          {testResult && (
            <span className={cn("flex items-center gap-1 text-xs", testResult.ok ? "text-green-600" : "text-destructive")}>
              {testResult.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
              {testResult.message}
            </span>
          )}
        </div>
      </Section>
    </>
  );
}

// ── Per-task model selection section ──────────────────────────────────────────

// ── Company Profile section (Drive-backed, read-only) ────────────────────────

const COMPANY_PROFILE_TEMPLATE = `# PMI Company Context (always loaded — do not fabricate beyond this)

## Company
Precisian Medical Instruments (PMI) — medical device startup.
Flagship product: VACTOR, [one-line description].

## Key People
| Name | Role | Email |
|------|------|-------|
| ... | ... | ... |

## Key Partners / Stakeholders
- ...

## Regulatory Context
- FDA 510(k), CE Mark, EU MDR, ISO 13485, ISO 14971

## Glossary / Internal Shorthand
- ...

## Ground Rules
- If a fact isn't in this file or a KB/tool result, say so — don't guess.
- For anything beyond this summary, use search_knowledge_base.`;

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

/** Extract a Drive file/folder ID from a pasted ID or a full Drive URL. */
function parseDriveFileId(raw: string): string {
  const s = raw.trim();
  const m =
    s.match(/\/d\/([\w-]{20,})/) ??
    s.match(/\/folders\/([\w-]{20,})/) ??
    s.match(/[?&]id=([\w-]{20,})/) ??
    null;
  return m ? m[1] : s;
}

function CompanyProfileSection() {
  const qc = useQueryClient();
  const [fileIdInput, setFileIdInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showTemplate, setShowTemplate] = useState(false);

  const { data: ctx, isLoading } = useQuery({
    queryKey: ["company-context"],
    queryFn: getCompanyContext,
  });

  const refresh = useMutation({
    mutationFn: refreshCompanyContext,
    onSuccess: (res) => {
      setError(res.ok ? null : res.error);
      qc.invalidateQueries({ queryKey: ["company-context"] });
    },
    onError: () => setError("Refresh failed — is the backend running?"),
  });

  const saveFileId = useMutation({
    mutationFn: () => setCompanyContextFileId(parseDriveFileId(fileIdInput)),
    onSuccess: (res) => {
      setError(res.ok ? null : res.error);
      setFileIdInput("");
      qc.invalidateQueries({ queryKey: ["company-context"] });
    },
    onError: () => setError("Couldn't save the file ID. Please try again."),
  });

  const driveUrl = ctx?.drive_file_id
    ? ctx.source_kind === "folder"
      ? `https://drive.google.com/drive/folders/${ctx.drive_file_id}`
      : `https://drive.google.com/file/d/${ctx.drive_file_id}/view`
    : null;
  const hasContent = !!ctx?.content?.trim();
  const skippedSections = (ctx?.sections ?? []).filter((s) => s.skipped);

  return (
    <Section
      id="company"
      icon={Building2}
      title="Company Profile"
      description="Always-loaded company facts for every agent — edited only in the shared Google Drive file"
    >
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          {hasContent ? (
            <>
              {ctx!.source_kind === "folder" && (
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="rounded-full border px-2 py-0.5 font-medium">
                    Truth folder — {(ctx!.sections ?? []).filter((s) => !s.skipped).length} section(s)
                  </span>
                  {(ctx!.sections ?? [])
                    .filter((s) => !s.skipped)
                    .map((s) => (
                      <span key={s.file_id} className="rounded-full bg-muted px-2 py-0.5">
                        {s.name}
                      </span>
                    ))}
                </div>
              )}
              {skippedSections.length > 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Skipped in last sync:{" "}
                  {skippedSections.map((s) => `${s.name} (${s.skipped})`).join("; ")}
                </p>
              )}
              <div className="rounded-lg border bg-muted/30 px-4 py-3 max-h-80 overflow-y-auto prose prose-sm dark:prose-invert prose-p:my-1.5 prose-headings:mt-3 prose-headings:mb-1.5 text-sm">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{ctx!.content}</ReactMarkdown>
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-dashed px-4 py-4 text-sm text-muted-foreground space-y-2">
              <p>
                No company profile is loaded yet. Either create a small markdown file in a
                shared Drive location (e.g.
                <span className="font-mono text-xs"> Little Gerry/company-context.md</span>)
                OR a <span className="font-medium">truth folder</span> with one markdown per
                section (<span className="font-mono text-xs">01-legal.md, 02-ip.md, …</span>) —
                paste its ID or link below and Little Gerry loads it on every launch. Keep
                the total under 12,000 characters — long documents belong in the Knowledge
                Base.
              </p>
              <button
                onClick={() => setShowTemplate((v) => !v)}
                className="text-xs text-primary hover:underline"
              >
                {showTemplate ? "Hide recommended structure" : "Show recommended structure"}
              </button>
              {showTemplate && (
                <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
                  {COMPANY_PROFILE_TEMPLATE}
                </pre>
              )}
            </div>
          )}

          {/* Sync status + actions */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => refresh.mutate()}
              disabled={refresh.isPending}
              className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              {refresh.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {refresh.isPending ? "Refreshing…" : "Refresh now"}
            </button>
            {driveUrl && (
              <a
                href={driveUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                Open in Google Drive to edit <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
            {ctx?.synced_at && (
              <span className="text-xs text-muted-foreground">
                Last synced: {relTime(ctx.synced_at)}
              </span>
            )}
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          {/* One-time Drive file ID setup / change */}
          <Field
            label={ctx?.drive_file_id ? "Company Profile Drive file or folder" : "Company Profile Drive file or folder ID"}
            hint="Paste a Drive file ID/link (single profile) OR a folder ID/link (a 'truth folder' — one markdown per section, ordered by filename, e.g. 01-legal.md, 02-ip.md). Total cap: 12,000 characters. Syncs on every launch and via Refresh now."
          >
            <div className="flex gap-2">
              <input
                value={fileIdInput}
                onChange={(e) => setFileIdInput(e.target.value)}
                placeholder={ctx?.drive_file_id ?? "e.g. 1AbC… or https://drive.google.com/file/d/…"}
                className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                onClick={() => saveFileId.mutate()}
                disabled={saveFileId.isPending || !fileIdInput.trim()}
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {saveFileId.isPending ? "Saving…" : "Save & sync"}
              </button>
            </div>
          </Field>
        </>
      )}
    </Section>
  );
}

// ── Writing voice section ───────────────────────────────────────────────

/** Surface the backend's own explanation rather than a generic failure. */
function apiErrorMessage(err: unknown, fallback: string): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  // FastAPI validation errors arrive as a list of {msg, loc} objects.
  if (Array.isArray(detail) && detail.length) {
    const msg = (detail[0] as { msg?: string })?.msg;
    if (msg) return `${fallback} (${msg})`;
  }
  return fallback;
}

function WritingVoiceSection() {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const { data: voice, isLoading } = useQuery({
    queryKey: ["writing-voice"],
    queryFn: getWritingVoice,
  });

  const done = (message: string | null) => {
    setError(null);
    setNote(message);
    setDraft(null);
    qc.invalidateQueries({ queryKey: ["writing-voice"] });
  };

  const analyze = useMutation({
    mutationFn: () => analyzeWritingVoice(),
    onSuccess: (res) =>
      done(
        `Built from ${res.messages_analyzed} of your sent emails. Read it through — ` +
          "edit anything that doesn't sound like you.",
      ),
    onError: (e: unknown) => {
      setNote(null);
      setError(apiErrorMessage(e, "Couldn't analyse your sent mail."));
    },
  });

  const save = useMutation({
    mutationFn: (profile: string) => saveWritingVoice({ profile }),
    onSuccess: () => done("Saved. Gerry will write in this voice from your next draft."),
    onError: (e: unknown) => setError(apiErrorMessage(e, "Couldn't save your profile.")),
  });

  const toggleDocs = useMutation({
    mutationFn: (use_for_documents: boolean) => saveWritingVoice({ use_for_documents }),
    onSuccess: () => done(null),
    onError: (e: unknown) => setError(apiErrorMessage(e, "Couldn't change that setting.")),
  });

  const upload = useMutation({
    mutationFn: (file: File) => uploadWritingVoice(file),
    onSuccess: () => done("Profile uploaded."),
    onError: (e: unknown) => setError(apiErrorMessage(e, "Couldn't read that file.")),
  });

  const remove = useMutation({
    mutationFn: deleteWritingVoice,
    onSuccess: () => done("Profile removed. Drafts go back to the standard house voice."),
    onError: (e: unknown) => setError(apiErrorMessage(e, "Couldn't remove your profile.")),
  });

  const profile = voice?.profile ?? "";
  const editing = draft !== null;

  return (
    <Section
      id="writing-voice"
      icon={PenLine}
      title="Writing Voice"
      description="A description of how you write, so Gerry's drafts sound like you and not like a robot"
    >
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Gerry can read the last six months of your sent mail and write a detailed profile
            of your voice — cadence, phrasing, sign-offs, how direct you are with different
            people. It is saved to your account only; nobody else on this install sees or uses
            it. Nothing is sent anywhere: the analysis runs against your own mailbox using the
            model you already have configured.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => analyze.mutate()}
              disabled={analyze.isPending}
              className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {analyze.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {analyze.isPending
                ? "Reading your sent mail…"
                : profile
                  ? "Rebuild from my sent mail"
                  : "Analyse my sent mail"}
            </button>

            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={upload.isPending}
              className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              <Upload className="h-3.5 w-3.5" />
              {upload.isPending ? "Uploading…" : "Upload a .md profile"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.markdown,.txt"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload.mutate(f);
                e.target.value = "";
              }}
            />

            {profile && !editing && (
              <button
                onClick={() => setDraft(profile)}
                className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
              >
                <Pencil className="h-3.5 w-3.5" /> Edit
              </button>
            )}
            {profile && (
              <button
                onClick={() => remove.mutate()}
                disabled={remove.isPending}
                className="flex items-center gap-2 rounded-md border border-destructive/40 px-3 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" /> Remove
              </button>
            )}
            {voice?.updated_at && (
              <span className="text-xs text-muted-foreground">
                Updated {relTime(voice.updated_at)}
              </span>
            )}
          </div>

          {analyze.isPending && (
            <p className="text-xs text-muted-foreground">
              This reads up to 120 emails and takes a few minutes. You can leave this page —
              it keeps running.
            </p>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
          {note && <p className="text-xs text-emerald-600 dark:text-emerald-400">{note}</p>}

          {editing ? (
            <div className="space-y-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={20}
                className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-ring"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => save.mutate(draft)}
                  disabled={save.isPending}
                  className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {save.isPending ? "Saving…" : "Save"}
                </button>
                <button
                  onClick={() => setDraft(null)}
                  className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : profile ? (
            <>
              <div className="max-h-96 overflow-y-auto rounded-lg border bg-muted/30 px-4 py-3 prose prose-sm dark:prose-invert prose-p:my-1.5 prose-headings:mt-3 prose-headings:mb-1.5 text-sm">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{profile}</ReactMarkdown>
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={voice?.use_for_documents ?? false}
                  onChange={(e) => toggleDocs.mutate(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border"
                />
                <span>
                  Use this voice for other writing too
                  <span className="block text-xs text-muted-foreground">
                    Emails always use it. Turn this on and Gerry will also apply it to
                    summaries, chat replies and documents it writes for you.
                  </span>
                </span>
              </label>
            </>
          ) : (
            <div className="rounded-lg border border-dashed px-4 py-4 text-sm text-muted-foreground">
              No profile yet. Click <span className="font-medium">Analyse my sent mail</span>{" "}
              to have Gerry write one for you, or upload a markdown file you have already
              written using the button above — it lands here and starts shaping your drafts
              immediately.
            </div>
          )}
        </>
      )}
    </Section>
  );
}

// ── Task models section ─────────────────────────────────────────────────
function ExtractionSchemasSection() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const { data: schemas = [] } = useQuery({
    queryKey: ["extraction-schemas"],
    queryFn: listExtractionSchemas,
    refetchOnWindowFocus: false,
  });

  const text = draft ?? JSON.stringify(schemas, null, 2);

  const saveMut = useMutation({
    mutationFn: (parsed: { name: string; description: string; schema: Record<string, unknown> }[]) =>
      saveExtractionSchemas(parsed),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["extraction-schemas"] });
      setDraft(null);
      setError(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
    onError: (e: unknown) => {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail || "Could not save the schemas.");
    },
  });

  function save() {
    setError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setError("Not valid JSON — fix the syntax and try again.");
      return;
    }
    if (!Array.isArray(parsed)) {
      setError("Expected a JSON list of {name, description, schema} entries.");
      return;
    }
    saveMut.mutate(parsed as { name: string; description: string; schema: Record<string, unknown> }[]);
  }

  return (
    <Section
      id="extraction-schemas"
      icon={ScanText}
      title="Extraction Schemas"
      description="Named field shapes for vision document extraction — used by 'Extract data' and by Gerry's extract_document tool (schema_name)."
    >
      <Field
        label="Schemas (JSON list)"
        hint='Each entry: {"name": "invoice", "description": "…", "schema": {…}}. Names are what you (and Gerry) reference.'
      >
        <textarea
          value={text}
          onChange={(e) => setDraft(e.target.value)}
          rows={14}
          spellCheck={false}
          className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-ring resize-y"
        />
      </Field>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex items-center gap-2">
        <SaveButton onClick={save} loading={saveMut.isPending} saved={saved} disabled={draft === null} />
        {draft !== null && (
          <button
            onClick={() => { setDraft(null); setError(null); }}
            className="rounded-md border px-4 py-2 text-sm text-muted-foreground hover:bg-accent"
          >
            Discard changes
          </button>
        )}
      </div>
    </Section>
  );
}

function DriveEditPermissionsSection() {
  const qc = useQueryClient();

  const { data: grants = [], isLoading } = useQuery({
    queryKey: ["drive-edit-grants"],
    queryFn: listDriveEditGrants,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const revokeMut = useMutation({
    mutationFn: (fileId: string) => revokeDriveEdit(fileId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["drive-edit-grants"] }),
  });

  return (
    <Section
      id="drive-edit-permissions"
      icon={ShieldCheck}
      title="Drive Edit Permissions"
      description="The Google Drive files Gerry may change directly. Permission is granted one file at a time, from the prompt she shows in chat."
      revision={grants.map((g) => g.file_id).sort().join("|") || "none"}
    >
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : grants.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Gerry can&rsquo;t edit any Drive file. When she needs to change one she&rsquo;ll ask, and
          allowing it covers that file only.
        </p>
      ) : (
        <ul className="space-y-2">
          {grants.map((g) => (
            <li key={g.file_id} className="flex items-center gap-3 rounded-md border p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{g.file_name || g.file_id}</p>
                <p className="text-xs text-muted-foreground">
                  {g.edit_count > 0
                    ? `Edited ${g.edit_count} time${g.edit_count === 1 ? "" : "s"}`
                    : "Not edited yet"}
                  {g.granted_at ? ` · granted ${new Date(g.granted_at).toLocaleDateString()}` : ""}
                </p>
              </div>
              {g.file_url && (
                <a
                  href={g.file_url}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  title="Open in Google Drive"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              )}
              <button
                onClick={() => revokeMut.mutate(g.file_id)}
                disabled={revokeMut.isPending}
                className="shrink-0 rounded-md border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function TaskModelsSection() {
  const qc = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["task-models"],
    queryFn: getTaskModels,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const { data: aiOpts } = useQuery({
    queryKey: ["ai-options"],
    queryFn: getAiOptions,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const updateMut = useMutation({
    mutationFn: (body: TaskModelUpdate) => updateTaskModel(body),
    onSuccess: () => {
      setMessage(null);
      qc.invalidateQueries({ queryKey: ["task-models"] });
    },
    onError: (e: Error) => setMessage(e.message),
  });

  const refreshMut = useMutation({
    mutationFn: refreshModels,
    onSuccess: () => {
      setMessage("Model list refreshed.");
      qc.invalidateQueries({ queryKey: ["ai-options"] });
      qc.invalidateQueries({ queryKey: ["task-models"] });
    },
    onError: (e: Error) => setMessage(e.message),
  });

  const providers: Record<string, string[]> = aiOpts?.llm ?? {};
  const newModels = new Set(aiOpts?.new_models ?? []);
  const providerLabels: Record<string, string> = {
    anthropic: "Anthropic / Claude",
    openai: "OpenAI",
    ollama: "Ollama (local)",
  };

  // A recommendation like "claude-haiku-4-5" should match dated catalog
  // snapshots such as "claude-haiku-4-5-20251001".
  const modelMatches = (alias: string, id: string) =>
    id === alias || id.startsWith(`${alias}-`);

  const handleSelect = (task: TaskModel, value: string) => {
    if (value === "__global__") {
      updateMut.mutate({ task: task.task });
    } else {
      const sep = value.indexOf("::");
      updateMut.mutate({
        task: task.task,
        provider: value.slice(0, sep),
        model: value.slice(sep + 2),
      });
    }
  };

  return (
    <Section
      id="task-models"
      icon={SlidersHorizontal}
      title="Models per Task"
      description="Pick a different model for each kind of work — default is your global model"
      revision={catalogRevision(aiOpts?.llm)}
    >
      <p className="text-xs text-muted-foreground">
        Each category uses your global model unless you override it here. Only models from
        providers with an active API key are listed (Ollama: only when the local server is
        running). Little Gerry never switches models on its own.
      </p>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading task categories…</p>
      ) : (
        <div className="space-y-3">
          {tasks.map((t) => {
            const current = t.override_provider && t.override_model
              ? `${t.override_provider}::${t.override_model}`
              : "__global__";
            const recommendedAvailable =
              (providers[t.recommended_provider] ?? []).some((m) => modelMatches(t.recommended_model, m));
            const isRecommendedActive =
              t.effective_provider === t.recommended_provider &&
              modelMatches(t.recommended_model, t.effective_model);
            return (
              <div key={t.task} className="rounded-lg border px-4 py-3 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-sm font-medium flex items-center gap-1.5">
                      {t.label}
                      {isRecommendedActive && (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 px-1.5 py-0.5 text-[10px] font-semibold">
                          <Star className="h-2.5 w-2.5" /> Recommended
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">{t.description}</p>
                  </div>
                  <span className="text-[11px] font-mono text-muted-foreground shrink-0">
                    {t.effective_provider}/{t.effective_model}
                  </span>
                </div>
                <select
                  value={current}
                  onChange={(e) => handleSelect(t, e.target.value)}
                  disabled={updateMut.isPending}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                >
                  <option value="__global__">Global default</option>
                  {Object.entries(providers).map(([prov, models]) =>
                    models.length > 0 ? (
                      <optgroup key={prov} label={providerLabels[prov] ?? prov}>
                        {models.map((m) => (
                          <option key={`${prov}::${m}`} value={`${prov}::${m}`}>
                            {m}
                            {prov === t.recommended_provider && modelMatches(t.recommended_model, m) ? " ★ Recommended" : ""}
                            {newModels.has(m) ? " · NEW" : ""}
                          </option>
                        ))}
                      </optgroup>
                    ) : null
                  )}
                </select>
                <p className="text-[11px] text-muted-foreground/80">
                  Recommended: <span className="font-mono">{t.recommended_model}</span>
                  {" — "}{t.recommended_reason}
                  {!recommendedAvailable && " (not in your current model list — refresh models or check the provider key)"}
                </p>
              </div>
            );
          })}
        </div>
      )}

      <div className="border-t pt-3 flex items-center justify-between gap-3 flex-wrap">
        <button
          onClick={() => refreshMut.mutate()}
          disabled={refreshMut.isPending}
          className="flex items-center gap-2 text-xs rounded-md border px-3 py-1.5 hover:bg-muted transition-colors disabled:opacity-50"
        >
          {refreshMut.isPending
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh model list
        </button>
        <span className="text-[11px] text-muted-foreground/70">
          {aiOpts?.updated_at
            ? `Models scanned ${new Date(aiOpts.updated_at).toLocaleString()} · rescans weekly`
            : "Model list rescans weekly"}
        </span>
      </div>

      {message && <p className="text-xs text-muted-foreground">{message}</p>}
    </Section>
  );
}

// All IANA timezones, built from Intl API with a static fallback
const IANA_TIMEZONES: string[] = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone");
  } catch {
    return [
      "UTC",
      "America/New_York", "America/Chicago", "America/Denver",
      "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu",
      "America/Sao_Paulo", "America/Toronto", "America/Vancouver",
      "Europe/London", "Europe/Paris", "Europe/Berlin",
      "Europe/Amsterdam", "Europe/Rome", "Europe/Madrid",
      "Europe/Moscow", "Africa/Johannesburg",
      "Asia/Dubai", "Asia/Kolkata", "Asia/Bangkok",
      "Asia/Shanghai", "Asia/Tokyo", "Asia/Seoul",
      "Australia/Sydney", "Australia/Melbourne", "Pacific/Auckland",
    ];
  }
})();

// ── Appearance section ─────────────────────────────────────────────────────────

function AppearanceSection({
  settings,
  onChange,
}: {
  settings: AppSettings;
  onChange: (s: SettingsUpdate) => void;
}) {
  return (
    <Section id="appearance" icon={Palette} title="Appearance">
      <Field label="Theme" hint="Changes take effect immediately and persist across restarts.">
        <select
          value={settings.theme}
          onChange={(e) => {
            const v = e.target.value as ThemeValue;
            setTheme(v);
            onChange({ theme: v });
          }}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="system">System (follows OS)</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </Field>
      <Field
        label="Timezone"
        hint={`Type to search — e.g. "New_York" or "London". Used for all dates and times across the app.`}
      >
        <input
          list="tz-options"
          value={settings.timezone}
          onChange={(e) => onChange({ timezone: e.target.value })}
          placeholder="UTC"
          spellCheck={false}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-ring"
        />
        <datalist id="tz-options">
          {IANA_TIMEZONES.map((tz) => (
            <option key={tz} value={tz} />
          ))}
        </datalist>
      </Field>
    </Section>
  );
}

// ── Notifications section ──────────────────────────────────────────────────────

function NotificationsSection({
  settings,
  onChange,
}: {
  settings: AppSettings;
  onChange: (s: SettingsUpdate) => void;
}) {
  return (
    <Section id="notifications" icon={Bell} title="Notifications">
      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={settings.notifications_email_enabled}
          onChange={(e) => onChange({ notifications_email_enabled: e.target.checked })}
          className="h-4 w-4 rounded"
        />
        <div>
          <p className="text-sm font-medium">Email Notifications</p>
          <p className="text-xs text-muted-foreground">
            Send notification emails (requires email integration, coming soon)
          </p>
        </div>
      </label>
    </Section>
  );
}

// ── Voice section ──────────────────────────────────────────────────────────────────────────

function VoiceSection({
  settings,
  onChange,
}: {
  settings: AppSettings;
  onChange: (s: SettingsUpdate) => void;
}) {
  const [googleKey, setGoogleKey] = useState("");

  const { data: voices = [] } = useQuery({
    queryKey: ["tts-voices"],
    queryFn: listVoices,
    enabled: settings.google_key_set,
    staleTime: 24 * 60 * 60 * 1000,
    retry: false,
  });

  return (
    <Section
      id="voice"
      icon={Mic}
      title="Voice"
      description="Speak to Little Gerry and hear replies — powered by Google Cloud Speech"
    >
      <Field
        label={settings.google_key_set ? "Replace Google Cloud API Key" : "Google Cloud API Key"}
        hint="Stored securely in the OS keychain — never saved to disk. Requires Speech-to-Text and Text-to-Speech APIs enabled on your Google Cloud project."
      >
        <input
          type="password"
          value={googleKey}
          onChange={(e) => {
            setGoogleKey(e.target.value);
            onChange({ google_api_key: e.target.value || undefined });
          }}
          placeholder={settings.google_key_set ? "✓ Key configured — paste to replace" : "AIza…"}
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-ring"
        />
      </Field>

      <label className={cn("flex items-center gap-3", settings.google_key_set ? "cursor-pointer" : "opacity-50")}>
        <input
          type="checkbox"
          checked={settings.voice_speak_replies}
          disabled={!settings.google_key_set}
          onChange={(e) => onChange({ voice_speak_replies: e.target.checked })}
          className="h-4 w-4 rounded"
        />
        <div>
          <p className="text-sm font-medium">Speak replies aloud</p>
          <p className="text-xs text-muted-foreground">
            Read assistant chat replies out loud when they finish
          </p>
        </div>
      </label>

      <Field label="Voice" hint="Studio and Neural2 voices sound the most natural.">
        <select
          value={settings.voice_voice_name}
          disabled={!settings.google_key_set}
          onChange={(e) => onChange({ voice_voice_name: e.target.value })}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        >
          {voices.length === 0 && (
            <option value={settings.voice_voice_name}>{settings.voice_voice_name}</option>
          )}
          {voices.map((v) => (
            <option key={v.name} value={v.name}>
              {v.name} ({v.gender})
            </option>
          ))}
        </select>
      </Field>

      {!settings.google_key_set && (
        <p className="text-xs text-muted-foreground">
          Add a Google Cloud API key and save to enable the microphone button in chat and spoken replies.
        </p>
      )}
    </Section>
  );
}
// ── System Health section ──────────────────────────────────────────────

function StatusPill({ status, detail }: { status?: string; detail?: string }) {
  const ok = status === "ok";
  const warn = status === "warn";
  return (
    <span
      title={detail}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        ok ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
          : warn ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
          : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
      )}
    >
      {ok ? <CheckCircle2 className="h-3 w-3" /> : warn ? <Activity className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
      {status ?? "unknown"}
    </span>
  );
}

function SystemHealthSection() {
  const { data: health, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["system-health"],
    queryFn: getSystemHealth,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const checks = health?.checks ?? {};

  // AI Engine label: use the active provider from the llm check
  const llmCheck = (checks.llm ?? checks.ollama) as { status?: string; provider?: string; model?: string; detail?: string } | undefined;
  const embCheck = checks.embedding as { status?: string; provider?: string; model?: string; dimension?: number; detail?: string } | undefined;
  const providerLabels: Record<string, string> = {
    ollama: "AI Engine (Ollama)",
    openai: "AI Engine (OpenAI)",
    anthropic: "AI Engine (Anthropic)",
  };
  const llmLabel = providerLabels[llmCheck?.provider ?? ""] ?? "AI Engine";

  return (
    <Section
      id="system-health"
      icon={Activity}
      title="System Health"
      description="Live status of backend services"
    >
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs text-muted-foreground">
          Overall:{" "}
          <span className={cn(
            "font-semibold",
            health?.status === "ok" ? "text-green-600" : "text-yellow-600"
          )}>
            {health?.status ?? "..."}
          </span>
        </p>
        <button
          onClick={() => refetch()}
          disabled={isLoading || isRefetching}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className={cn("h-3 w-3", (isLoading || isRefetching) && "animate-spin")} />
          Refresh
        </button>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Checking services…</p>
      ) : (
        <div className="space-y-2">
          {/* Database */}
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-sm">
              <Database className="h-3.5 w-3.5 text-muted-foreground" />
              Database (PostgreSQL)
            </span>
            <StatusPill status={checks.database?.status} detail={checks.database?.detail} />
          </div>

          {/* Active LLM provider */}
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-sm">
              <Wifi className="h-3.5 w-3.5 text-muted-foreground" />
              {llmLabel}
            </span>
            <StatusPill status={llmCheck?.status} detail={llmCheck?.detail} />
          </div>

          {/* Embedding provider */}
          {embCheck && (
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-sm">
                <Cpu className="h-3.5 w-3.5 text-muted-foreground" />
                {`Embeddings (${embCheck.provider ?? ""} / ${embCheck.model ?? ""})`}
                {embCheck.status === "ok" && embCheck.dimension && (
                  <span className="text-xs text-muted-foreground">· {embCheck.dimension} dims</span>
                )}
              </span>
              <StatusPill status={embCheck.status} detail={embCheck.detail} />
            </div>
          )}

          {/* Re-index flag */}
          {checks.kb_needs_reindex === true && (
            <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-3 w-3" />
              Knowledge Base re-index required — go to AI Engine settings
            </div>
          )}

          {/* Disk */}
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-sm">
              <HardDrive className="h-3.5 w-3.5 text-muted-foreground" />
              Disk Space
              {checks.disk?.free_gb != null && (
                <span className="text-xs text-muted-foreground">({checks.disk.free_gb} GB free)</span>
              )}
            </span>
            <StatusPill status={checks.disk?.status} detail={checks.disk?.detail} />
          </div>
        </div>
      )}

      {health?.timestamp && (
        <p className="text-[11px] text-muted-foreground/60 pt-1">
          Last checked: {new Date(health.timestamp).toLocaleTimeString()}
        </p>
      )}
    </Section>
  );
}
// ── Backup & restore section ────────────────────────────────────────────────

function BackupRestoreSection() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: summary, isLoading } = useQuery({
    queryKey: ["data-summary"],
    queryFn: getDataSummary,
  });

  const [exportNote, setExportNote] = useState<string | null>(null);
  const [pending, setPending] = useState<{ file: File; manifest: ArchiveManifest } | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restored, setRestored] = useState<RestoreResult | null>(null);

  const exportMutation = useMutation({
    mutationFn: createDataExport,
    onSuccess: (r) => {
      setExportNote(
        `Saved ${r.filename} (${formatBytes(r.bytes)})` +
          (r.skipped_files ? ` — ${r.skipped_files} unreadable file(s) skipped.` : "."),
      );
      qc.invalidateQueries({ queryKey: ["data-summary"] });
    },
    onError: (e: unknown) => {
      setExportNote(e instanceof Error ? e.message : "The backup failed.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteDataExport,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["data-summary"] }),
  });

  const restoreMutation = useMutation({
    mutationFn: runDataImport,
    onSuccess: (r) => {
      setRestored(r);
      setPending(null);
      qc.invalidateQueries();
    },
    onError: (e: unknown) => {
      setRestoreError(e instanceof Error ? e.message : "The restore failed.");
      setPending(null);
    },
  });

  async function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setRestoreError(null);
    setRestored(null);
    setInspecting(true);
    try {
      const manifest = await inspectDataImport(file);
      setPending({ file, manifest });
    } catch (err: unknown) {
      setRestoreError(err instanceof Error ? err.message : "That file is not a Little Gerry backup.");
    } finally {
      setInspecting(false);
    }
  }

  const counts = summary?.counts ?? {};
  const busy = exportMutation.isPending || restoreMutation.isPending;

  return (
    <Section
      id="backup-restore"
      icon={HardDrive}
      title="Backup & Restore"
      description="Save everything to a single file, or move it to another computer"
    >
      <p className="text-xs text-muted-foreground">
        A backup holds your conversations, tasks, workrooms, documents and the whole knowledge
        base. It does <span className="font-medium">not</span> hold your API keys or your Google
        connection — after restoring you sign in to Google again and paste your keys back in.
      </p>

      {isLoading ? (
        <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking what you have…
        </div>
      ) : (
        <>
          {summary && !summary.docker_running && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-400/60 bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                The database isn't running, so backup and restore are unavailable. Start Little
                Gerry normally and come back.
              </span>
            </div>
          )}

          {summary && (
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border bg-muted/40 p-3 text-xs sm:grid-cols-3">
              {Object.entries(counts).map(([label, n]) => (
                <div key={label} className="flex justify-between gap-2">
                  <span className="text-muted-foreground capitalize">{label.replace(/_/g, " ")}</span>
                  <span className="font-medium tabular-nums">{n.toLocaleString()}</span>
                </div>
              ))}
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Database</span>
                <span className="font-medium tabular-nums">{formatBytes(summary.database_bytes)}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Document files</span>
                <span className="font-medium tabular-nums">
                  {summary.document_files.toLocaleString()} · {formatBytes(summary.document_bytes)}
                </span>
              </div>
            </div>
          )}

          {/* Create */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setExportNote(null);
                exportMutation.mutate();
              }}
              disabled={busy || !summary?.docker_running}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {exportMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              {exportMutation.isPending ? "Backing up…" : "Back up everything"}
            </button>
            {summary?.directory && (
              <span className="text-[11px] text-muted-foreground">
                Saved to <code className="font-mono">{summary.directory}</code>
              </span>
            )}
          </div>
          {exportMutation.isPending && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              This can take several minutes on a large library. Leave the window open.
            </p>
          )}
          {exportNote && (
            <p
              className={cn(
                "mt-2 text-xs",
                exportMutation.isError ? "text-red-600" : "text-green-600",
              )}
            >
              {exportNote}
            </p>
          )}

          {/* Existing archives */}
          {summary && summary.archives.length > 0 && (
            <div className="mt-4 space-y-1">
              <p className="text-xs font-medium">Backups on this computer</p>
              {summary.archives.map((a) => (
                <div
                  key={a.filename}
                  className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs"
                >
                  <Database className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate font-mono">{a.filename}</span>
                  <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">
                    {formatBytes(a.bytes)}
                  </span>
                  <button
                    type="button"
                    onClick={() => deleteMutation.mutate(a.filename)}
                    disabled={busy || deleteMutation.isPending}
                    title="Delete this backup"
                    className="shrink-0 text-muted-foreground hover:text-red-600 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Restore */}
          <div className="mt-5 border-t pt-4">
            <p className="text-xs font-medium">Restore from a backup</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Restoring <span className="font-medium text-red-600">replaces everything</span>{" "}
              currently in Little Gerry with the contents of the backup file. A safety copy of your
              current database is taken first.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".lgbackup"
              onChange={handlePick}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy || inspecting || !summary?.docker_running}
              className="mt-2 flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
            >
              {inspecting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
              Choose a backup file…
            </button>

            {restoreError && <p className="mt-2 text-xs text-red-600">{restoreError}</p>}

            {pending && (
              <div className="mt-3 rounded-lg border border-red-400/60 bg-red-50 p-3 text-xs dark:bg-red-950/30">
                <p className="font-medium">{pending.file.name}</p>
                <p className="mt-1 text-muted-foreground">
                  Made {new Date(pending.manifest.created_at).toLocaleString()} by Little Gerry{" "}
                  {pending.manifest.app_version} — {pending.manifest.documents ?? 0} document(s).
                </p>
                {pending.manifest.reconnect_required && (
                  <p className="mt-1 text-amber-700 dark:text-amber-300">
                    This backup came from a different computer, so you'll need to reconnect Google
                    and re-enter your API keys afterwards.
                  </p>
                )}
                <p className="mt-2 font-medium text-red-700 dark:text-red-300">
                  Everything currently in Little Gerry will be replaced. This cannot be undone from
                  inside the app.
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => restoreMutation.mutate(pending.file)}
                    disabled={restoreMutation.isPending}
                    className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {restoreMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {restoreMutation.isPending ? "Restoring…" : "Replace everything"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPending(null)}
                    disabled={restoreMutation.isPending}
                    className="rounded-lg border px-3 py-1.5 font-medium hover:bg-accent disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {restored && (
              <div className="mt-3 rounded-lg border border-green-500/60 bg-green-50 p-3 text-xs dark:bg-green-950/30">
                <p className="font-medium text-green-700 dark:text-green-300">
                  Restored {restored.restored.documents} document(s).
                </p>
                <p className="mt-1">
                  Close Little Gerry and open it again so everything reloads.
                  {restored.reconnect_required &&
                    " Then reconnect Google Workspace and re-enter your API keys in Settings."}
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </Section>
  );
}

// ── Software updates section ────────────────────────────────────────────────

function UpdateSection() {
  const [everChecked, setEverChecked] = useState(false);
  const [applyMessage, setApplyMessage] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  const {
    data: updateStatus,
    isFetching,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["update-status"],
    queryFn: checkForUpdate,
    enabled: false,   // only fetch on demand
    retry: false,
  });

  async function handleCheck() {
    setEverChecked(true);
    setApplyMessage(null);
    setApplyError(null);
    await refetch();
  }

  async function handleApply() {
    setApplying(true);
    setApplyMessage(null);
    setApplyError(null);
    try {
      const result = await applyUpdate();
      setApplyMessage(result.message);
    } catch (e: unknown) {
      setApplyError(e instanceof Error ? e.message : "Update failed — check the terminal for details.");
    } finally {
      setApplying(false);
    }
  }

  // Derive a human-readable error
  const checkErrorMsg = isError
    ? (error instanceof Error ? error.message : "Could not reach the update server.")
    : null;

  return (
    <Section
      id="updates"
      icon={Download}
      title="Software Updates"
      description="Pull the latest features from GitHub"
      revision={String(BUILD_NUMBER)}
    >
      {/* Action row */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleCheck}
          disabled={isFetching || applying}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/20 disabled:opacity-50"
        >
          {isFetching
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <RefreshCw className="h-3.5 w-3.5" />}
          {isFetching ? "Checking…" : "Check for Updates"}
        </button>
        {isFetching && (
          <span className="text-xs text-muted-foreground animate-pulse">
            Contacting GitHub…
          </span>
        )}
      </div>

      {/* Checking in progress — prominent status */}
      {isFetching && (
        <div className="mt-3 flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          Checking for updates — comparing local version with GitHub…
        </div>
      )}

      {/* Error state */}
      {!isFetching && everChecked && checkErrorMsg && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">Update check failed</p>
            <p className="text-xs mt-0.5 opacity-80">{checkErrorMsg}</p>
          </div>
        </div>
      )}

      {/* Result panel */}
      {!isFetching && !checkErrorMsg && everChecked && updateStatus && (
        <div className="mt-3 rounded-md border p-3 text-sm space-y-2">
          {/* Current version row */}
          <div className="flex items-center gap-2 flex-wrap">
            <GitBranch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground">Installed:</span>
            <code className="font-mono text-xs">{updateStatus.current_sha}</code>
          </div>

          {/* Up to date */}
          {updateStatus.up_to_date && (
            <div className="flex items-center gap-2 rounded-md bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span className="font-medium">Already up to date</span>
              <span className="text-xs opacity-70 ml-1">— you have the latest version.</span>
            </div>
          )}

          {/* Update available */}
          {!updateStatus.up_to_date && (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <GitBranch className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                <span className="text-muted-foreground">Latest:</span>
                <code className="font-mono text-xs">{updateStatus.latest_sha}</code>
                <span className="text-xs text-muted-foreground truncate max-w-[240px]">
                  {updateStatus.latest_message}
                </span>
              </div>
              <div className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                A new version is available. Click <strong>Install Update</strong> to pull it and restart services.
              </div>
              <button
                onClick={handleApply}
                disabled={applying}
                className="inline-flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                {applying
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Download className="h-3.5 w-3.5" />}
                {applying ? "Installing…" : "Install Update"}
              </button>
            </>
          )}

          {/* Apply success */}
          {applyMessage && (
            <div className="flex items-start gap-2 rounded-md bg-green-500/10 px-3 py-2 text-xs text-green-700 dark:text-green-400">
              <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{applyMessage}</span>
            </div>
          )}

          {/* Apply error */}
          {applyError && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <XCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{applyError}</span>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}function ChangelogSection() {
  const [expanded, setExpanded] = useState<number | null>(CHANGELOG[0]?.build ?? null);
  return (
    <Section id="changelog" icon={BookOpen} title="What's New" description={`Build ${BUILD_NUMBER} · ${BUILD_DATE}`} revision={String(BUILD_NUMBER)}>
      <div className="space-y-2">
        {CHANGELOG.map((entry) => (
          <div key={entry.build} className="rounded-lg border overflow-hidden">
            <button
              onClick={() => setExpanded(expanded === entry.build ? null : entry.build)}
              className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-accent/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                  b{entry.build}
                </span>
                <span className="text-sm font-medium">{entry.title}</span>
              </div>
              <span className="text-xs text-muted-foreground shrink-0 ml-2">{entry.date}</span>
            </button>
            {expanded === entry.build && (
              <ul className="px-4 pb-3 pt-1 space-y-1 border-t bg-muted/30">
                {entry.changes.map((c, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <span className="mt-0.5 shrink-0 text-primary">•</span>
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}

// ── Hub connection ────────────────────────────────────────────────────────────

function HubSection() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const { data: status, isLoading } = useQuery({
    queryKey: ["hub", "status"],
    queryFn: getHubStatus,
    retry: false,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["hub"] });
  };

  const connect = async () => {
    setBusy(true);
    setMessage("A browser window has opened. Sign in there with your work account.");
    try {
      const result = await connectHub();
      setMessage(
        result.status === "success"
          ? `Connected as ${result.email}.`
          : (result.message ?? "Sign-in failed."),
      );
      refresh();
    } catch (err) {
      setMessage(apiErrorMessage(err, "The hub sign-in could not be started."));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await disconnectHub();
      setMessage("Disconnected. Nothing from the hub is kept on this computer.");
      refresh();
    } catch (err) {
      setMessage(apiErrorMessage(err, "Could not disconnect."));
    } finally {
      setBusy(false);
    }
  };

  // On the hub itself the endpoint is absent, and there is nothing to connect to.
  if (!isLoading && !status) return null;

  return (
    <Section
      id="hub"
      icon={Wifi}
      title="The hub"
      description={
        status?.connected
          ? `Connected as ${status.email}`
          : "See the work the firm shares"
      }
      revision="1"
    >
      <p className="text-sm text-muted-foreground">
        The hub holds the projects the firm works on together. Connecting signs you
        in as yourself, so what you see and what you change is recorded under your
        name. Shared work is read from the hub each time and never copied onto this
        computer.
      </p>

      {status && !status.available && (
        <p className="rounded-md border border-amber-400/60 bg-amber-400/10 p-3 text-sm">
          This build has no hub address or sign-in client configured, so it cannot
          reach the hub yet.
        </p>
      )}

      {status?.last_error && (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
          {status.last_error}
        </p>
      )}

      {message && <p className="text-sm">{message}</p>}

      <div className="flex items-center gap-2">
        {status?.connected ? (
          <button
            type="button"
            onClick={disconnect}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
            Disconnect
          </button>
        ) : (
          <button
            type="button"
            onClick={connect}
            disabled={busy || !status?.available}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wifi className="h-4 w-4" />}
            Connect to the hub
          </button>
        )}
        {status?.hub_url && (
          <span className="truncate text-xs text-muted-foreground">{status.hub_url}</span>
        )}
      </div>
    </Section>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function SettingsPage() {
  const qc = useQueryClient();
  const [localSettings, setLocalSettings] = useState<SettingsUpdate>({});
  const [settingsSaved, setSettingsSaved] = useState(false);

  const { data: settings, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: getSettings,
  });

  const mutation = useMutation({
    mutationFn: (body: SettingsUpdate) => updateSettings(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["ai-options"] });
      qc.invalidateQueries({ queryKey: ["task-models"] });
      setSettingsSaved(true);
      setLocalSettings({});
      setTimeout(() => setSettingsSaved(false), 2500);
    },
  });

  const handleChange = (patch: SettingsUpdate) => {
    setLocalSettings((prev) => ({ ...prev, ...patch }));
  };

  const mergedSettings: AppSettings = settings
    ? { ...settings, ...localSettings }
    : {
        llm_provider: "anthropic",
        llm_model: "claude-sonnet-4-6",
        ollama_url: "http://localhost:11434",
        embedding_model: "voyage-3",
        embedding_provider: "voyage",
        embedding_dimension: 1024,
        reindex_required: false,
        theme: "system",
        timezone: "UTC",
        notifications_email_enabled: false,
        voice_speak_replies: false,
        voice_voice_name: "en-US-Neural2-C",
        openai_key_set: false,
        anthropic_key_set: false,
        voyage_key_set: false,
        google_key_set: false,
        ...localSettings,
      };

  const hasChanges = Object.keys(localSettings).length > 0;

  return (
    <div className="flex flex-col gap-6 p-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Account, AI configuration, and preferences — open a section to change it. Highlighted
            sections have something you haven't looked at yet.
          </p>
        </div>
        {hasChanges && (
          <SaveButton
            onClick={() => mutation.mutate(localSettings)}
            loading={mutation.isPending}
            saved={settingsSaved}
          />
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading settings…
        </div>
      ) : (
        <div className="space-y-5">
          <ProfileSection />
          <LLMSection
            settings={mergedSettings}
            onChange={handleChange}
            onReindexComplete={() => {
              qc.invalidateQueries({ queryKey: ["settings"] });
              qc.invalidateQueries({ queryKey: ["system-health"] });
              qc.invalidateQueries({ queryKey: ["settings-health"] });
            }}
          />
          <CompanyProfileSection />
          <WritingVoiceSection />
          <TaskModelsSection />
          <ExtractionSchemasSection />
          <DriveEditPermissionsSection />
          <HubSection />
          <AppearanceSection settings={mergedSettings} onChange={handleChange} />
          <NotificationsSection settings={mergedSettings} onChange={handleChange} />
          <VoiceSection settings={mergedSettings} onChange={handleChange} />
          <SystemHealthSection />
          <BackupRestoreSection />
          <UpdateSection />
          <ChangelogSection />

          {hasChanges && (
            <div className="flex justify-end">
              <SaveButton
                onClick={() => mutation.mutate(localSettings)}
                loading={mutation.isPending}
                saved={settingsSaved}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
