import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ChatSidebarState {
  open: boolean;
  activeConversationId: string | null;
  /** A seed message queued by "Ask Gerry about this", auto-sent once the
   *  websocket for the active conversation connects. Not persisted. */
  pendingMessage: string | null;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  setActiveConversationId: (id: string | null) => void;
  setPendingMessage: (msg: string | null) => void;
}

export const useChatSidebarStore = create<ChatSidebarState>()(
  persist(
    (set) => ({
      open: true,
      activeConversationId: null,
      pendingMessage: null,
      setOpen: (open) => set({ open }),
      toggle: () => set((s) => ({ open: !s.open })),
      setActiveConversationId: (id) => set({ activeConversationId: id }),
      setPendingMessage: (msg) => set({ pendingMessage: msg }),
    }),
    {
      name: "pmi-chat-sidebar",
      // Never persist the transient seed message — it must fire only once.
      partialize: (s) => ({ open: s.open, activeConversationId: s.activeConversationId }),
    },
  ),
);
