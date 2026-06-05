/**
 * First-Run Setup Wizard
 *
 * Shown once after the first successful Google SSO login when no LLM is
 * configured yet.  Lets the user pick a provider, enter credentials, and
 * optionally test the connection before dismissing.
 *
 * Steps:
 *   1  Choose provider  (Anthropic / OpenAI / Ollama)
 *   2  Enter credentials for that provider
 *   3  Test + confirm
 */

import { useState } from "react";
import {
  updateSettings,
  testConnection,
  getOllamaModels,
  getAnthropicModels,
} from "@/api/settings";
import { CheckCircle2, ChevronRight, Loader2, XCircle, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Static model lists ────────────────────────────────────────────────────────

const OPENAI_MODELS = ["gpt-4o", "gpt-4o-mini", "o3", "o4-mini"];

// ── Types ─────────────────────────────────────────────────────────────────────

type Provider = "anthropic" | "openai" | "ollama";

interface Props {
  onComplete: () => void;
}

// ── Provider cards ────────────────────────────────────────────────────────────

const PROVIDERS: { id: Provider; name: string; desc: string; color: string }[] = [
  {
    id: "anthropic",
    name: "Anthropic Claude",
    desc: "Best reasoning and long context. Requires an API key.",
    color: "border-orange-400 bg-orange-50 dark:bg-orange-950/30",
  },
  {
    id: "openai",
    name: "OpenAI GPT",
    desc: "Wide model range including o3/o4. Requires an API key.",
    color: "border-green-400 bg-green-50 dark:bg-green-950/30",
  },
  {
    id: "ollama",
    name: "Ollama (local / network)",
    desc: "Private, runs on your network. No API key needed.",
    color: "border-blue-400 bg-blue-50 dark:bg-blue-950/30",
  },
];

// ── Main component ────────────────────────────────────────────────────────────

export function FirstRunSetup({ onComplete }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [provider, setProvider] = useState<Provider>("anthropic");

  // credentials
  const [apiKey, setApiKey] = useState("");
  const [ollamaUrl, setOllamaUrl] = useState("http://192.168.1.50:11434");
  const [model, setModel] = useState("");

  // model list (fetched on step 2)
  const [modelList, setModelList] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  // save / test state
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Step 1 → 2: choose provider ────────────────────────────────────────────

  async function handleProviderChosen(p: Provider) {
    setProvider(p);
    setModel("");
    setModelList([]);
    setTestResult(null);
    setSaveError(null);
    setStep(2);

    // Pre-fetch model lists for cloud providers
    setLoadingModels(true);
    try {
      if (p === "anthropic") {
        const models = await getAnthropicModels();
        setModelList(models.length ? models : ["claude-sonnet-4-6", "claude-opus-4-8", "claude-haiku-4-5"]);
        setModel(models[0] ?? "claude-sonnet-4-6");
      } else if (p === "openai") {
        setModelList(OPENAI_MODELS);
        setModel(OPENAI_MODELS[0]);
      }
      // ollama: fetch after URL entered
    } catch {
      if (p === "anthropic") {
        setModelList(["claude-sonnet-4-6", "claude-opus-4-8", "claude-haiku-4-5"]);
        setModel("claude-sonnet-4-6");
      } else if (p === "openai") {
        setModelList(OPENAI_MODELS);
        setModel(OPENAI_MODELS[0]);
      }
    } finally {
      setLoadingModels(false);
    }
  }

  // ── Fetch Ollama models after URL is entered ────────────────────────────────

  async function fetchOllamaModels() {
    setLoadingModels(true);
    setModelList([]);
    setModel("");
    setTestResult(null);
    try {
      // Temporarily save the URL so the backend uses it for the model list fetch
      await updateSettings({ ollama_url: ollamaUrl, llm_provider: "ollama" });
      const models = await getOllamaModels();
      if (models.length) {
        setModelList(models);
        setModel(models[0]);
      } else {
        setModelList([]);
        setTestResult({ ok: false, message: "No models found on that server. Is Ollama running and has a model been pulled?" });
      }
    } catch {
      setTestResult({ ok: false, message: "Could not reach the Ollama server. Check the URL and that the server is online." });
    } finally {
      setLoadingModels(false);
    }
  }

  // ── Save + test connection ──────────────────────────────────────────────────

  async function handleSaveAndTest() {
    setSaving(true);
    setSaveError(null);
    setTestResult(null);
    try {
      // Save settings
      const update: Parameters<typeof updateSettings>[0] = {
        llm_provider: provider,
        llm_model: model,
      };
      if (provider === "anthropic") update.anthropic_api_key = apiKey;
      if (provider === "openai")    update.openai_api_key    = apiKey;
      if (provider === "ollama")    update.ollama_url        = ollamaUrl;

      await updateSettings(update);

      // Test connection
      setTesting(true);
      const result = await testConnection(provider);
      setTestResult(result);
      setTesting(false);

      if (result.ok) setStep(3);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to save settings.";
      setSaveError(msg);
    } finally {
      setSaving(false);
      setTesting(false);
    }
  }

  // ── Step 2 validation ───────────────────────────────────────────────────────

  const step2Valid =
    model !== "" &&
    (provider === "ollama"
      ? ollamaUrl.trim().startsWith("http")
      : apiKey.trim().length > 10);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-xl border bg-card shadow-2xl">

        {/* Header */}
        <div className="border-b px-6 py-5">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Set up your AI model</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Little Gerry needs an AI model to work. This takes about 30 seconds.
          </p>
          {/* Step indicator */}
          <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
            {(["Choose provider", "Enter credentials", "Confirm"] as const).map((label, i) => (
              <span key={label} className="flex items-center gap-1">
                <span className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold",
                  step === i + 1 ? "bg-primary text-primary-foreground" : "bg-muted",
                )}>
                  {i + 1}
                </span>
                <span className={step === i + 1 ? "text-foreground font-medium" : ""}>{label}</span>
                {i < 2 && <ChevronRight className="h-3 w-3" />}
              </span>
            ))}
          </div>
        </div>

        <div className="px-6 py-5">

          {/* ── Step 1: Choose provider ─────────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-3">
              <p className="text-sm font-medium mb-1">Which AI provider do you want to use?</p>
              {PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleProviderChosen(p.id)}
                  className={cn(
                    "w-full flex items-start gap-3 rounded-lg border-2 p-4 text-left transition-all hover:shadow-sm",
                    p.color,
                  )}
                >
                  <div className="flex-1">
                    <p className="font-semibold text-sm">{p.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{p.desc}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                </button>
              ))}
            </div>
          )}

          {/* ── Step 2: Enter credentials ───────────────────────────────── */}
          {step === 2 && (
            <div className="space-y-4">
              <button
                onClick={() => { setStep(1); setTestResult(null); setSaveError(null); }}
                className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
              >
                ← Back
              </button>

              <p className="text-sm font-medium">
                {provider === "anthropic" && "Anthropic API Key"}
                {provider === "openai"    && "OpenAI API Key"}
                {provider === "ollama"    && "Ollama Server URL"}
              </p>

              {/* API key input */}
              {(provider === "anthropic" || provider === "openai") && (
                <div className="space-y-2">
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={provider === "anthropic" ? "sk-ant-..." : "sk-..."}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-ring"
                    autoFocus
                  />
                  <p className="text-xs text-muted-foreground">
                    {provider === "anthropic"
                      ? <>Get yours at <span className="font-mono">console.anthropic.com</span></>
                      : <>Get yours at <span className="font-mono">platform.openai.com</span></>
                    }
                  </p>
                </div>
              )}

              {/* Ollama URL */}
              {provider === "ollama" && (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={ollamaUrl}
                      onChange={(e) => { setOllamaUrl(e.target.value); setModelList([]); setModel(""); }}
                      placeholder="http://192.168.1.50:11434"
                      className="flex-1 rounded-md border bg-background px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-ring"
                    />
                    <button
                      onClick={fetchOllamaModels}
                      disabled={loadingModels || !ollamaUrl.startsWith("http")}
                      className="flex items-center gap-1.5 rounded-md border bg-background px-3 py-2 text-xs font-medium hover:bg-accent disabled:opacity-50"
                    >
                      {loadingModels ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                      Connect
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Enter your Ollama server address and click Connect to load available models.
                  </p>
                </div>
              )}

              {/* Model selector */}
              {(modelList.length > 0 || (provider !== "ollama")) && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Model</label>
                  {loadingModels ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading models…
                    </div>
                  ) : modelList.length > 0 ? (
                    <select
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                    >
                      {modelList.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  ) : provider !== "ollama" ? (
                    <p className="text-xs text-muted-foreground">Models will load after saving.</p>
                  ) : null}
                </div>
              )}

              {/* Test result */}
              {testResult && (
                <div className={cn(
                  "flex items-start gap-2 rounded-md px-3 py-2 text-sm",
                  testResult.ok
                    ? "bg-green-500/10 text-green-700 dark:text-green-400"
                    : "bg-destructive/10 text-destructive",
                )}>
                  {testResult.ok
                    ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                    : <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  }
                  {testResult.message}
                </div>
              )}

              {saveError && (
                <p className="text-sm text-destructive">{saveError}</p>
              )}

              <button
                onClick={handleSaveAndTest}
                disabled={!step2Valid || saving || testing}
                className="w-full flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow hover:bg-primary/90 disabled:opacity-50"
              >
                {(saving || testing) && <Loader2 className="h-4 w-4 animate-spin" />}
                {saving ? "Saving…" : testing ? "Testing connection…" : "Save & test connection"}
              </button>
            </div>
          )}

          {/* ── Step 3: Confirm ─────────────────────────────────────────── */}
          {step === 3 && (
            <div className="space-y-4 text-center py-2">
              <CheckCircle2 className="mx-auto h-12 w-12 text-green-500" />
              <div>
                <p className="font-semibold text-base">You're all set!</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {provider === "anthropic" && `Claude is ready. Model: ${model}`}
                  {provider === "openai"    && `OpenAI is ready. Model: ${model}`}
                  {provider === "ollama"    && `Ollama is connected. Model: ${model}`}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                You can change this anytime in{" "}
                <span className="font-medium">Settings → Chat Model</span>.
              </p>
              <button
                onClick={onComplete}
                className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow hover:bg-primary/90"
              >
                Open Little Gerry
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
