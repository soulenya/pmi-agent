/**
 * Persisted orbit-speed multiplier for the solar-system canvas.
 *
 * `speed` scales every idle orbit animation: 1 = default, >1 faster, <1 slower.
 * Applied via the `--orbit-speed` CSS variable on the canvas root, which the
 * `.orbit-spin` / `.orbit-spin-reverse` rules divide their duration by.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export const ORBIT_SPEED_MIN = 0.25;
export const ORBIT_SPEED_MAX = 3;

interface OrbitSpeedState {
  speed: number;
  setSpeed: (speed: number) => void;
}

const clamp = (v: number) =>
  Math.min(ORBIT_SPEED_MAX, Math.max(ORBIT_SPEED_MIN, v));

export const useOrbitSpeedStore = create<OrbitSpeedState>()(
  persist(
    (set) => ({
      speed: 1,
      setSpeed: (speed) => set({ speed: clamp(speed) }),
    }),
    { name: "pmi-orbit-speed" },
  ),
);
