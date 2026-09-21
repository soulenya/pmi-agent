/**
 * The gear on the canvas toolbar: folding on/off and where it starts, how the
 * wheel zooms, and the default text size on cards. Per computer.
 */
import { useEffect, useRef, useState } from "react";
import { RotateCcw, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CANVAS_PREFS_DEFAULTS,
  CANVAS_PREFS_RANGES,
  useCanvasPrefs,
  type CanvasPrefs,
} from "@/stores/canvasPrefsStore";

function Slider({
  label,
  value,
  shown,
  range,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  shown: string;
  range: { min: number; max: number; step: number };
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <label className={cn("block", disabled && "opacity-50")}>
      <span className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{label}</span>
        <span className="tabular-nums text-foreground">{shown}</span>
      </span>
      <input
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-0.5 w-full accent-primary"
      />
    </label>
  );
}

export function CanvasSettings() {
  const prefs = useCanvasPrefs();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", key);
    };
  }, [open]);

  const set = (patch: Partial<CanvasPrefs>) => prefs.set(patch);
  const changed = (Object.keys(CANVAS_PREFS_DEFAULTS) as (keyof CanvasPrefs)[]).some(
    (k) => prefs[k] !== CANVAS_PREFS_DEFAULTS[k],
  );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title="Canvas settings: folding, zoom, card text"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground",
          open && "bg-primary/10 text-primary",
        )}
      >
        <Settings2 className="h-4 w-4" />
      </button>
      {open ? (
        <div
          className="absolute left-0 top-full z-20 mt-1 w-64 space-y-3 rounded-md border border-border bg-card/95 p-3 shadow-md"
          // The board must not treat a slider drag as a pan or a wheel as a zoom.
          onPointerDown={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Canvas</span>
            {changed ? (
              <button
                type="button"
                onClick={() => prefs.reset()}
                title="Back to the defaults"
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="h-3 w-3" /> Reset
              </button>
            ) : null}
          </div>

          <label className="flex items-center justify-between gap-2 text-xs">
            <span>Fold cards when zoomed out</span>
            <input
              type="checkbox"
              checked={prefs.foldEnabled}
              onChange={(e) => set({ foldEnabled: e.target.checked })}
              className="accent-primary"
            />
          </label>
          <Slider
            label="Start folding below"
            value={prefs.foldZoom}
            shown={`${Math.round(prefs.foldZoom * 100)}% zoom`}
            range={CANVAS_PREFS_RANGES.foldZoom}
            disabled={!prefs.foldEnabled}
            onChange={(v) => set({ foldZoom: v })}
          />
          <Slider
            label="Deeper levels fold earlier by"
            value={prefs.foldStep}
            shown={`×${prefs.foldStep.toFixed(1)}`}
            range={CANVAS_PREFS_RANGES.foldStep}
            disabled={!prefs.foldEnabled}
            onChange={(v) => set({ foldStep: v })}
          />
          <Slider
            label="Wheel zoom speed"
            value={prefs.zoomSpeed}
            shown={`×${prefs.zoomSpeed}`}
            range={CANVAS_PREFS_RANGES.zoomSpeed}
            onChange={(v) => set({ zoomSpeed: v })}
          />
          <Slider
            label="Zoom smoothing"
            value={prefs.zoomEase}
            shown={prefs.zoomEase === 0 ? "off" : `${prefs.zoomEase} ms`}
            range={CANVAS_PREFS_RANGES.zoomEase}
            onChange={(v) => set({ zoomEase: v })}
          />
          <Slider
            label="Card text size"
            value={prefs.cardFontSize}
            shown={`${prefs.cardFontSize} px`}
            range={CANVAS_PREFS_RANGES.cardFontSize}
            onChange={(v) => set({ cardFontSize: v })}
          />
          <p className="text-[10px] leading-snug text-muted-foreground">
            Card text size is the default for task and reference cards; pick a card
            and use the Text row to size just that one. Remembered on this computer.
          </p>
        </div>
      ) : null}
    </div>
  );
}
