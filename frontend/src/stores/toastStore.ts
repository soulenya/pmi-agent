/**
 * Tiny global toast store — used for cross-page confirmations such as
 * "email sent" after approving a Gerry draft from any approval surface.
 */
import { create } from "zustand";

export interface Toast {
  id: number;
  kind: "success" | "error" | "info";
  text: string;
}

interface ToastState {
  toasts: Toast[];
  push: (kind: Toast["kind"], text: string, durationMs?: number) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  push: (kind, text, durationMs = 6000) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
    window.setTimeout(
      () => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
      durationMs,
    );
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Push the right confirmation toast for a resolved approval. */
export function pushApprovalOutcomeToast(
  result: {
    intent_type: string;
    intent_title: string;
    execution_result?: Record<string, unknown> | null;
  },
  approved: boolean,
): void {
  const push = useToastStore.getState().push;
  const title = result.intent_title.replace(/^Send (email|reply):\s*/i, "");
  const exec = result.execution_result;
  if (!approved) {
    push("info", `Rejected — ${title}`);
  } else if (exec?.status === "executed") {
    push(
      "success",
      result.intent_type === "send_email"
        ? `Email sent — ${title}`
        : `Approved and completed — ${title}`,
    );
  } else if (exec?.status === "error") {
    push("error", `Approved, but it couldn't be completed: ${String(exec.detail ?? "unknown error")}`);
  } else {
    push("success", `Approved — ${title}`);
  }
}
