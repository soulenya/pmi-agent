import { useCallback, useRef, useState } from "react";

export interface FileDropOptions {
  /** Allowed extensions (lowercase, with leading dot). Omit to accept any file. */
  accept?: string[];
  disabled?: boolean;
  /** Called with files skipped by the `accept` filter. */
  onRejected?: (rejected: File[]) => void;
}

/**
 * Native HTML5 drag-and-drop for OS files onto a container element.
 *
 * Spread `dropProps` on the target container (give it `relative` positioning
 * if pairing with <DropOverlay>). Uses an enter/leave depth counter so the
 * highlight doesn't flicker while dragging across child elements, and ignores
 * non-file drags (text selections, in-app element drags).
 */
export function useFileDrop(
  onFiles: (files: File[]) => void,
  opts: FileDropOptions = {},
) {
  const { accept, disabled, onRejected } = opts;
  const [isDragOver, setDragOver] = useState(false);
  const depth = useRef(0);

  const hasFiles = (e: React.DragEvent) =>
    Array.from(e.dataTransfer.types).includes("Files");

  const onDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (disabled || !hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      depth.current += 1;
      setDragOver(true);
    },
    [disabled],
  );

  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      if (disabled || !hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
    },
    [disabled],
  );

  const onDragLeave = useCallback(
    (e: React.DragEvent) => {
      if (disabled || !hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragOver(false);
    },
    [disabled],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      if (disabled || !hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      depth.current = 0;
      setDragOver(false);
      const all = Array.from(e.dataTransfer.files);
      if (all.length === 0) return;
      if (!accept || accept.length === 0) {
        onFiles(all);
        return;
      }
      const ok: File[] = [];
      const bad: File[] = [];
      for (const f of all) {
        const ext = f.name.includes(".")
          ? `.${f.name.split(".").pop()!.toLowerCase()}`
          : "";
        (accept.includes(ext) ? ok : bad).push(f);
      }
      if (ok.length > 0) onFiles(ok);
      if (bad.length > 0) onRejected?.(bad);
    },
    [disabled, accept, onFiles, onRejected],
  );

  return {
    isDragOver,
    dropProps: { onDragEnter, onDragOver, onDragLeave, onDrop },
  };
}
