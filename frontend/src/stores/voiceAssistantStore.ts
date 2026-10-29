/**
 * Bridges the "Talk with Little Gerry" buttons and the conversation that hosts
 * voice mode (the Gerry panel). Voice is a mode of a conversation, not a
 * session of its own: a request opens the panel and flips its pane to voice.
 */
import { create } from "zustand";

import type { VoicePhase } from "@/hooks/useVoiceMode";
import { useChatSidebarStore } from "@/stores/chatSidebarStore";

interface VoiceAssistantState {
  /** True while some conversation is in voice mode. */
  active: boolean;
  /** True while Gerry's reply audio is playing. */
  speaking: boolean;
  /** Where the loop is, for a host that draws its own big mic (the phone home). */
  phase: VoicePhase | null;
  /** The hosting pane's last voice error, if any. */
  error: string | null;
  /** Incremented by launcher buttons; the hosting pane toggles voice mode. */
  toggleRequests: number;
  requestToggle: () => void;
  setActive: (active: boolean) => void;
  setSpeaking: (speaking: boolean) => void;
  setPhase: (phase: VoicePhase | null, error?: string | null) => void;
}

export const useVoiceAssistantStore = create<VoiceAssistantState>()((set) => ({
  active: false,
  speaking: false,
  phase: null,
  error: null,
  toggleRequests: 0,
  requestToggle: () => {
    useChatSidebarStore.getState().setOpen(true);
    set((s) => ({ toggleRequests: s.toggleRequests + 1 }));
  },
  setActive: (active) => set({ active }),
  setSpeaking: (speaking) => set({ speaking }),
  setPhase: (phase, error = null) => set({ phase, error }),
}));
