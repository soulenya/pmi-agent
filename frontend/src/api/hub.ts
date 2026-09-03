import { apiClient } from "./client";

/** What the desktop knows about its link to the hub. */
export interface HubStatus {
  /** This build has a hub address and a sign-in client, so connecting is possible. */
  available: boolean;
  connected: boolean;
  hub_url: string;
  email: string | null;
  last_error: string | null;
}

export async function getHubStatus(): Promise<HubStatus> {
  const resp = await apiClient.get<HubStatus>("/hub/status");
  return resp.data;
}

export async function initiateHubConnect(hubUrl?: string): Promise<string> {
  const resp = await apiClient.post<{ auth_id: string }>("/hub/connect/initiate", {
    hub_url: hubUrl ?? null,
  });
  return resp.data.auth_id;
}

export interface HubConnectResult {
  status: "pending" | "success" | "error";
  email?: string;
  message?: string;
}

export async function pollHubConnect(authId: string): Promise<HubConnectResult> {
  const resp = await apiClient.get<HubConnectResult>(`/hub/connect/poll/${authId}`);
  return resp.data;
}

export async function disconnectHub(): Promise<void> {
  await apiClient.post("/hub/disconnect");
}

/**
 * Take a local copy of a shared project's chat and bring it up to date.
 *
 * Gerry answers from this machine, where the knowledge base and the Google
 * account are; the hub only keeps the record. Call this before opening the
 * conversation, and it is answered again after each turn.
 */
export async function syncHubConversation(conversationId: string): Promise<void> {
  await apiClient.post(`/hub/conversations/${conversationId}/sync`);
}

/**
 * Sign in to the hub in a browser window and wait for it to finish.
 *
 * The browser is opened by the desktop backend, which is also what holds the
 * credential afterwards. Nothing sensitive passes through this window.
 */
export async function connectHub(
  hubUrl?: string,
  signal?: { aborted: boolean },
): Promise<HubConnectResult> {
  const authId = await initiateHubConnect(hubUrl);
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    if (signal?.aborted) return { status: "error", message: "Cancelled." };
    await new Promise((r) => setTimeout(r, 1500));
    const result = await pollHubConnect(authId);
    if (result.status !== "pending") return result;
  }
  return { status: "error", message: "Sign-in timed out. Try again." };
}
