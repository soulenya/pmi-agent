import { create } from "zustand";

/** Lets Settings → The hub open the "move your work to the hub" prompt on demand. */
interface MoveToHubState {
  requests: number;
  request: () => void;
}

export const useMoveToHubStore = create<MoveToHubState>((set) => ({
  requests: 0,
  request: () => set((s) => ({ requests: s.requests + 1 })),
}));
