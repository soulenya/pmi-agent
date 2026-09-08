import { create } from "zustand";

/**
 * Coordinates the boot-time popups so they don't stack. The "What's New" modal
 * decides first (it may be "showing" while visible); the feature guide waits
 * until this reaches "done" before auto-opening its per-section snapshot.
 */
export type BootPopupPhase = "pending" | "showing" | "done";

interface BootPopupState {
  phase: BootPopupPhase;
  setPhase: (phase: BootPopupPhase) => void;
  /** Bumped by the You menu to show What's New again on demand. */
  reopenRequests: number;
  reopenWhatsNew: () => void;
}

export const useBootPopupStore = create<BootPopupState>((set) => ({
  phase: "pending",
  setPhase: (phase) => set({ phase }),
  reopenRequests: 0,
  reopenWhatsNew: () => set((s) => ({ reopenRequests: s.reopenRequests + 1 })),
}));
