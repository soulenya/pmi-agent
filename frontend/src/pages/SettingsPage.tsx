import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { User, Cpu, Bell, Palette, Save, Check, Loader2, KeyRound, CheckCircle2, XCircle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { setTheme, type ThemeValue } from "@/hooks/useTheme";
import {
  getSettings,
  updateSettings,
  testConnection,
  getMyProfile,
  updateMyProfile,
  type AppSettings,
  type SettingsUpdate,
  type ProfileUpdate,
} from "@/api/settings";

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ElementType;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-card shadow-sm">
      <div className="flex items-center gap-3 border-b px-5 py-4">
        <Icon className="h-5 w-5 text-primary" />
        <div>
          <h2 className="font-semibold text-sm">{title}</h2>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
      </div>
      <div className="p-5 space-y-4">{children}</div>
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
    <Section icon={User} title="Profile" description="Your account information">
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

function LLMSection({ settings, onChange }: { settings: AppSettings; onChange: (s: SettingsUpdate) => void }) {
  const [openaiKey, setOpenaiKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const provider = settings.llm_provider ?? "ollama";

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

  // Include API keys in the settings update when the user saves
  const handleKeyApply = () => {
    const patch: SettingsUpdate = {};
    if (openaiKey) patch.openai_api_key = openaiKey;
    if (anthropicKey) patch.anthropic_api_key = anthropicKey;
    onChange(patch);
    setOpenaiKey("");
    setAnthropicKey("");
  };

  return (
    <Section
      icon={Cpu}
      title="AI / LLM Configuration"
      description="Choose your AI provider and configure models"
    >
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

      {/* Model name */}
      <Field
        label="Chat Model"
        hint={
          provider === "ollama"
            ? "Ollama model name. Must be pulled locally (e.g. llama3.2)."
            : provider === "openai"
            ? "OpenAI model ID (e.g. gpt-4o, gpt-4o-mini)."
            : "Anthropic model ID (e.g. claude-3-5-haiku-latest)."
        }
      >
        <input
          value={settings.llm_model}
          onChange={(e) => onChange({ llm_model: e.target.value })}
          placeholder={
            provider === "openai" ? "gpt-4o-mini" :
            provider === "anthropic" ? "claude-3-5-haiku-latest" : "llama3.2"
          }
          className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
      </Field>

      {/* Ollama-only fields */}
      {provider === "ollama" && (
        <>
          <Field
            label="Embedding Model"
            hint="Ollama model used for document chunking and semantic search."
          >
            <input
              value={settings.embedding_model}
              onChange={(e) => onChange({ embedding_model: e.target.value })}
              placeholder="nomic-embed-text"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          <Field label="Ollama URL" hint="Local Ollama server address.">
            <input
              value={settings.ollama_url}
              onChange={(e) => onChange({ ollama_url: e.target.value })}
              placeholder="http://localhost:11434"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
        </>
      )}

      {/* Cloud API keys */}
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
  );
}

// ── Appearance section ─────────────────────────────────────────────────────────

function AppearanceSection({
  settings,
  onChange,
}: {
  settings: AppSettings;
  onChange: (s: SettingsUpdate) => void;
}) {
  return (
    <Section icon={Palette} title="Appearance">
      <Field label="Theme">
        <select
          value={settings.theme}
          onChange={(e) => {
            const v = e.target.value as ThemeValue;
            setTheme(v);
            onChange({ theme: v });
          }}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </Field>
      <Field label="Timezone">
        <input
          value={settings.timezone}
          onChange={(e) => onChange({ timezone: e.target.value })}
          placeholder="UTC"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
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
    <Section icon={Bell} title="Notifications">
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

// ── Page ──────────────────────────────────────────────────────────────────────

export function SettingsPage() {
  const [localSettings, setLocalSettings] = useState<SettingsUpdate>({});
  const [settingsSaved, setSettingsSaved] = useState(false);

  const { data: settings, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: getSettings,
  });

  const mutation = useMutation({
    mutationFn: (body: SettingsUpdate) => updateSettings(body),
    onSuccess: () => {
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
        llm_provider: "ollama",
        llm_model: "llama3.2",
        ollama_url: "http://localhost:11434",
        embedding_model: "nomic-embed-text",
        theme: "system",
        timezone: "UTC",
        notifications_email_enabled: false,
        openai_key_set: false,
        anthropic_key_set: false,
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
            Account, AI configuration, and preferences
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
          <LLMSection settings={mergedSettings} onChange={handleChange} />
          <AppearanceSection settings={mergedSettings} onChange={handleChange} />
          <NotificationsSection settings={mergedSettings} onChange={handleChange} />

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
