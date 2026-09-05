/**
 * What a node renderer is allowed to ask of the board.
 *
 * Node components are mounted by React Flow, not by us, so the board hands
 * them its editing verbs through context rather than props.
 */

import { createContext, useContext } from "react";
import type { Source } from "@/api/tasks";
import type { CanvasNode, NodeKind, ResolvedRef } from "@/types/canvas";

/**
 * The drag payload the board accepts.
 *
 * Anything that can name a thing the canvas knows how to draw can offer it:
 * the material rail, and the tasks tab, which is why this does not live in
 * CanvasTab any more.
 */
export const DRAG_MIME = "application/x-littlegerry-item";

export interface RailItem {
  kind: NodeKind;
  refId: string;
  label: string;
}

export interface NodeData {
  node: CanvasNode;
  resolved?: ResolvedRef;
  canEdit: boolean;
  ctx: { projectId: string; canvasId: string; source: Source };
  /** How many cards are folded into this one, zero when nothing is. */
  folded?: number;
}

export interface ResizeBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BoardApi {
  editable: boolean;
  /** The node whose text is open for typing, if any. */
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  /** Take an undo snapshot before the next change. */
  remember: () => void;
  saveContent: (id: string, content: string) => void;
  /** A box has outgrown its text; make it taller. */
  grow: (id: string, height: number) => void;
  endResize: (node: CanvasNode, box: ResizeBox) => void;
  /** A task card is the task. Changing it here changes it everywhere. */
  setTaskStatus: (taskId: string, status: string) => void;
  /** Open a folded family, or fold it away again. */
  toggleFolded: (nodeId: string) => void;
}

const inert: BoardApi = {
  editable: false,
  editingId: null,
  setEditingId: () => undefined,
  remember: () => undefined,
  saveContent: () => undefined,
  grow: () => undefined,
  endResize: () => undefined,
  setTaskStatus: () => undefined,
  toggleFolded: () => undefined,
};

export const BoardContext = createContext<BoardApi>(inert);

export function useBoard(): BoardApi {
  return useContext(BoardContext);
}
