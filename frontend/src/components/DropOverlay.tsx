import { Upload } from "lucide-react";

/**
 * Full-container highlight shown while dragging files over a drop target.
 * Render inside an element with `relative` positioning; pair with useFileDrop.
 */
export function DropOverlay({ show, label }: { show: boolean; label: string }) {
  if (!show) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/10">
      <div className="flex items-center gap-2 rounded-lg border bg-background/95 px-4 py-2 text-sm font-medium shadow-lg">
        <Upload className="h-4 w-4 text-primary" />
        {label}
      </div>
    </div>
  );
}
