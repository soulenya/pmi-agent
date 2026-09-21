/**
 * How the canvas behaves for this person, on this computer: whether cards fold
 * away as you zoom out and at what zoom, how the mouse wheel zooms, and how
 * big the text on task and reference cards is by default. Remembered across
 * sessions; a card's own `style.fontSize` still wins over the default.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface CanvasPrefs {
  /** Fold a task's family into it when zoomed out past `foldZoom`. */
  foldEnabled: boolean;
  /** Zoom (1 = 100%) below which top-level cards start folding. */
  foldZoom: number;
  /** Each deeper level folds this much earlier (multiplies the zoom). */
  foldStep: number;
  /** Multiplier on how far one wheel notch zooms. */
  zoomSpeed: number;
  /** Milliseconds a notched wheel step eases over. 0 = jump. */
  zoomEase: number;
  /** Default text size on task/reference cards, in px. */
  cardFontSize: number;
}

export const CANVAS_PREFS_DEFAULTS: CanvasPrefs = {
  foldEnabled: true,
  foldZoom: 0.34,
  foldStep: 1.5,
  zoomSpeed: 1,
  zoomEase: 130,
  cardFontSize: 14,
};

export const CANVAS_PREFS_RANGES = {
  foldZoom: { min: 0.2, max: 0.9, step: 0.02 },
  foldStep: { min: 1.1, max: 3, step: 0.1 },
  zoomSpeed: { min: 0.25, max: 3, step: 0.25 },
  zoomEase: { min: 0, max: 400, step: 10 },
  cardFontSize: { min: 10, max: 28, step: 1 },
} as const;

interface CanvasPrefsState extends CanvasPrefs {
  set: (patch: Partial<CanvasPrefs>) => void;
  reset: () => void;
}

export const useCanvasPrefs = create<CanvasPrefsState>()(
  persist(
    (set) => ({
      ...CANVAS_PREFS_DEFAULTS,
      set: (patch) => set(patch),
      reset: () => set({ ...CANVAS_PREFS_DEFAULTS }),
    }),
    { name: "pmi-canvas-prefs" },
  ),
);
