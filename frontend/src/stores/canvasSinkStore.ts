/**
 * A way to hand something to the project canvas that is currently on screen.
 *
 * The chat panel floats over the whole app and knows nothing about which page
 * is behind it. Rather than have it guess, the canvas says "I am here and I can
 * take things" while it is mounted, and stops saying so when it is not.
 */
import { create } from "zustand";

interface CanvasSinkState {
  /** Set only while an editable project canvas is on screen. */
  dropText: ((text: string) => void) | null;
  setDropText: (fn: ((text: string) => void) | null) => void;
}

export const useCanvasSinkStore = create<CanvasSinkState>()((set) => ({
  dropText: null,
  // The object form matters: zustand reads a bare function as a state updater,
  // so set(fn) would call it instead of storing it.
  setDropText: (fn) => set({ dropText: fn }),
}));
