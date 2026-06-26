/**
 * Makes a <textarea> both auto-grow with its content (up to `autoMax`) and
 * manually resizable by dragging a handle. While `manualHeight` is null the
 * box grows/shrinks to fit the text; once the user drags the handle the box is
 * pinned to the chosen pixel height (scrolling internally when it overflows).
 * Double-clicking the handle clears the manual height to return to auto-grow.
 */
import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

interface Options {
  /** Current text — used to re-run auto-grow as the value changes. */
  value?: string;
  /** Pinned height in px, or null for auto-grow. */
  manualHeight: number | null;
  setManualHeight: (h: number | null) => void;
  /** Tallest the box auto-grows before it starts scrolling. */
  autoMax?: number;
  /** Drag clamp bounds. */
  min?: number;
  max?: number;
}

export function useResizableTextarea({
  value,
  manualHeight,
  setManualHeight,
  autoMax = 320,
  min = 40,
  max = 600,
}: Options) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const applyHeight = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (manualHeight != null) {
      el.style.height = `${manualHeight}px`;
      el.style.overflowY = "auto";
      return;
    }
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, autoMax);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > autoMax ? "auto" : "hidden";
  }, [manualHeight, autoMax]);

  // Re-apply on mount, when the text changes, and when the pinned height changes.
  useEffect(() => {
    applyHeight();
  }, [applyHeight, value]);

  const startResize = useCallback(
    (e: ReactPointerEvent) => {
      e.preventDefault();
      const el = ref.current;
      const startY = e.clientY;
      const startHeight = el ? el.getBoundingClientRect().height : manualHeight ?? min;

      const onMove = (ev: PointerEvent) => {
        // Handle sits above the box, so dragging up (smaller clientY) grows it.
        const next = Math.min(max, Math.max(min, startHeight + (startY - ev.clientY)));
        setManualHeight(Math.round(next));
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [manualHeight, setManualHeight, min, max],
  );

  return { ref, applyHeight, startResize };
}
