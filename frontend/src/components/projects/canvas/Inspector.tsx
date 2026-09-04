/**
 * The panel that edits whatever is picked.
 *
 * Every control writes into the node's `style` bag; the board merges and saves
 * it through the same batched autosave as a drag.
 */

import type { ReactNode } from "react";
import {
  Ban,
  Bold,
  BringToFront,
  Copy,
  Group,
  Minus,
  Plus,
  SendToBack,
  Trash2,
  Type,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { CanvasNode } from "@/types/canvas";
import {
  DEFAULT_FONT_SIZE,
  LINE_COLORS,
  SHAPE_FORMS,
  SHAPE_LABELS,
  SHAPE_PATHS,
  STICKY_COLORS,
  shapeLook,
  shared,
  styleOf,
  type ShapeForm,
  type StylePatch,
} from "./style";

const TEXT_KINDS = ["sticky", "text", "shape", "frame"];

interface Props {
  selected: CanvasNode[];
  onStyle: (patch: StylePatch) => void;
  onWrap: () => void;
  onEditText: () => void;
  onRestack: (where: "front" | "back") => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

function Swatch({
  color,
  active,
  onPick,
  title,
}: {
  color: string;
  active: boolean;
  onPick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onPick}
      style={{ background: color }}
      className={cn(
        "h-5 w-5 rounded-full border",
        active ? "border-primary ring-1 ring-primary" : "border-border",
      )}
    />
  );
}

function Toggle({
  on,
  onClick,
  title,
  children,
}: {
  on: boolean;
  onClick: () => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground",
        on && "bg-primary/10 text-primary",
      )}
    >
      {children}
    </button>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-10 shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-1">{children}</div>
    </div>
  );
}

