/**
 * Notifications on this device, via Web Push.
 *
 * Only offered where it can work: a secure page with a service worker and a
 * PushManager — a phone or laptop browser on the hub. The desktop shell has
 * its own bell and never registers a worker. iPhones only expose PushManager
 * once the site is on the home screen; `reason` says so.
 */
import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getVapidPublicKey,
  registerPushSubscription,
  removePushSubscription,
} from "@/api/push";
import { useHubHere } from "@/hooks/useAllWork";
import { useIsStandalone } from "@/hooks/useViewport";

export type PushState =
  | "unsupported"
  | "needs_home_screen"
  | "server_off"
  | "denied"
  | "off"
  | "on"
  | "busy";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

const supported =
  typeof window !== "undefined" &&
  window.isSecureContext &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

const isIOS = typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent);

/** Register the push worker once per page load. Resolves null where it cannot run. */
export async function ensurePushWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!supported) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    return null;
  }
}

export function usePush() {
  const qc = useQueryClient();
  const standalone = useIsStandalone();
  const here = useHubHere();
  const [state, setState] = useState<PushState>("busy");
  const [error, setError] = useState<string | null>(null);

  const key = useQuery({
    queryKey: ["push", "vapid"],
    queryFn: getVapidPublicKey,
    enabled: supported && here,
    staleTime: Infinity,
    retry: false,
  });

  const refresh = useCallback(async () => {
    if (!here) return setState("unsupported");
    if (!supported) return setState(isIOS && !standalone ? "needs_home_screen" : "unsupported");
    if (key.isLoading) return setState("busy");
    if (!key.data) return setState("server_off");
    if (Notification.permission === "denied") return setState("denied");
    const reg = await ensurePushWorker();
    const sub = await reg?.pushManager.getSubscription();
    setState(sub ? "on" : "off");
  }, [here, key.data, key.isLoading, standalone]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enable = useCallback(async () => {
    setError(null);
    setState("busy");
    try {
      const reg = await ensurePushWorker();
      if (!reg || !key.data) throw new Error("Push is not available here.");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key.data) as BufferSource,
        }));
      await registerPushSubscription(sub.toJSON());
      qc.invalidateQueries({ queryKey: ["push", "subscriptions"] });
      setState("on");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not turn notifications on.");
      setState("off");
    }
  }, [key.data, qc]);

  const disable = useCallback(async () => {
    setError(null);
    setState("busy");
    try {
      const reg = await ensurePushWorker();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await removePushSubscription(sub.endpoint).catch(() => undefined);
        await sub.unsubscribe();
      }
      qc.invalidateQueries({ queryKey: ["push", "subscriptions"] });
    } finally {
      setState("off");
    }
  }, [qc]);

  return { state, error, enable, disable, refresh };
}
