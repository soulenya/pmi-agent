/**
 * What a node renderer is allowed to ask of the board.
 *
 * Node components are mounted by React Flow, not by us, so the board hands
 * them its editing verbs through context rather than props.
 */

import { createContext, useContext } from "react";
import type { Source } from "@/api/tasks";
import type { CanvasNode, ResolvedRef } from "@/types/canvas";

export interface NodeData {
  node: CanvasNode;
  resolved?: ResolvedRef;
  canEdit: boolean;
  ctx: { projectId: string; canvasId: string; source: Source };
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
}

const inert: BoardApi = {
  editable: false,
  editingId: null,
  setEditingId: () => undefined,
  remember: () => undefined,
  saveContent: () => undefined,
  grow: () => undefined,
  endResize: () => undefined,
};

export const BoardContext = createContext<BoardApi>(inert);

export function useBoard(): BoardApi {
  return useContext(BoardContext);
}
