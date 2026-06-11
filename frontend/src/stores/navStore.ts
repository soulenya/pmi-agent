/**
 * Central navigation store for the solar-system canvas.
 *
 * The router URL stays the single source of truth; AppShell mirrors the
 * current location into this store so any component can read the celestial
 * path (e.g. ["knowledge", "research"]) without prop drilling.
 */
import { create } from "zustand";
import { locateRoute, type NavLocation } from "@/lib/solarSystem";

interface NavState extends NavLocation {
  syncFromPathname: (pathname: string) => void;
}

export const useNavStore = create<NavState>()((set) => ({
  path: [],
  isSun: false,
  planet: undefined,
  moon: undefined,
  satellite: undefined,
  syncFromPathname: (pathname) => set({ ...locateRoute(pathname) }),
}));
