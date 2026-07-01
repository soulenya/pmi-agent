import { create } from "zustand";

interface FeatureGuideState {
  /** Set to a section id to open the guide for that section on demand. */
  requestedId: string | null;
  requestOpen: (id: string) => void;
  clear: () => void;
}

/**
 * Lets the Help button (in the header) ask the FeatureGuideModal to open the
 * guide for the current section, without prop-drilling through the layout.
 */
export const useFeatureGuideStore = create<FeatureGuideState>((set) => ({
  requestedId: null,
  requestOpen: (id) => set({ requestedId: id }),
  clear: () => set({ requestedId: null }),
}));