export function CanvasInspector({
  selected,
  onStyle,
  onWrap,
  onEditText,
  onRestack,
  onDuplicate,
  onDelete,
}: Props) {
  if (selected.length === 0) return null;

  const styles = selected.map(styleOf);
  const kinds = new Set(selected.map((n) => n.kind));
  const hasShape = kinds.has("shape");
  const hasFrame = kinds.has("frame");
  const hasFill = kinds.has("sticky") || hasShape;
  const hasText = selected.some((n) => TEXT_KINDS.includes(n.kind));
  const one = selected.length === 1 ? selected[0] : null;

  const color = shared(styles.map((s) => s.color));
  const stroke = shared(styles.map((s) => s.stroke));
  const textColor = shared(styles.map((s) => s.textColor));
  const strokeWidth = shared(styles.map((s) => s.strokeWidth ?? 2));
  const fontSize = shared(styles.map((s) => s.fontSize ?? DEFAULT_FONT_SIZE));
  const bold = styles.every((s) => s.bold === true);
  const dashed = styles.every((s) => s.dashed === true);
  const solid = styles.every((s) => s.solid === true);
  const hollowFill = styles.every((s) => s.fill === "none");
  const opacity = shared(styles.map((s) => s.opacity ?? 1)) ?? 1;
  const form = shared(styles.map((s) => s.shape ?? "rounded"));

  const step = (by: number) =>
    onStyle({ fontSize: Math.min(72, Math.max(9, (fontSize ?? DEFAULT_FONT_SIZE) + by)) });

  return (
    <div className="w-56 space-y-2 rounded-md border border-border bg-card/95 p-2 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground">
          {selected.length === 1
            ? selected[0].kind.replace("_", " ")
            : `${selected.length} picked`}
        </span>
        <div className="flex items-center gap-0.5">
          {one && TEXT_KINDS.includes(one.kind) ? (
            <Toggle on={false} onClick={onEditText} title="Edit the text (Enter)">
              <Type className="h-4 w-4" />
            </Toggle>
          ) : null}
          <Toggle on={false} onClick={onDuplicate} title="Duplicate (Ctrl+D)">
            <Copy className="h-4 w-4" />
          </Toggle>
          <Toggle on={false} onClick={onDelete} title="Delete">
            <Trash2 className="h-4 w-4" />
          </Toggle>
        </div>
      </div>

      {hasFill ? (
        <Row label="Fill">
          {STICKY_COLORS.map((c) => (
            <Swatch
              key={c}
              color={c}
              title="Fill"
              active={color === c && !hollowFill}
              onPick={() => onStyle({ color: c, fill: null })}
            />
          ))}
          {hasShape ? (
            <button
              type="button"
              title="No fill"
              onClick={() => onStyle({ fill: "none" })}
              className={cn(
                "rounded p-0.5 text-muted-foreground hover:text-foreground",
                hollowFill && "text-primary",
              )}
            >
              <Ban className="h-4 w-4" />
            </button>
          ) : null}
        </Row>
      ) : null}

      {hasShape || hasFrame ? (
        <Row label="Line">
          {LINE_COLORS.map((c) => (
            <Swatch
              key={c}
              color={c}
              title="Outline"
              active={stroke === c}
              onPick={() => onStyle({ stroke: c })}
            />
          ))}
          {[1, 2, 4].map((w) => (
            <button
              key={w}
              type="button"
              title={`${w}px outline`}
              onClick={() => onStyle({ strokeWidth: w })}
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted",
                strokeWidth === w && "bg-primary/10 text-primary",
              )}
            >
              {w}
            </button>
          ))}
          <Toggle
            on={dashed}
            onClick={() => onStyle({ dashed: !dashed })}
            title="Dashed outline"
          >
            <span className="block h-4 w-4 text-[10px] leading-4">- -</span>
          </Toggle>
        </Row>
      ) : null}

      {hasShape ? (
        <Row label="Shape">
          {SHAPE_FORMS.map((f: ShapeForm) => (
            <button
              key={f}
              type="button"
              title={SHAPE_LABELS[f]}
              onClick={() => onStyle({ shape: f })}
              className={cn(
                "rounded border p-0.5",
                form === f ? "border-primary bg-primary/10" : "border-border",
              )}
            >
              <svg viewBox="0 0 100 100" className="h-4 w-4">
                <path
                  d={SHAPE_PATHS[f]}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={8}
                  className="text-muted-foreground"
                />
              </svg>
            </button>
          ))}
        </Row>
      ) : null}

      {hasText ? (
        <Row label="Text">
          {LINE_COLORS.slice(0, 5).map((c) => (
            <Swatch
              key={c}
              color={c}
              title="Text colour"
              active={textColor === c}
              onPick={() => onStyle({ textColor: c })}
            />
          ))}
          <button
            type="button"
            title="Smaller"
            onClick={() => step(-2)}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Minus className="h-3 w-3" />
          </button>
          <span className="w-5 text-center text-[10px] text-muted-foreground">
            {fontSize ?? "–"}
          </span>
          <button
            type="button"
            title="Bigger"
            onClick={() => step(2)}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Plus className="h-3 w-3" />
          </button>
          <Toggle on={bold} onClick={() => onStyle({ bold: !bold })} title="Bold">
            <Bold className="h-3.5 w-3.5" />
          </Toggle>
        </Row>
      ) : null}

      <Row label="Depth">
        <Toggle on={false} onClick={() => onRestack("front")} title="Bring to front (Ctrl+])">
          <BringToFront className="h-4 w-4" />
        </Toggle>
        <Toggle on={false} onClick={() => onRestack("back")} title="Send to back (Ctrl+[)">
          <SendToBack className="h-4 w-4" />
        </Toggle>
        {hasShape ? (
          <Toggle
            on={solid}
            onClick={() => onStyle({ solid: !solid })}
            title={
              solid
                ? "Solid: the middle catches clicks"
                : "Hollow: clicks pass through to whatever is behind"
            }
          >
            <span className="block h-4 w-4">
              <svg viewBox="0 0 100 100" className="h-4 w-4">
                <path
                  d={SHAPE_PATHS[shapeLook(styles[0]).form]}
                  fill={solid ? "currentColor" : "none"}
                  stroke="currentColor"
                  strokeWidth={8}
                />
              </svg>
            </span>
          </Toggle>
        ) : null}
        <Toggle on={false} onClick={onWrap} title="Draw a shape around this">
          <Group className="h-4 w-4" />
        </Toggle>
      </Row>

      <Row label="Fade">
        <input
          type="range"
          min={20}
          max={100}
          step={5}
          value={Math.round(opacity * 100)}
          onChange={(e) => onStyle({ opacity: Number(e.target.value) / 100 })}
          className="h-1 w-32 accent-primary"
        />
      </Row>
    </div>
  );
}
