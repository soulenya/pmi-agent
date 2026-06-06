/**
 * ModelSwitcher — compact header dropdown to switch LLM provider and model.
 *
 * - Shows current provider + model (truncated)
 * - Expands to a dropdown with provider tabs and model options
 * - Cloud providers show an API key input inline if key not yet set
 * - Saves immediately on selection via PUT /settings
 */
import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BrainCircuit, ChevronDown, Check, KeyRound, Loader2, AlertCircle } from "lucide-react";
import { getSettings, updateSettings, getOllamaModels, getAnthropicModels } from "@/api/settings";
import { cn } from "@/lib/utils";

// ── Static OpenAI list (no unauthenticated listing endpoint) ─────────────────

const OPENAI_MODELS = [
  { id: "gpt-4o",      label: "GPT-4o",       note: "Most capable" },
  { id: "gpt-4o-mini", label: "GPT-4o mini",  note: "Fast & cheap" },
  { id: "o3",          label: "o3",            note: "Reasoning" },
  { id: "o4-mini",     label: "o4-mini",       note: "Fast reasoning" },
];

const PROVIDER_LABELS: Record<string, string> = {
  ollama: "Ollama",
  openai: "OpenAI",
  anthropic: "Anthropic",
};

const PROVIDER_ORDER = ["openai", "anthropic", "ollama"] as const;

