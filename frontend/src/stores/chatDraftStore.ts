import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Unsent text per conversation. Leaving a conversation (another room, another
 * panel, a restart) used to throw away whatever was typed; it now comes back.
 */
interface ChatDraftState {
  drafts: Record<string, string>;
  setDraft: (key: string, text: string) => void;
  clearDraft: (key: string) => void;
}

const MAX_KEYS = 50;

export const useChatDraftStore = create<ChatDraftState>()(
  persist(
    (set) => ({
      drafts: {},
      setDraft: (key, text) =>
        set((s) => {
          const next = { ...s.drafts };
          if (text.trim()) next[key] = text;
          else delete next[key];
          // Keep the store small: drop the oldest keys past the cap.
          const keys = Object.keys(next);
          if (keys.length > MAX_KEYS) {
            for (const k of keys.slice(0, keys.length - MAX_KEYS)) delete next[k];
          }
          return { drafts: next };
        }),
      clearDraft: (key) =>
        set((s) => {
          if (!(key in s.drafts)) return s;
          const next = { ...s.drafts };
          delete next[key];
          return { drafts: next };
        }),
    }),
    { name: "lg-chat-drafts" },
  ),
);
