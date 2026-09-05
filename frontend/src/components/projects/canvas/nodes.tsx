/**
 * The node renderers.
 *
 * Shapes and frames are hollow: only their outline and their text catch the
 * pointer, so something sitting underneath stays reachable. The board sets
 * `pointerEvents: none` on the wrapper for those kinds and each part here
 * turns it back on for itself.
 */

import { useEffect, useState } from "react";
import {
  Handle,
  NodeResizer,
  Position,
  type NodeProps,
} from "@xyflow/react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { STATUS_RING, TASK_STATUSES } from "@/lib/taskStatus";
import { fetchCanvasImage } from "@/api/canvas";
import type { CanvasNode, NodeKind } from "@/types/canvas";
import type { TaskStatus } from "@/types/tasks";
import { AutoGrowText } from "./AutoGrowText";
import { useBoard, type NodeData } from "./board";
import { inkBounds, strokePath, type InkPoint } from "./ink";
import {
  SHAPE_PATHS,
  STICKY_COLORS,
  autoHeight,
  shapeLook,
  styleOf,
  textLook,
} from "./style";

function Handles() {
  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        className="!pointer-events-auto !h-2 !w-2"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!pointer-events-auto !h-2 !w-2"
      />
    </>
  );
}

function Resizer({
  node,
  visible,
  minWidth,
  minHeight,
}: {
  node: CanvasNode;
  visible: boolean;
  minWidth: number;
  minHeight: number;
}) {
  const board = useBoard();
  return (
    <NodeResizer
      isVisible={visible}
      minWidth={minWidth}
      minHeight={minHeight}
      onResizeStart={() => board.remember()}
      onResizeEnd={(_, box) => board.endResize(node, box)}
      handleStyle={{ pointerEvents: "all" }}
      lineStyle={{ pointerEvents: "all" }}
    />
  );
}

/** Grow the box when the text no longer fits, never shrink it behind the user. */
function useGrow(id: string, node: CanvasNode, live: number | undefined, chrome: number) {
  const board = useBoard();
  if (!autoHeight(styleOf(node))) return undefined;
  return (needed: number) => {
    const current = live ?? node.height;
    if (needed + chrome <= current + 1) return;
    board.grow(id, needed + chrome);
  };
}

// ── Free-form ─────────────────────────────────────────────────────────────────

function StickyNode({ data, selected, id, height }: NodeProps) {
  const { node, canEdit } = data as unknown as NodeData;
  const board = useBoard();
  const style = styleOf(node);
  const paper = style.color ?? STICKY_COLORS[0];
  const onHeight = useGrow(id, node, height, 16);
  return (
    <>
      <Resizer node={node} visible={Boolean(selected) && canEdit} minWidth={120} minHeight={60} />
      <Handles />
      <div
        className="h-full w-full rounded-sm p-2 text-neutral-900 shadow-sm"
        style={{ background: paper }}
      >
        <AutoText
          node={node}
          canEdit={canEdit}
          onHeight={onHeight}
          onCommit={(text) => board.saveContent(id, text)}
          className="h-full"
          placeholder="Note"
          fallbackColor="#171717"
        />
      </div>
    </>
  );
}

function TextNode({ data, selected, id, height }: NodeProps) {
  const { node, canEdit } = data as unknown as NodeData;
  const board = useBoard();
  const onHeight = useGrow(id, node, height, 8);
  return (
    <>
      <Resizer node={node} visible={Boolean(selected) && canEdit} minWidth={80} minHeight={24} />
      <Handles />
      <div className="h-full w-full p-1">
        <AutoText
          node={node}
          canEdit={canEdit}
          onHeight={onHeight}
          onCommit={(text) => board.saveContent(id, text)}
          className="h-full text-foreground"
          placeholder="Text"
        />
      </div>
    </>
  );
}

