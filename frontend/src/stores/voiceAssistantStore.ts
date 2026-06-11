/**
 * Bridges the header "Talk with Little Gerry" button and the VoiceAssistant
 * session manager (mounted separately in AppShell).
 */
import { create } from "zustand";

interface VoiceAssistantState {
  /** True while a voice session is running (panel visible). */
  active: boolean;
  /** True while a session is being created. */
  starting: boolean;
  /** Incremented by the header button; VoiceAssistant toggles the session. */
  toggleRequests: number;
  requestToggle: () => void;
  setActive: (active: boolean) => void;
  setStarting: (starting: boolean) => void;
}

export const useVoiceAssistantStore = create<VoiceAssistantState>()((set) => ({
  active: false,
  starting: false,
  toggleRequests: 0,
  requestToggle: () => set((s) => ({ toggleRequests: s.toggleRequests + 1 })),
  setActive: (active) => set({ active }),
  setStarting: (starting) => set({ starting }),
}));
