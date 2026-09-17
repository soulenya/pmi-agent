/**
 * Whether the hub answered the last time this computer asked it something.
 *
 * Work that has been moved to the hub lives only there. When the hub cannot
 * be reached the app must say so, rather than show a shorter list and let it
 * pass for the truth. Set by the API client; read by the banner and the
 * status chip.
 */
import { create } from "zustand";

interface HubReachState {
  offline: boolean;
  detail: string | null;
  since: number | null;
  markOffline: (detail: string | null) => void;
  markOnline: () => void;
}

export const useHubReachStore = create<HubReachState>((set, get) => ({
  offline: false,
  detail: null,
  since: null,
  markOffline: (detail) =>
    set((s) => ({ offline: true, detail, since: s.since ?? Date.now() })),
  markOnline: () => {
    if (get().offline) set({ offline: false, detail: null, since: null });
  },
}));
