import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ChatSidebarState {
  open: boolean;
  activeConversationId: string | null;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  setActiveConversationId: (id: string | null) => void;
}

export const useChatSidebarStore = create<ChatSidebarState>()(
  persist(
    (set) => ({
      open: true,
      activeConversationId: null,
      setOpen: (open) => set({ open }),
      toggle: () => set((s) => ({ open: !s.open })),
      setActiveConversationId: (id) => set({ activeConversationId: id }),
    }),
    { name: "pmi-chat-sidebar" },
  ),
);
