import { apiClient } from "./client";

/** Where a provider key comes from; null when there is none. */
export type KeySource = "server" | "keyring" | "app" | null;

export interface SetupGuideState {
  /** The brand opens the guide by itself on first use. */
  enabled: boolean;
  /** This person chose "Don't show this again". */
  dismissed: boolean;
  on_hub: boolean;
  /** On a hub only an administrator sets the company's keys. */
  can_set_keys: boolean;
  keys: Record<"anthropic" | "openai" | "voyage" | "google", KeySource>;
  /** The server can send notifications to a browser or phone. */
  push_ready: boolean;
}

export async function getSetupGuide(): Promise<SetupGuideState> {
  const r = await apiClient.get<SetupGuideState>("/setup-guide");
  return r.data;
}

export async function setSetupGuideDismissed(dismissed: boolean): Promise<SetupGuideState> {
  const r = await apiClient.put<SetupGuideState>("/setup-guide", { dismissed });
  return r.data;
}
