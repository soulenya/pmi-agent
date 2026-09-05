/** Canvas — a project's infinite whiteboard. */

export const FREEFORM_KINDS = [
  "sticky",
  "text",
  "frame",
  "shape",
  "image",
  "ink",
  "link",
] as const;

export const REFERENCE_KINDS = [
  "task",
  "kb_doc",
  "drive_doc",
  "regulatory_doc",
  "budget",
  "website",
  "generated_file",
  "email_thread",
  "conversation",
  "project",
  "canvas",
] as const;

export type FreeformKind = (typeof FREEFORM_KINDS)[number];
export type ReferenceKind = (typeof REFERENCE_KINDS)[number];
export type NodeKind = FreeformKind | ReferenceKind;

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/** One freehand stroke, stored as raw pointer samples. */
export interface InkStroke {
  points: [number, number, number][];
  color: string;
  size: number;
}

export interface CanvasNode {
  id: string;
  canvas_id: string;
  parent_node_id: string | null;
  kind: NodeKind;
  ref_id: string | null;
  label: string;
  content: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  style: Record<string, unknown>;
}

export interface CanvasEdge {
  id: string;
  canvas_id: string;
  source_node_id: string;
  target_node_id: string;
  source_handle: string | null;
  target_handle: string | null;
  kind: string;
  label: string;
  style: Record<string, unknown>;
}

export interface Canvas {
  id: string;
  project_id: string;
  name: string;
  viewport: Viewport;
}

export interface CanvasFull extends Canvas {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  my_role: string;
}

export interface NodePatch {
  id: string;
  label?: string;
  content?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  z?: number;
  style?: Record<string, unknown>;
}

export interface ResolvedRef {
  node_id: string;
  kind: string;
  ref_id: string | null;
  title: string;
  subtitle: string;
  status: string | null;
  state: "ok" | "warn" | "late" | "gone";
  missing: boolean;
  parent_ref_id?: string | null;
}