function providerLabel(provider: string, model: string): string {
  const short = PROVIDER_LABELS[provider] ?? provider;
  return `${short} · ${model}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ModelSwitcher() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("openai");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [keyError, setKeyError] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const { data: settings, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: getSettings,
    staleTime: 30_000,
  });

  const { data: ollamaModels = [] } = useQuery({
    queryKey: ["ollama-models"],
    queryFn: getOllamaModels,
    enabled: open && activeTab === "ollama",
    staleTime: 30_000,
  });

  const { data: anthropicModels = [] } = useQuery({
    queryKey: ["anthropic-models"],
    queryFn: getAnthropicModels,
    enabled: open && activeTab === "anthropic",
    staleTime: 60_000,
  });

  // Build the model list for the current tab
  const tabModels: { id: string; label: string; note?: string }[] =
    activeTab === "openai" ? OPENAI_MODELS :
    activeTab === "anthropic" ? anthropicModels.map((id) => ({ id, label: id })) :
    ollamaModels.map((id) => ({ id, label: id }));

  const mutation = useMutation({
    mutationFn: updateSettings,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });

  // Sync active tab to current provider when settings load
  useEffect(() => {
    if (settings && !open) setActiveTab(settings.llm_provider ?? "openai");
  }, [settings, open]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setApiKeyInput("");
        setKeyError("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  if (isLoading || !settings) {
    return (
      <div className="flex items-center gap-1.5 rounded-md border bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span>Model</span>
      </div>
    );
  }

  function selectModel(provider: string, modelId: string) {
    const patch: Parameters<typeof updateSettings>[0] = {
      llm_provider: provider,
      llm_model: modelId,
    };
    // Attach pending API key if present
    if (apiKeyInput.trim()) {
      if (provider === "openai") patch.openai_api_key = apiKeyInput.trim();
      if (provider === "anthropic") patch.anthropic_api_key = apiKeyInput.trim();
    }
    mutation.mutate(patch, {
      onSuccess: () => {
        setOpen(false);
        setApiKeyInput("");
        setKeyError("");
      },
    });
  }

  function handleKeyAndSelect(provider: string, modelId: string) {
    const isCloud = provider === "openai" || provider === "anthropic";
    const keySet = provider === "openai" ? settings?.openai_key_set : settings?.anthropic_key_set;
    if (isCloud && !keySet && !apiKeyInput.trim()) {
      setKeyError("Paste your API key above first.");
      return;
    }
    setKeyError("");
    selectModel(provider, modelId);
  }

  const currentLabel = providerLabel(settings.llm_provider, settings.llm_model);
  const tabKeySet = activeTab === "openai" ? settings.openai_key_set
    : activeTab === "anthropic" ? settings.anthropic_key_set
    : true;

  return (
    <div ref={ref} className="relative">
      {/* Trigger button */}
      <button
        onClick={() => { setOpen((o) => !o); setActiveTab(settings.llm_provider ?? "openai"); }}
        className={cn(
          "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors",
          "bg-muted hover:bg-accent hover:text-foreground text-muted-foreground",
          open && "bg-accent text-foreground",
        )}
        title="Switch AI model"
      >
        <BrainCircuit className="h-3.5 w-3.5 shrink-0" />
        <span className="hidden sm:block max-w-[140px] truncate">{currentLabel}</span>
        <ChevronDown className={cn("h-3 w-3 shrink-0 transition-transform", open && "rotate-180")} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-72 rounded-xl border bg-card shadow-lg">
          {/* Provider tabs */}
          <div className="flex border-b">
            {PROVIDER_ORDER.map((p) => (
              <button
                key={p}
                onClick={() => { setActiveTab(p); setApiKeyInput(""); setKeyError(""); }}
                className={cn(
                  "flex-1 py-2 text-xs font-medium transition-colors",
                  activeTab === p
                    ? "border-b-2 border-primary text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {PROVIDER_LABELS[p]}
              </button>
            ))}
          </div>

          <div className="p-2">
            {/* API key row for cloud providers without a key */}
            {(activeTab === "openai" || activeTab === "anthropic") && !tabKeySet && (
              <div className="mb-2 space-y-1.5 rounded-lg bg-muted px-3 py-2">
                <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <KeyRound className="h-3 w-3" />
                  {activeTab === "openai" ? "OpenAI API key" : "Anthropic API key"}
                </p>
                <input
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => { setApiKeyInput(e.target.value); setKeyError(""); }}
                  placeholder={activeTab === "openai" ? "sk-..." : "sk-ant-..."}
                  className="w-full rounded border bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                  autoFocus
                />
                {keyError && (
                  <p className="flex items-center gap-1 text-[11px] text-destructive">
                    <AlertCircle className="h-3 w-3" />
                    {keyError}
                  </p>
                )}
              </div>
            )}

            {/* Key already set — show change option */}
            {(activeTab === "openai" || activeTab === "anthropic") && tabKeySet && (
              <div className="mb-2">
                {apiKeyInput !== undefined && (
                  <div className="space-y-1.5 rounded-lg bg-muted px-3 py-2">
                    <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <KeyRound className="h-3 w-3" />
                      Replace API key (optional)
                    </p>
                    <input
                      type="password"
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      placeholder="Leave blank to keep current key"
                      className="w-full rounded border bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                )}
              </div>
            )}

            {/* Model list */}
            {tabModels.length === 0 && activeTab === "ollama" && (
              <p className="px-3 py-2 text-xs text-muted-foreground">No local models found. Pull one with: ollama pull &lt;model&gt;</p>
            )}
            {tabModels.map((m) => {
              const isActive = settings.llm_provider === activeTab && settings.llm_model === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => handleKeyAndSelect(activeTab, m.id)}
                  disabled={mutation.isPending}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-accent hover:text-foreground text-foreground",
                  )}
                >
                  <span className="flex items-center gap-2">
                    {mutation.isPending && isActive
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : isActive
                      ? <Check className="h-3.5 w-3.5" />
                      : <span className="h-3.5 w-3.5" />
                    }
                    <span>{m.label}</span>
                    {m.note && (
                      <span className="text-[10px] text-muted-foreground">{m.note}</span>
                    )}
                  </span>
                </button>
              );
            })}

            {/* Custom model ID input */}
            <div className="mt-1 border-t pt-2">
              <p className="mb-1 px-2 text-[10px] text-muted-foreground">Custom model ID</p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  const id = (fd.get("custom") as string).trim();
                  if (id) handleKeyAndSelect(activeTab, id);
                }}
                className="flex gap-1.5 px-1"
              >
                <input
                  name="custom"
                  placeholder={
                    activeTab === "ollama" ? "e.g. llama3.3"
                    : activeTab === "openai" ? "e.g. gpt-4.5"
                    : "e.g. claude-opus-4-0"
                  }
                  className="flex-1 rounded border bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                />
                <button
                  type="submit"
                  className="rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
                >
                  Use
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
