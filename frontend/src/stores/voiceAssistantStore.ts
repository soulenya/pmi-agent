/**
 * Bridges the "Talk with Little Gerry" buttons and the conversation that hosts
 * voice mode (the Gerry panel). Voice is a mode of a conversation, not a
 * session of its own: a request opens the panel and flips its pane to voice.
 */
import { create } from "zustand";

import { useChatSidebarStore } from "@/stores/chatSidebarStore";

interface VoiceAssistantState {
  /** True while some conversation is in voice mode. */
  active: boolean;
  /** True while Gerry's reply audio is playing. */
  speaking: boolean;
  /** Incremented by launcher buttons; the hosting pane toggles voice mode. */
  toggleRequests: number;
  requestToggle: () => void;
  setActive: (active: boolean) => void;
  setSpeaking: (speaking: boolean) => void;
}

export const useVoiceAssistantStore = create<VoiceAssistantState>()((set) => ({
  active: false,
  speaking: false,
  toggleRequests: 0,
  requestToggle: () => {
    useChatSidebarStore.getState().setOpen(true);
    set((s) => ({ toggleRequests: s.toggleRequests + 1 }));
  },
  setActive: (active) => set({ active }),
  setSpeaking: (speaking) => set({ speaking }),
}));
