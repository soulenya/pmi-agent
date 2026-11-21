/**
 * The AI services the app can use, as the backend lists them
 * (services/llm/providers.py). Names here are only what is shown before that
 * list has loaded.
 */
import { useQuery } from "@tanstack/react-query";
import { getAiProviders, type AiProvider } from "@/api/settings";

const SHORT_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  gemini: "Gemini",
  xai: "Grok",
  mistral: "Mistral",
  deepseek: "DeepSeek",
  groq: "Groq",
  openrouter: "OpenRouter",
  ollama: "Ollama",
  voyage: "Voyage AI",
};

/** A name short enough for a tab or the status bar. */
export function providerShortLabel(key: string): string {
  return SHORT_LABELS[key] ?? key;
}

export function useAiProviders() {
  const query = useQuery({
    queryKey: ["ai-providers"],
    queryFn: getAiProviders,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const providers: AiProvider[] = query.data?.providers ?? [];
  return {
    providers,
    byKey: Object.fromEntries(providers.map((p) => [p.key, p])) as Record<string, AiProvider | undefined>,
    embeddedDocuments: query.data?.embedded_documents ?? 0,
    loaded: query.isSuccess,
  };
}

/**
 * Why a choice of provider and model cannot be saved yet, or null when it can.
 * `models` is the provider's list from the model catalog (empty when unknown);
 * `modelIsLastProviders` says the model is still the one the previous provider had.
 */
export function providerChoiceProblem(
  provider: AiProvider | undefined,
  model: string,
  models: string[],
  modelIsLastProviders: boolean,
): string | null {
  if (!provider) return null;
  if (provider.needs_key && !provider.key_set) return `Save the ${provider.label} API key first.`;
  if (models.length > 0 ? !models.includes(model) : modelIsLastProviders) {
    return `Choose a ${provider.label} model.`;
  }
  return null;
}
