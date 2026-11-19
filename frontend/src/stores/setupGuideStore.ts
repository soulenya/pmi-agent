import { create } from "zustand";

import { hasOptInFeature } from "@/lib/brand";

interface SetupGuideStore {
  /** Bumped by the menu under the person's name to open the guide on demand. */
  requests: number;
  open: () => void;
  /**
   * True while the guide is on screen, or has not yet decided whether to open
   * by itself. Other first-run popups wait for it, so it is the first thing a
   * new person sees and nothing stacks under it.
   */
  blocking: boolean;
  setBlocking: (blocking: boolean) => void;
}

export const useSetupGuideStore = create<SetupGuideStore>((set) => ({
  requests: 0,
  open: () => set((s) => ({ requests: s.requests + 1 })),
  blocking: hasOptInFeature("setup_guide"),
  setBlocking: (blocking) => set({ blocking }),
}));
