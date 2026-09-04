/** The right-click menu, placed at the pointer inside the board. */

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export interface MenuItem {
  label: string;
  hint?: string;
  onClick: () => void;
  danger?: boolean;
}

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

export function CanvasMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", key);
    };
  }, [onClose]);

  if (items.length === 0) return null;

  return (
    <div
      ref={ref}
      style={{ left: x, top: y }}
      className="absolute z-50 w-48 rounded-md border border-border bg-card py-1 shadow-md"
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          onClick={() => {
            item.onClick();
            onClose();
          }}
          className={cn(
            "flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-muted",
            item.danger ? "text-destructive" : "text-foreground",
          )}
        >
          <span>{item.label}</span>
          {item.hint ? (
            <span className="text-[10px] text-muted-foreground">{item.hint}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