function ShapeNode({ data, selected, id, height }: NodeProps) {
  const { node, canEdit } = data as unknown as NodeData;
  const board = useBoard();
  const style = styleOf(node);
  const look = shapeLook(style);
  const editing = board.editingId === id;
  const hasText = node.content.trim().length > 0;
  const onHeight = useGrow(id, node, height, 20);

  return (
    <>
      <Resizer node={node} visible={Boolean(selected) && canEdit} minWidth={40} minHeight={40} />
      <Handles />
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 h-full w-full"
      >
        <path
          d={SHAPE_PATHS[look.form]}
          fill={look.fill}
          style={{ pointerEvents: look.solid && look.fill !== "none" ? "fill" : "none" }}
        />
        <path
          d={SHAPE_PATHS[look.form]}
          fill="none"
          stroke={look.stroke}
          strokeWidth={look.strokeWidth}
          strokeDasharray={look.dashed ? "7 5" : undefined}
          vectorEffect="non-scaling-stroke"
          style={{ pointerEvents: "none" }}
        />
        {/* An invisible fat outline, so the thin one is not a pixel hunt. */}
        <path
          d={SHAPE_PATHS[look.form]}
          fill="none"
          stroke="transparent"
          strokeWidth={look.strokeWidth + 12}
          vectorEffect="non-scaling-stroke"
          style={{ pointerEvents: "stroke" }}
        />
      </svg>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-2">
        {editing ? (
          <div className="pointer-events-auto w-full">
            <AutoText
              node={node}
              canEdit={canEdit}
              autoFocus
              onHeight={onHeight}
              onCommit={(text) => board.saveContent(id, text)}
              onDone={() => board.setEditingId(null)}
              className="text-center"
              placeholder="Type"
            />
          </div>
        ) : hasText ? (
          <div
            className="pointer-events-auto max-h-full max-w-full cursor-text overflow-hidden whitespace-pre-wrap break-words text-center"
            style={textLook(style)}
            onDoubleClick={() => canEdit && board.setEditingId(id)}
          >
            {node.content}
          </div>
        ) : null}
      </div>
    </>
  );
}

function FrameNode({ data, selected, id }: NodeProps) {
  const { node, canEdit } = data as unknown as NodeData;
  const board = useBoard();
  const style = styleOf(node);
  const editing = board.editingId === id;
  return (
    <>
      <Resizer node={node} visible={Boolean(selected) && canEdit} minWidth={160} minHeight={120} />
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 h-full w-full text-border"
      >
        <path
          d={SHAPE_PATHS.rounded}
          fill="none"
          stroke={style.stroke ?? style.color ?? "currentColor"}
          strokeWidth={2}
          strokeDasharray="7 5"
          vectorEffect="non-scaling-stroke"
          style={{ pointerEvents: "none" }}
        />
        <path
          d={SHAPE_PATHS.rounded}
          fill="none"
          stroke="transparent"
          strokeWidth={14}
          vectorEffect="non-scaling-stroke"
          style={{ pointerEvents: "stroke" }}
        />
      </svg>
      <div className="absolute inset-x-0 top-0 flex justify-start p-1">
        {editing ? (
          <div className="pointer-events-auto w-full">
            <AutoText
              node={node}
              canEdit={canEdit}
              autoFocus
              onCommit={(text) => board.saveContent(id, text)}
              onDone={() => board.setEditingId(null)}
              className="text-xs"
              placeholder="Frame"
            />
          </div>
        ) : (
          <span
            className="pointer-events-auto cursor-text rounded bg-card/80 px-1.5 py-0.5 text-xs text-muted-foreground"
            onDoubleClick={() => canEdit && board.setEditingId(id)}
          >
            {node.content || node.label || "Frame"}
          </span>
        )}
      </div>
    </>
  );
}

