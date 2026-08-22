import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Position and size of the popped-out panel, in CSS pixels. */
export interface FloatRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const DOCK_MIN_WIDTH = 280;
export const DOCK_MAX_WIDTH = 900;
export const DOCK_DEFAULT_WIDTH = 320;
export const DOCK_WIDE_WIDTH = 560;
export const FLOAT_MIN_WIDTH = 320;
export const FLOAT_MIN_HEIGHT = 300;

interface ChatSidebarState {
  open: boolean;
  activeConversationId: string | null;
  /** A seed message queued by "Ask Gerry about this", auto-sent once the
   *  websocket for the active conversation connects. Not persisted. */
  pendingMessage: string | null;
  /** Docked column width in px, set by dragging the panel's left edge. */
  width: number;
  /** True when the panel floats over the app instead of sitting in the column. */
  popped: boolean;
  /** Null until the panel is popped out for the first time. */
  floatRect: FloatRect | null;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  setActiveConversationId: (id: string | null) => void;
  setPendingMessage: (msg: string | null) => void;
  setWidth: (width: number) => void;
  setPopped: (popped: boolean) => void;
  setFloatRect: (rect: FloatRect) => void;
}

export const useChatSidebarStore = create<ChatSidebarState>()(
  persist(
    (set) => ({
      open: true,
      activeConversationId: null,
      pendingMessage: null,
      width: DOCK_DEFAULT_WIDTH,
      popped: false,
      floatRect: null,
      setOpen: (open) => set({ open }),
      toggle: () => set((s) => ({ open: !s.open })),
      setActiveConversationId: (id) => set({ activeConversationId: id }),
      setPendingMessage: (msg) => set({ pendingMessage: msg }),
      setWidth: (width) =>
        set({ width: Math.min(Math.max(Math.round(width), DOCK_MIN_WIDTH), DOCK_MAX_WIDTH) }),
      setPopped: (popped) => set({ popped }),
      setFloatRect: (floatRect) => set({ floatRect }),
    }),
    {
      name: "pmi-chat-sidebar",
      // Never persist the transient seed message — it must fire only once.
      partialize: (s) => ({
        open: s.open,
        activeConversationId: s.activeConversationId,
        width: s.width,
        popped: s.popped,
        floatRect: s.floatRect,
      }),
    },
  ),
);
