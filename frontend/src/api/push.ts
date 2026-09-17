import { apiClient } from "@/api/client";

export interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  user_agent: string | null;
  created_at: string;
  last_used_at: string | null;
}

/** The server's VAPID public key, or null when push is not set up there. */
export async function getVapidPublicKey(): Promise<string | null> {
  try {
    const res = await apiClient.get<{ key: string }>("/push/vapid-public-key");
    return res.data.key;
  } catch (e) {
    if ((e as { response?: { status?: number } }).response?.status === 404) return null;
    throw e;
  }
}

export async function registerPushSubscription(sub: PushSubscriptionJSON): Promise<PushSubscriptionRow> {
  const res = await apiClient.post("/push/subscribe", {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.keys?.p256dh, auth: sub.keys?.auth },
  });
  return res.data;
}

export async function removePushSubscription(endpoint: string): Promise<void> {
  await apiClient.delete("/push/subscribe", { params: { endpoint } });
}

export async function listPushSubscriptions(): Promise<PushSubscriptionRow[]> {
  const res = await apiClient.get("/push/subscriptions");
  return res.data;
}

export async function sendTestPush(): Promise<{ delivered: number }> {
  const res = await apiClient.post("/push/test");
  return res.data;
}