function ImageNode({ data, selected }: NodeProps) {
  const { node, canEdit, ctx } = data as unknown as NodeData;
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let url: string | null = null;
    let live = true;
    fetchCanvasImage(ctx.projectId, ctx.canvasId, node.id, ctx.source)
      .then((objectUrl) => {
        url = objectUrl;
        if (live) setSrc(objectUrl);
        else URL.revokeObjectURL(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [ctx.projectId, ctx.canvasId, ctx.source, node.id]);

  return (
    <>
      <Resizer node={node} visible={Boolean(selected) && canEdit} minWidth={60} minHeight={60} />
      <Handles />
      {src ? (
        <img
          src={src}
          alt={node.label || "Image"}
          draggable={false}
          className="h-full w-full rounded-sm object-contain"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center rounded-sm border border-dashed text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      )}
    </>
  );
}

function InkNode({ data }: NodeProps) {
  const { node } = data as unknown as NodeData;
  const style = styleOf(node);
  const points = (style.points ?? []) as InkPoint[];
  if (!points.length) return null;
  const b = inkBounds(points);
  const local = points.map(
    ([x, y, p]) => [x - b.minX, y - b.minY, p] as InkPoint,
  );
  return (
    <svg
      width={node.width}
      height={node.height}
      className="pointer-events-none overflow-visible"
    >
      <path d={strokePath(local, style.size ?? 6)} fill={style.color ?? "#0f172a"} />
    </svg>
  );
}

// ── References ────────────────────────────────────────────────────────────────

const STATE_RING: Record<string, string> = {
  ok: "border-border",
  warn: "border-amber-400",
  late: "border-rose-500",
  gone: "border-dashed border-muted-foreground",
};

/** The statuses a task card offers, in the order a task moves through them. */
const CARD_STATUSES = TASK_STATUSES;

function RefNode({ data, selected }: NodeProps) {
  const { node, resolved, canEdit, folded } = data as unknown as NodeData;
  const board = useBoard();
  const title = resolved?.title || node.label || "Loading…";
  const editableTask =
    canEdit && node.kind === "task" && Boolean(node.ref_id) && !resolved?.missing;
  const stroke = styleOf(node).stroke;
  // A task shows its status as the card border, unless it is late or you picked a colour.
  const statusRing =
    node.kind === "task" &&
    !resolved?.missing &&
    !stroke &&
    (resolved?.state ?? "ok") === "ok" &&
    resolved?.status
      ? STATUS_RING[resolved.status as TaskStatus]
      : null;
  return (
    <>
      <Resizer node={node} visible={Boolean(selected) && canEdit} minWidth={140} minHeight={70} />
      <Handles />
      {folded ? (
        <button
          type="button"
          title={`${folded} sub-task${folded === 1 ? "" : "s"} folded in — click to open`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => board.toggleFolded(node.id)}
          className="nodrag absolute -right-2 -top-2 z-10 flex h-6 min-w-6 items-center justify-center rounded-full border border-border bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground shadow"
        >
          +{folded}
        </button>
      ) : null}
      <div
        className={cn(
          "flex h-full w-full flex-col gap-1 overflow-hidden rounded-md bg-card p-2 shadow-sm",
          statusRing ? cn("border-2", statusRing) : "border",
          statusRing ? null : STATE_RING[resolved?.state ?? "ok"],
        )}
        style={{ borderColor: stroke }}
      >
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {node.kind.replace("_", " ")}
        </div>
        <div className="line-clamp-2 text-sm font-medium text-foreground">{title}</div>
        {resolved?.subtitle ? (
          <div className="truncate text-xs text-muted-foreground">{resolved.subtitle}</div>
        ) : null}
        {editableTask ? (
          <select
            value={resolved?.status ?? "todo"}
            // The board owns the click, so keep it from starting a drag.
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => board.setTaskStatus(node.ref_id!, e.target.value)}
            className="nodrag mt-auto rounded border border-border bg-background px-1 py-0.5 text-xs text-muted-foreground"
          >
            {CARD_STATUSES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        ) : resolved?.status ? (
          <div className="mt-auto text-xs text-muted-foreground">{resolved.status}</div>
        ) : null}
        {resolved?.missing ? (
          <div className="mt-auto text-xs text-rose-500">No longer exists</div>
        ) : null}
      </div>
    </>
  );
}

// ── Shared text ───────────────────────────────────────────────────────────────

function AutoText({
  node,
  canEdit,
  onHeight,
  onCommit,
  onDone,
  autoFocus,
  className,
  placeholder,
  fallbackColor,
}: {
  node: CanvasNode;
  canEdit: boolean;
  onHeight?: (height: number) => void;
  onCommit: (text: string) => void;
  onDone?: () => void;
  autoFocus?: boolean;
  className?: string;
  placeholder?: string;
  fallbackColor?: string;
}) {
  return (
    <AutoGrowText
      value={node.content}
      readOnly={!canEdit}
      onHeight={onHeight}
      onCommit={onCommit}
      onDone={onDone}
      autoFocus={autoFocus}
      placeholder={placeholder}
      className={className}
      style={textLook(styleOf(node), fallbackColor)}
    />
  );
}

export const NODE_TYPES = {
  sticky: StickyNode,
  text: TextNode,
  shape: ShapeNode,
  frame: FrameNode,
  image: ImageNode,
  ink: InkNode,
  ref: RefNode,
};

const FREEFORM = ["sticky", "text", "shape", "frame", "image", "ink"];

export function typeFor(kind: NodeKind): string {
  return FREEFORM.includes(kind) ? kind : "ref";
}

/** Kinds whose interior lets the pointer through to whatever is behind. */
export function isHollow(node: Pick<CanvasNode, "kind" | "style">): boolean {
  if (node.kind === "frame") return true;
  if (node.kind !== "shape") return false;
  return !shapeLook(styleOf(node)).solid;
}
