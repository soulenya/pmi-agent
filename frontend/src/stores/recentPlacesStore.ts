import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * The last few places you were, so the thing you were just in is one click
 * back. A place is a route plus the name of what lives there; pages that know
 * their entity (a project, a conversation) record themselves with useRecentPlace.
 */
export interface Place {
  path: string;
  label: string;
  /** A short tag shown after the label: "project", "chat", "hub". */
  tag?: string;
}

const KEEP = 5;

interface RecentState {
  places: Place[];
  remember: (place: Place) => void;
  forget: (path: string) => void;
}

export const useRecentPlacesStore = create<RecentState>()(
  persist(
    (set) => ({
      places: [],
      remember: (place) =>
        set((s) => ({
          places: [place, ...s.places.filter((p) => p.path !== place.path)].slice(0, KEEP),
        })),
      forget: (path) => set((s) => ({ places: s.places.filter((p) => p.path !== path) })),
    }),
    { name: "pmi-recent-places" },
  ),
);

/** Call from a page that knows what it is showing. Null label records nothing. */
export function useRecentPlace(label: string | null | undefined, tag?: string, path?: string) {
  const { pathname } = useLocation();
  const remember = useRecentPlacesStore((s) => s.remember);
  useEffect(() => {
    if (!label) return;
    remember({ path: path ?? pathname, label, tag });
  }, [label, tag, path, pathname, remember]);
}
