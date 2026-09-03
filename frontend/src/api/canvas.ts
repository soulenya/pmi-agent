import { apiClient } from "./client";
import type { Source } from "./tasks";
import type {
  Canvas,
  CanvasEdge,
  CanvasFull,
  CanvasNode,
  NodeKind,
  NodePatch,
  ResolvedRef,
  Viewport,
} from "@/types/canvas";

function at(source: Source, path: string): string {
  return source === "hub" ? `/hub/api${path}` : path;
}

export async function getDefaultCanvas(
  projectId: string,
  source: Source = "local",
): Promise<CanvasFull> {
  const resp = await apiClient.get<CanvasFull>(
    at(source, `/projects/${projectId}/canvas/default`),
  );
  return resp.data;
}

export async function updateCanvas(
  projectId: string,
  canvasId: string,
  body: { name?: string; viewport?: Viewport },
  source: Source = "local",
): Promise<Canvas> {
  const resp = await apiClient.patch<Canvas>(
    at(source, `/projects/${projectId}/canvas/${canvasId}`),
    body,
  );
  return resp.data;
}

export async function createNode(
  projectId: string,
  canvasId: string,
  body: {
    kind: NodeKind;
    ref_id?: string | null;
    label?: string;
    content?: string;
    x: number;
    y: number;
    width?: number;
    height?: number;
    style?: Record<string, unknown>;
  },
  source: Source = "local",
): Promise<CanvasNode> {
  const resp = await apiClient.post<CanvasNode>(
    at(source, `/projects/${projectId}/canvas/${canvasId}/nodes`),
    body,
  );
  return resp.data;
}

/** Batched autosave — one request per idle pause, not one per drag frame. */
export async function saveNodes(
  projectId: string,
  canvasId: string,
  nodes: NodePatch[],
  source: Source = "local",
): Promise<CanvasNode[]> {
  const resp = await apiClient.patch<CanvasNode[]>(
    at(source, `/projects/${projectId}/canvas/${canvasId}/nodes`),
    { nodes },
  );
  return resp.data;
}

export async function deleteNode(
  projectId: string,
  canvasId: string,
  nodeId: string,
  source: Source = "local",
): Promise<void> {
  await apiClient.delete(
    at(source, `/projects/${projectId}/canvas/${canvasId}/nodes/${nodeId}`),
  );
}

export async function createEdge(
  projectId: string,
  canvasId: string,
  body: {
    source_node_id: string;
    target_node_id: string;
    kind?: string;
    label?: string;
  },
  source: Source = "local",
): Promise<CanvasEdge> {
  const resp = await apiClient.post<CanvasEdge>(
    at(source, `/projects/${projectId}/canvas/${canvasId}/edges`),
    body,
  );
  return resp.data;
}

export async function deleteEdge(
  projectId: string,
  canvasId: string,
  edgeId: string,
  source: Source = "local",
): Promise<void> {
  await apiClient.delete(
    at(source, `/projects/${projectId}/canvas/${canvasId}/edges/${edgeId}`),
  );
}

/** Live data for every reference node in one round trip. */
export async function resolveNodes(
  projectId: string,
  canvasId: string,
  nodeIds: string[] = [],
  source: Source = "local",
): Promise<ResolvedRef[]> {
  const resp = await apiClient.post<{ items: ResolvedRef[] }>(
    at(source, `/projects/${projectId}/canvas/${canvasId}/resolve`),
    { node_ids: nodeIds },
  );
  return resp.data.items;
}
