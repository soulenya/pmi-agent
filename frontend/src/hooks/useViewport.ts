/**
 * Which kind of screen this is. Phones get the bottom-tab shell; everything
 * wider — tablets included — gets the desktop workbench. Coarse pointers
 * (touch) get bigger targets and no hover-only controls, whatever the width.
 */
import { useEffect, useState } from "react";

/** Below Tailwind's `md`, so pages can match with `md:` classes. */
export const PHONE_QUERY = "(max-width: 767px)";
const TOUCH_QUERY = "(pointer: coarse)";
const STANDALONE_QUERY = "(display-mode: standalone)";

function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

export function useIsPhone(): boolean {
  return useMedia(PHONE_QUERY);
}

export function useIsTouch(): boolean {
  return useMedia(TOUCH_QUERY);
}

/** Opened from a home-screen icon rather than a browser tab. */
export function useIsStandalone(): boolean {
  const media = useMedia(STANDALONE_QUERY);
  const ios = typeof navigator !== "undefined" && (navigator as { standalone?: boolean }).standalone === true;
  return media || ios;
}
