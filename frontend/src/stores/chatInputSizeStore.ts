/**
 * Persisted height of the chat message input boxes.
 *
 * Each box (the main Chat page and the persistent Little Gerry sidebar) can be
 * dragged to a height of the user's choosing. A `null` value means "auto-grow
 * with the text" up to a sensible cap; a number pins the box to that pixel
 * height. The choice is remembered across sessions.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ChatInputSizeState {
  /** Main Chat page input height in px, or null for auto-grow. */
  mainHeight: number | null;
  /** Persistent sidebar input height in px, or null for auto-grow. */
  sidebarHeight: number | null;
  setMainHeight: (h: number | null) => void;
  setSidebarHeight: (h: number | null) => void;
}

export const useChatInputSizeStore = create<ChatInputSizeState>()(
  persist(
    (set) => ({
      mainHeight: null,
      sidebarHeight: null,
      setMainHeight: (mainHeight) => set({ mainHeight }),
      setSidebarHeight: (sidebarHeight) => set({ sidebarHeight }),
    }),
    { name: "pmi-chat-input-size" },
  ),
);
