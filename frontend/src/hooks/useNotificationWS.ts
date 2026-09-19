import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/authStore";
import { useToastStore } from "@/stores/toastStore";

const WS_BASE = import.meta.env.VITE_WS_BASE ?? "ws://127.0.0.1:8000";
const RECONNECT_DELAY_MS = 5_000;

/**
 * Opens /ws/notifications and keeps it alive.
 * On receiving any notification frame, invalidates ["notifications"] so the
 * sidebar badge and NotificationsPage refresh automatically. A `gmail_changed`
 * frame refetches the Inbox; a new-email notification also shows a toast that
 * opens the thread.
 */
export function useNotificationWS(): void {
  const queryClient = useQueryClient();
  const accessToken = useAuthStore((s) => s.accessToken);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmounted = useRef(false);

  useEffect(() => {
    unmounted.current = false;
    if (!isAuthenticated || !accessToken) return;

    const connect = () => {
      if (unmounted.current) return;
      try {
        const ws = new WebSocket(`${WS_BASE}/ws/notifications?token=${accessToken}`);
        wsRef.current = ws;

        ws.onmessage = (evt) => {
          try {
            const data = JSON.parse(evt.data as string) as {
              type: string;
              unread_count?: number;
              id?: string;
              title?: string;
              message?: string | null;
              notif_type?: string;
              route?: string;
            };
            if (data.type === "notification") {
              // Invalidate so sidebar badge and page re-fetch
              queryClient.invalidateQueries({ queryKey: ["notifications"] });
              if (data.notif_type === "email_received" && data.title) {
                useToastStore
                  .getState()
                  .push(
                    "info",
                    data.message ? `${data.title} — ${data.message}` : data.title,
                    8000,
                    data.route ?? "/inbox",
                  );
              }
            } else if (data.type === "gmail_changed") {
              queryClient.invalidateQueries({ queryKey: ["gmail-inbox"] });
              queryClient.invalidateQueries({ queryKey: ["gmail-by-tag"] });
              queryClient.invalidateQueries({ queryKey: ["gmail-thread"] });
            } else if (data.type === "init") {
              // Optionally prime the cache or simply invalidate
              queryClient.invalidateQueries({ queryKey: ["notifications"] });
            }
          } catch {
            // ignore malformed frames
          }
        };

        ws.onclose = () => {
          wsRef.current = null;
          if (!unmounted.current) {
            reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS);
          }
        };

        ws.onerror = () => {
          ws.close();
        };
      } catch {
        if (!unmounted.current) {
          reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS);
        }
      }
    };

    connect();

    return () => {
      unmounted.current = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [isAuthenticated, accessToken, queryClient]);
}
