import { useQuery } from "@tanstack/react-query";
import { getHealth } from "@/api/auth";
import { getSettings } from "@/api/settings";
import { cn } from "@/lib/utils";

function Dot({ ok, pulse }: { ok: boolean; pulse?: boolean }) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 rounded-full",
        ok ? "bg-green-500" : "bg-red-500",
        pulse && ok && "animate-pulse",
      )}
    />
  );
}

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  ollama: "Ollama",
};

export function StatusBar() {
  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: getHealth,
    refetchInterval: 30_000,
    retry: false,
  });

  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: getSettings,
    staleTime: 60_000,
    retry: false,
  });

  const dbOk     = health?.checks?.database?.status === "ok";
  const ollamaOk = health?.checks?.ollama?.status === "ok";
  const diskFree = health?.checks?.disk?.free_gb;

  const provider  = settings?.llm_provider ?? "";
  const model     = settings?.llm_model ?? "";
  const providerLabel = PROVIDER_LABELS[provider] ?? provider;

  // Determine if the active provider is reachable
  const providerOk =
    provider === "ollama"    ? ollamaOk :
    provider === "openai"    ? settings?.openai_key_set === true :
    provider === "anthropic" ? settings?.anthropic_key_set === true :
    false;

  // Shorten model name for display (e.g. "gpt-4o-mini", "llama3.2:latest" → "llama3.2")
  const modelShort = model.split(":")[0];

  return (
    <footer className="flex h-7 items-center justify-between border-t bg-muted/40 px-4 text-xs text-muted-foreground">
      <div className="flex items-center gap-4">
        {/* Active AI provider */}
        {provider && (
          <span className="flex items-center gap-1.5 font-medium">
            <Dot ok={!!providerOk} pulse />
            {providerLabel}{modelShort ? ` · ${modelShort}` : ""}
          </span>
        )}

        <span className="flex items-center gap-1.5">
          <Dot ok={dbOk} />
          Database
        </span>

        {provider !== "ollama" && (
          <span className="flex items-center gap-1.5">
            <Dot ok={ollamaOk} />
            Ollama
          </span>
        )}
      </div>

      {diskFree !== undefined && (
        <span className="flex items-center gap-1.5">
          <Dot ok={diskFree >= 1} />
          Disk {diskFree.toFixed(1)} GB free
        </span>
      )}
    </footer>
  );
}
