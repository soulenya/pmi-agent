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
}

export const useBootPopupStore = create<BootPopupState>((set) => ({
  phase: "pending",
  setPhase: (phase) => set({ phase }),
}));
