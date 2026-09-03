/**
 * Pure geometry and diffing for the canvas.
 *
 * Kept out of the component so the arithmetic can be reasoned about on its own:
 * nothing here touches React, the network or the clock.
 */

import type { CanvasEdge, CanvasNode } from "@/types/canvas";

export interface Box {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type AlignMode = "left" | "center" | "right" | "top" | "middle" | "bottom";
export type Axis = "x" | "y";

/** New positions for an align. Only the moved axis is returned. */
export function alignBoxes(
  boxes: Box[],
  mode: AlignMode,
): Map<string, { x?: number; y?: number }> {
  const moves = new Map<string, { x?: number; y?: number }>();
  if (boxes.length < 2) return moves;

  if (mode === "left" || mode === "center" || mode === "right") {
    const left = Math.min(...boxes.map((b) => b.x));
    const right = Math.max(...boxes.map((b) => b.x + b.width));
    const centre = (left + right) / 2;
    boxes.forEach((b) => {
      const x =
        mode === "left" ? left : mode === "right" ? right - b.width : centre - b.width / 2;
      if (x !== b.x) moves.set(b.id, { x });
    });
    return moves;
  }

  const top = Math.min(...boxes.map((b) => b.y));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  const middle = (top + bottom) / 2;
  boxes.forEach((b) => {
    const y =
      mode === "top" ? top : mode === "bottom" ? bottom - b.height : middle - b.height / 2;
    if (y !== b.y) moves.set(b.id, { y });
  });
  return moves;
}

/** Even out the gaps between boxes, leaving the two outermost where they are. */
export function distributeBoxes(
  boxes: Box[],
  axis: Axis,
): Map<string, { x?: number; y?: number }> {
  const moves = new Map<string, { x?: number; y?: number }>();
  if (boxes.length < 3) return moves;

  const size = (b: Box) => (axis === "x" ? b.width : b.height);
  const pos = (b: Box) => (axis === "x" ? b.x : b.y);
  const sorted = [...boxes].sort((a, b) => pos(a) - pos(b));

  const start = pos(sorted[0]);
  const last = sorted[sorted.length - 1];
  const end = pos(last) + size(last);
  const used = sorted.reduce((total, b) => total + size(b), 0);
  const gap = (end - start - used) / (sorted.length - 1);

  let cursor = start;
  sorted.forEach((b, i) => {
    if (i > 0 && i < sorted.length - 1) {
      const rounded = Math.round(cursor);
      if (rounded !== pos(b)) {
        moves.set(b.id, axis === "x" ? { x: rounded } : { y: rounded });
      }
    }
    cursor += size(b) + gap;
  });
  return moves;
}

export interface SnapResult {
  x: number;
  y: number;
  /** Where to draw the guide lines, in flow coordinates. */
  guides: { axis: Axis; at: number }[];
}

/**
 * Pull a dragged box onto the nearest edge or centre line of its neighbours.
 * Returns the box's own position, snapped where a neighbour was close enough.
 */
export function snapToObjects(
  moving: Box,
  others: Box[],
  threshold = 6,
): SnapResult {
  const guides: { axis: Axis; at: number }[] = [];
  let bestX: { at: number; delta: number; guide: number } | null = null;
  let bestY: { at: number; delta: number; guide: number } | null = null;

  const mine = {
    x: [moving.x, moving.x + moving.width / 2, moving.x + moving.width],
    y: [moving.y, moving.y + moving.height / 2, moving.y + moving.height],
  };

  others.forEach((o) => {
    const theirs = {
      x: [o.x, o.x + o.width / 2, o.x + o.width],
      y: [o.y, o.y + o.height / 2, o.y + o.height],
    };
    mine.x.forEach((m, i) => {
      theirs.x.forEach((t) => {
        const delta = Math.abs(t - m);
        if (delta <= threshold && (bestX === null || delta < bestX.delta)) {
          const offset = [0, moving.width / 2, moving.width][i];
          bestX = { at: t - offset, delta, guide: t };
        }
      });
    });
    mine.y.forEach((m, i) => {
      theirs.y.forEach((t) => {
        const delta = Math.abs(t - m);
        if (delta <= threshold && (bestY === null || delta < bestY.delta)) {
          const offset = [0, moving.height / 2, moving.height][i];
          bestY = { at: t - offset, delta, guide: t };
        }
      });
    });
  });

  const snappedX = bestX as { at: number; guide: number } | null;
  const snappedY = bestY as { at: number; guide: number } | null;
  if (snappedX) guides.push({ axis: "x", at: snappedX.guide });
  if (snappedY) guides.push({ axis: "y", at: snappedY.guide });
  return {
    x: snappedX ? snappedX.at : moving.x,
    y: snappedY ? snappedY.at : moving.y,
    guides,
  };
}

// ── Undo ──────────────────────────────────────────────────────────────────────

export interface Snapshot {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export interface SnapshotDiff {
  /** Nodes to put back. Their ids are gone, so the caller gets new ones. */
  createNodes: CanvasNode[];
  /** Nodes that exist in both but differ. */
  patchNodes: (Partial<CanvasNode> & { id: string })[];
  removeNodeIds: string[];
  createEdges: CanvasEdge[];
  removeEdgeIds: string[];
}

const NODE_FIELDS = [
  "x",
  "y",
  "width",
  "height",
  "z",
  "label",
  "content",
] as const;

function differs(a: CanvasNode, b: CanvasNode): boolean {
  if (NODE_FIELDS.some((f) => a[f] !== b[f])) return true;
  return JSON.stringify(a.style ?? {}) !== JSON.stringify(b.style ?? {});
}

/** What has to happen to turn `current` back into `target`. */
export function diffSnapshots(current: Snapshot, target: Snapshot): SnapshotDiff {
  const currentNodes = new Map(current.nodes.map((n) => [n.id, n]));
  const targetNodes = new Map(target.nodes.map((n) => [n.id, n]));

  const createNodes = target.nodes.filter((n) => !currentNodes.has(n.id));
  const removeNodeIds = current.nodes
    .filter((n) => !targetNodes.has(n.id))
    .map((n) => n.id);
  const patchNodes: (Partial<CanvasNode> & { id: string })[] = [];
  target.nodes.forEach((wanted) => {
    const now = currentNodes.get(wanted.id);
    if (now && differs(now, wanted)) {
      patchNodes.push({
        id: wanted.id,
        x: wanted.x,
        y: wanted.y,
        width: wanted.width,
        height: wanted.height,
        z: wanted.z,
        label: wanted.label,
        content: wanted.content,
        style: wanted.style,
      });
    }
  });

  const key = (e: CanvasEdge) => `${e.source_node_id}->${e.target_node_id}`;
  const currentEdges = new Map(current.edges.map((e) => [key(e), e]));
  const targetEdges = new Map(target.edges.map((e) => [key(e), e]));
  const createEdges = target.edges.filter((e) => !currentEdges.has(key(e)));
  const removeEdgeIds = current.edges
    .filter((e) => !targetEdges.has(key(e)))
    .map((e) => e.id);

  return { createNodes, patchNodes, removeNodeIds, createEdges, removeEdgeIds };
}

/**
 * Rewrite ids through a map.
 *
 * Restoring a deleted node gives it a new id, which would make every older
 * snapshot point at a row that no longer exists. Rewriting them keeps the rest
 * of the stack usable.
 */
export function remapSnapshot(
  snapshot: Snapshot,
  remap: Map<string, string>,
): Snapshot {
  if (remap.size === 0) return snapshot;
  const to = (id: string) => remap.get(id) ?? id;
  return {
    nodes: snapshot.nodes.map((n) =>
      remap.has(n.id) || (n.parent_node_id && remap.has(n.parent_node_id))
        ? {
            ...n,
            id: to(n.id),
            parent_node_id: n.parent_node_id ? to(n.parent_node_id) : null,
          }
        : n,
    ),
    edges: snapshot.edges.map((e) =>
      remap.has(e.source_node_id) || remap.has(e.target_node_id)
        ? {
            ...e,
            source_node_id: to(e.source_node_id),
            target_node_id: to(e.target_node_id),
          }
        : e,
    ),
  };
}
