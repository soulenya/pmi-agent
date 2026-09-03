/**
 * CanvasTab — the project's infinite whiteboard.
 *
 * Free-form nodes carry their own content; reference nodes point at something
 * that already exists in the app and are resolved in one batch, never one
 * request per node. Ink is decorative: stored and drawn, never indexed.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  NodeResizer,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type OnConnect,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import getStroke from "perfect-freehand";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  BringToFront,
  Copy,
  Eraser,
  Frame,
  Grid3x3,
  Image as ImageIcon,
  Loader2,
  MousePointer2,
  PenLine,
  Redo2,
  SendToBack,
  Square,
  StickyNote,
  Type,
  Undo2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Source } from "@/api/tasks";
import { getProjectSpace, listTasks } from "@/api/tasks";
import { getWorkroom, type WorkroomItemKind } from "@/api/workrooms";
import {
  createEdge,
  createNode,
  deleteEdge,
  deleteNode,
  fetchCanvasImage,
  getDefaultCanvas,
  resolveNodes,
  saveNodes,
  uploadCanvasImage,
} from "@/api/canvas";
import type {
  CanvasEdge as ApiEdge,
  CanvasFull,
  CanvasNode as ApiNode,
  InkStroke,
  NodeKind,
  ResolvedRef,
} from "@/types/canvas";
import {
  alignBoxes,
  diffSnapshots,
  distributeBoxes,
  remapSnapshot,
  snapToObjects,
  type AlignMode,
  type Axis,
  type Box,
  type Snapshot,
} from "./canvasOps";

const SAVE_DEBOUNCE_MS = 700;

/** How close a dragged node has to come before it snaps to a neighbour. */
const SNAP_PX = 6;
const GRID = 8;
const UNDO_DEPTH = 40;

/** What a Material rail entry puts on the drag. */
const DRAG_MIME = "application/x-littlegerry-item";

// Workroom pins whose kind the canvas can draw as a reference node.
const RAIL_KINDS: WorkroomItemKind[] = [
  "kb_doc",
  "drive_doc",
  "regulatory_doc",
  "budget",
  "website",
  "generated_file",
  "email_thread",
  "task",
];

const STICKY_COLORS = [
  "#fde68a",
  "#bfdbfe",
  "#bbf7d0",
  "#fecaca",
  "#e9d5ff",
  "#e5e7eb",
];

type Tool = "select" | "sticky" | "text" | "shape" | "frame" | "pen" | "eraser";

type NodeData = {
  node: ApiNode;
  resolved?: ResolvedRef;
  canEdit: boolean;
  ctx: { projectId: string; canvasId: string; source: Source };
};

// ── Ink ───────────────────────────────────────────────────────────────────────

function strokePath(points: [number, number, number][], size: number): string {
  const outline = getStroke(points, {
    size,
    thinning: 0.6,
    smoothing: 0.5,
    streamline: 0.5,
  });
  if (!outline.length) return "";
  const d = outline.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      return acc;
    },
    ["M", ...outline[0], "Q"] as (string | number)[],
  );
  return `${d.join(" ")} Z`;
}

function inkBounds(points: [number, number, number][]) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

// ── Node renderers ────────────────────────────────────────────────────────────

function handles() {
  return (
    <>
      <Handle type="target" position={Position.Left} className="!h-2 !w-2" />
      <Handle type="source" position={Position.Right} className="!h-2 !w-2" />
    </>
  );
}

function StickyNode({ data, selected, id }: NodeProps) {
  const { node, canEdit } = data as unknown as NodeData;
  const queryClient = useQueryClient();
  const color = (node.style?.color as string) ?? STICKY_COLORS[0];
  return (
    <>
      <NodeResizer isVisible={Boolean(selected) && canEdit} minWidth={120} minHeight={80} />
      {handles()}
      <div
        className="h-full w-full rounded-sm p-2 text-sm text-neutral-900 shadow-sm"
        style={{ background: color }}
      >
        <textarea
          defaultValue={node.content}
          readOnly={!canEdit}
          onBlur={(e) => {
            if (!canEdit || e.target.value === node.content) return;
            window.dispatchEvent(
              new CustomEvent("canvas-node-content", {
                detail: { id, content: e.target.value },
              }),
            );
            void queryClient;
          }}
          className="h-full w-full resize-none border-0 bg-transparent p-0 text-sm outline-none"
          placeholder="Note"
        />
      </div>
    </>
  );
}

function TextNode({ data, selected, id }: NodeProps) {
  const { node, canEdit } = data as unknown as NodeData;
  return (
    <>
      <NodeResizer isVisible={Boolean(selected) && canEdit} minWidth={80} minHeight={30} />
      {handles()}
      <textarea
        defaultValue={node.content}
        readOnly={!canEdit}
        onBlur={(e) => {
          if (!canEdit || e.target.value === node.content) return;
          window.dispatchEvent(
            new CustomEvent("canvas-node-content", {
              detail: { id, content: e.target.value },
            }),
          );
        }}
        className="h-full w-full resize-none border-0 bg-transparent p-1 text-sm text-foreground outline-none"
        placeholder="Text"
      />
    </>
  );
}

function ShapeNode({ data, selected }: NodeProps) {
  const { node, canEdit } = data as unknown as NodeData;
  const color = (node.style?.color as string) ?? "#94a3b8";
  return (
    <>
      <NodeResizer isVisible={Boolean(selected) && canEdit} minWidth={40} minHeight={40} />
      {handles()}
      <div
        className="h-full w-full rounded-md border-2"
        style={{ borderColor: color, background: `${color}22` }}
      />
    </>
  );
}

function FrameNode({ data, selected }: NodeProps) {
  const { node, canEdit } = data as unknown as NodeData;
  return (
    <>
      <NodeResizer isVisible={Boolean(selected) && canEdit} minWidth={160} minHeight={120} />
      <div className="h-full w-full rounded-md border-2 border-dashed border-border bg-muted/20">
        <div className="px-2 py-1 text-xs text-muted-foreground">
          {node.label || "Frame"}
        </div>
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
      <NodeResizer isVisible={Boolean(selected) && canEdit} minWidth={60} minHeight={60} />
      {handles()}
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
  const stroke = node.style as unknown as InkStroke;
  const points = (stroke?.points ?? []) as [number, number, number][];
  if (!points.length) return null;
  const b = inkBounds(points);
  const local = points.map(
    ([x, y, p]) => [x - b.minX, y - b.minY, p] as [number, number, number],
  );
  return (
    <svg
      width={node.width}
      height={node.height}
      className="pointer-events-none overflow-visible"
    >
      <path d={strokePath(local, stroke.size ?? 6)} fill={stroke.color ?? "#0f172a"} />
    </svg>
  );
}

const STATE_RING: Record<string, string> = {
  ok: "border-border",
  warn: "border-amber-400",
  late: "border-rose-500",
  gone: "border-dashed border-muted-foreground",
};

function RefNode({ data, selected }: NodeProps) {
  const { node, resolved, canEdit } = data as unknown as NodeData;
  const title = resolved?.title || node.label || "Loading…";
  return (
    <>
      <NodeResizer isVisible={Boolean(selected) && canEdit} minWidth={140} minHeight={70} />
      {handles()}
      <div
        className={cn(
          "flex h-full w-full flex-col gap-1 rounded-md border bg-card p-2 shadow-sm",
          STATE_RING[resolved?.state ?? "ok"],
        )}
      >
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {node.kind.replace("_", " ")}
        </div>
        <div className="line-clamp-2 text-sm font-medium text-foreground">{title}</div>
        {resolved?.subtitle ? (
          <div className="truncate text-xs text-muted-foreground">{resolved.subtitle}</div>
        ) : null}
        {resolved?.status ? (
          <div className="mt-auto text-xs text-muted-foreground">{resolved.status}</div>
        ) : null}
        {resolved?.missing ? (
          <div className="mt-auto text-xs text-rose-500">No longer exists</div>
        ) : null}
      </div>
    </>
  );
}

const NODE_TYPES = {
  sticky: StickyNode,
  text: TextNode,
  shape: ShapeNode,
  frame: FrameNode,
  image: ImageNode,
  ink: InkNode,
  ref: RefNode,
};

function typeFor(kind: NodeKind): string {
  if (["sticky", "text", "shape", "frame", "image", "ink"].includes(kind)) return kind;
  return "ref";
}

// ── The board ─────────────────────────────────────────────────────────────────

interface Props {
  projectId: string;
  source?: Source;
  canEdit: boolean;
}

function Board({ projectId, source = "local", canEdit }: Props) {
  const queryClient = useQueryClient();
  const flow = useReactFlow();
  const navigate = useNavigate();
  const base = source === "hub" ? `/hub/projects/${projectId}` : `/projects/${projectId}`;
  const wrapper = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [color, setColor] = useState(STICKY_COLORS[0]);
  const [penColor, setPenColor] = useState("#0f172a");
  const [error, setError] = useState<string | null>(null);
  const [stroke, setStroke] = useState<[number, number, number][]>([]);
  const drawing = useRef(false);

  const key = ["project-canvas", source, projectId] as const;
  const { data, isLoading } = useQuery<CanvasFull>({
    queryKey: key,
    queryFn: () => getDefaultCanvas(projectId, source),
  });
  const canvasId = data?.id ?? "";
  const editable = canEdit && Boolean(canvasId) && canvasId !== ZERO_UUID;

  const refIds = useMemo(
    () => (data?.nodes ?? []).filter((n) => n.ref_id).map((n) => n.id),
    [data?.nodes],
  );
  const { data: resolved } = useQuery<ResolvedRef[]>({
    queryKey: ["project-canvas-refs", source, canvasId, refIds.join(",")],
    queryFn: () => resolveNodes(projectId, canvasId, refIds, source),
    enabled: Boolean(canvasId) && refIds.length > 0,
    staleTime: 30_000,
  });

  const resolvedByNode = useMemo(() => {
    const map = new Map<string, ResolvedRef>();
    (resolved ?? []).forEach((r) => map.set(r.node_id, r));
    return map;
  }, [resolved]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Rebuild the board whenever the server's copy changes.
  useEffect(() => {
    if (!data) return;
    setNodes(
      data.nodes.map((n) => ({
        id: n.id,
        type: typeFor(n.kind),
        position: { x: n.x, y: n.y },
        width: n.width,
        height: n.height,
        zIndex: n.z,
        draggable: canEdit && n.kind !== "ink",
        selectable: true,
        parentId: n.parent_node_id ?? undefined,
        data: {
          node: n,
          resolved: resolvedByNode.get(n.id),
          canEdit,
          ctx: { projectId, canvasId: data.id, source },
        },
      })),
    );
    setEdges(
      data.edges.map((e) => ({
        id: e.id,
        source: e.source_node_id,
        target: e.target_node_id,
        label: e.label || undefined,
        animated: e.kind === "depends_on",
      })),
    );
  }, [data, resolvedByNode, canEdit, setNodes, setEdges, projectId, source]);

  // ── Saving ────────────────────────────────────────────────────────────────
  const pending = useRef<Map<string, Record<string, unknown>>>(new Map());
  const timer = useRef<number | null>(null);

  const flushSave = useCallback(async () => {
    if (!canvasId || pending.current.size === 0) return;
    const batch = Array.from(pending.current.entries()).map(([id, patch]) => ({
      id,
      ...patch,
    }));
    pending.current.clear();
    try {
      await saveNodes(projectId, canvasId, batch as never, source);
      await queryClient.invalidateQueries({ queryKey: key });
    } catch {
      setError("That change did not save. Check your connection.");
    }
  }, [canvasId, projectId, source, queryClient, key]);

  const queueSave = useCallback(
    (id: string, patch: Record<string, unknown>) => {
      if (!editable) return;
      const current = pending.current.get(id) ?? {};
      pending.current.set(id, { ...current, ...patch });
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flushSave(), SAVE_DEBOUNCE_MS);
    },
    [editable, flushSave],
  );

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
      void flushSave();
    };
  }, [flushSave]);

  // Sticky and text bodies come back through a DOM event so the textarea can
  // stay uncontrolled and not fight the user's cursor.
  useEffect(() => {
    const onContent = (e: Event) => {
      const detail = (e as CustomEvent).detail as { id: string; content: string };
      queueSave(detail.id, { content: detail.content });
    };
    window.addEventListener("canvas-node-content", onContent);
    return () => window.removeEventListener("canvas-node-content", onContent);
  }, [queueSave]);

  const addNode = useMutation({
    mutationFn: (body: Parameters<typeof createNode>[2]) =>
      createNode(projectId, canvasId, body, source),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
    onError: () => setError("The item could not be added."),
  });

  const removeNode = useMutation({
    mutationFn: (id: string) => deleteNode(projectId, canvasId, id, source),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  const addEdgeMutation = useMutation({
    mutationFn: (c: Connection) =>
      createEdge(
        projectId,
        canvasId,
        { source_node_id: c.source!, target_node_id: c.target! },
        source,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: key });
      queryClient.invalidateQueries({ queryKey: ["project-timeline", source, projectId] });
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response
        ?.data?.detail;
      setError(detail ?? "Those two could not be linked.");
      queryClient.invalidateQueries({ queryKey: key });
    },
  });

  const removeEdgeMutation = useMutation({
    mutationFn: (id: string) => deleteEdge(projectId, canvasId, id, source),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: key });
      queryClient.invalidateQueries({ queryKey: ["project-timeline", source, projectId] });
    },
  });

  // ── Undo and redo ─────────────────────────────────────────────────────────
  // The board is the server's, so undo replays the difference between the
  // saved state and the snapshot rather than keeping a local shadow copy.
  const past = useRef<Snapshot[]>([]);
  const future = useRef<Snapshot[]>([]);
  const [depths, setDepths] = useState({ past: 0, future: 0 });
  const [busy, setBusy] = useState(false);

  const currentSnapshot = useCallback((): Snapshot => {
    const live = new Map(nodes.map((n) => [n.id, n]));
    return {
      nodes: (data?.nodes ?? []).map((n) => {
        const l = live.get(n.id);
        if (!l) return n;
        return {
          ...n,
          x: l.position.x,
          y: l.position.y,
          width: l.width ?? n.width,
          height: l.height ?? n.height,
        };
      }),
      edges: (data?.edges ?? []) as ApiEdge[],
    };
  }, [nodes, data]);

  const remember = useCallback(() => {
    past.current = [...past.current, currentSnapshot()].slice(-UNDO_DEPTH);
    future.current = [];
    setDepths({ past: past.current.length, future: 0 });
  }, [currentSnapshot]);

  const restore = useCallback(
    async (target: Snapshot) => {
      if (!canvasId) return;
      setBusy(true);
      try {
        await flushSave();
        const diff = diffSnapshots(currentSnapshot(), target);
        const remap = new Map<string, string>();
        let lostImage = false;

        // Parents before children, so a frame exists before what sits in it.
        const toCreate = [...diff.createNodes].sort(
          (a, b) => Number(Boolean(a.parent_node_id)) - Number(Boolean(b.parent_node_id)),
        );
        for (const n of toCreate) {
          if (n.kind === "image") {
            // The picture's bytes went with the node; there is nothing to put back.
            lostImage = true;
            continue;
          }
          const made = await createNode(
            projectId,
            canvasId,
            {
              kind: n.kind,
              ref_id: n.ref_id,
              label: n.label,
              content: n.content,
              x: n.x,
              y: n.y,
              width: n.width,
              height: n.height,
              z: n.z,
              style: n.style,
              parent_node_id: n.parent_node_id
                ? remap.get(n.parent_node_id) ?? n.parent_node_id
                : null,
            },
            source,
          );
          remap.set(n.id, made.id);
        }

        if (diff.patchNodes.length) {
          await saveNodes(projectId, canvasId, diff.patchNodes as never, source);
        }
        for (const e of diff.createEdges) {
          await createEdge(
            projectId,
            canvasId,
            {
              source_node_id: remap.get(e.source_node_id) ?? e.source_node_id,
              target_node_id: remap.get(e.target_node_id) ?? e.target_node_id,
              kind: e.kind,
              label: e.label,
            },
            source,
          );
        }
        for (const id of diff.removeEdgeIds) {
          await deleteEdge(projectId, canvasId, id, source);
        }
        for (const id of diff.removeNodeIds) {
          await deleteNode(projectId, canvasId, id, source);
        }

        if (remap.size) {
          past.current = past.current.map((s) => remapSnapshot(s, remap));
          future.current = future.current.map((s) => remapSnapshot(s, remap));
        }
        if (lostImage) {
          setError("Everything came back except the image — its file was deleted.");
        }
        await queryClient.invalidateQueries({ queryKey: key });
        await queryClient.invalidateQueries({
          queryKey: ["project-timeline", source, projectId],
        });
      } catch {
        setError("That could not be undone. The board has been reloaded.");
        await queryClient.invalidateQueries({ queryKey: key });
      } finally {
        setBusy(false);
      }
    },
    [canvasId, projectId, source, flushSave, currentSnapshot, queryClient, key],
  );

  const undo = useCallback(async () => {
    const target = past.current.pop();
    if (!target) return;
    future.current = [...future.current, currentSnapshot()].slice(-UNDO_DEPTH);
    setDepths({ past: past.current.length, future: future.current.length });
    await restore(target);
  }, [currentSnapshot, restore]);

  const redo = useCallback(async () => {
    const target = future.current.pop();
    if (!target) return;
    past.current = [...past.current, currentSnapshot()].slice(-UNDO_DEPTH);
    setDepths({ past: past.current.length, future: future.current.length });
    await restore(target);
  }, [currentSnapshot, restore]);

  // ── Arranging a selection ─────────────────────────────────────────────────
  const selection = useMemo(() => nodes.filter((n) => n.selected), [nodes]);

  const boxes = useMemo<Box[]>(
    () =>
      selection.map((n) => ({
        id: n.id,
        x: n.position.x,
        y: n.position.y,
        width: n.width ?? (n.data as unknown as NodeData).node.width,
        height: n.height ?? (n.data as unknown as NodeData).node.height,
      })),
    [selection],
  );

  const applyMoves = useCallback(
    (moves: Map<string, { x?: number; y?: number }>) => {
      if (!editable || moves.size === 0) return;
      remember();
      setNodes((ns) =>
        ns.map((n) => {
          const move = moves.get(n.id);
          if (!move) return n;
          return {
            ...n,
            position: { x: move.x ?? n.position.x, y: move.y ?? n.position.y },
          };
        }),
      );
      moves.forEach((move, id) => queueSave(id, { ...move }));
    },
    [editable, remember, setNodes, queueSave],
  );

  const align = useCallback(
    (mode: AlignMode) => applyMoves(alignBoxes(boxes, mode)),
    [boxes, applyMoves],
  );

  const distribute = useCallback(
    (axis: Axis) => applyMoves(distributeBoxes(boxes, axis)),
    [boxes, applyMoves],
  );

  const restack = useCallback(
    (direction: "front" | "back") => {
      if (!editable || selection.length === 0) return;
      remember();
      const all = data?.nodes ?? [];
      const top = Math.max(0, ...all.map((n) => n.z));
      const bottom = Math.min(0, ...all.map((n) => n.z));
      selection.forEach((n, i) => {
        const z = direction === "front" ? top + 1 + i : bottom - 1 - i;
        queueSave(n.id, { z });
      });
    },
    [editable, selection, remember, data?.nodes, queueSave],
  );

  /** Copy the picked nodes to a private clipboard; the OS one holds text. */
  const clipboard = useRef<ApiNode[]>([]);

  const copySelection = useCallback(() => {
    const picked = (data?.nodes ?? []).filter((n) =>
      selection.some((s) => s.id === n.id),
    );
    if (picked.length) clipboard.current = picked;
  }, [data?.nodes, selection]);

  const duplicateNodes = useCallback(
    (originals: ApiNode[], offset = 24) => {
      if (!editable || originals.length === 0) return;
      remember();
      originals.forEach((n) => {
        if (n.kind === "image") return; // the bytes belong to one node id
        addNode.mutate({
          kind: n.kind,
          ref_id: n.ref_id,
          label: n.label,
          content: n.content,
          x: n.x + offset,
          y: n.y + offset,
          width: n.width,
          height: n.height,
          z: n.z,
          style: n.style,
        });
      });
    },
    [editable, remember, addNode],
  );

  // ── Snapping ──────────────────────────────────────────────────────────────
  const [snapGrid, setSnapGrid] = useState(false);
  const [guides, setGuides] = useState<{ axis: Axis; at: number }[]>([]);

  const onConnect: OnConnect = useCallback(
    (connection) => {
      if (!editable || !connection.source || !connection.target) return;
      remember();
      setEdges((eds) => addEdge(connection, eds));
      addEdgeMutation.mutate(connection);
    },
    [editable, setEdges, addEdgeMutation, remember],
  );

  // ── Placing new things ────────────────────────────────────────────────────
  const place = useCallback(
    (clientX: number, clientY: number) => {
      const point = flow.screenToFlowPosition({ x: clientX, y: clientY });
      const defaults: Record<string, { w: number; h: number }> = {
        sticky: { w: 180, h: 140 },
        text: { w: 200, h: 40 },
        shape: { w: 140, h: 100 },
        frame: { w: 320, h: 240 },
      };
      const size = defaults[tool] ?? { w: 180, h: 120 };
      remember();
      addNode.mutate({
        kind: tool as NodeKind,
        x: point.x,
        y: point.y,
        width: size.w,
        height: size.h,
        style: tool === "sticky" || tool === "shape" ? { color } : {},
        label: tool === "frame" ? "Frame" : "",
      });
      setTool("select");
    },
    [flow, tool, color, addNode, remember],
  );

  const onPaneClick = useCallback(
    (event: React.MouseEvent) => {
      if (!editable) return;
      if (["sticky", "text", "shape", "frame"].includes(tool)) {
        place(event.clientX, event.clientY);
      }
    },
    [editable, tool, place],
  );

  // ── Freehand ──────────────────────────────────────────────────────────────
  const onPointerDown = useCallback(
    (event: ReactPointerEvent) => {
      if (tool !== "pen" || !editable) return;
      drawing.current = true;
      const p = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      setStroke([[p.x, p.y, event.pressure || 0.5]]);
    },
    [tool, editable, flow],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent) => {
      if (!drawing.current) return;
      const p = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      setStroke((s) => [...s, [p.x, p.y, event.pressure || 0.5]]);
    },
    [flow],
  );

  const onPointerUp = useCallback(() => {
    if (!drawing.current) return;
    drawing.current = false;
    const points = stroke;
    setStroke([]);
    if (points.length < 2) return;
    const b = inkBounds(points);
    const local = points.map(
      ([x, y, p]) => [x - b.minX, y - b.minY, p] as [number, number, number],
    );
    // Ink commits on pen-up, never per sample.
    remember();
    addNode.mutate({
      kind: "ink",
      x: b.minX,
      y: b.minY,
      width: Math.max(b.maxX - b.minX, 1),
      height: Math.max(b.maxY - b.minY, 1),
      style: { points: local, color: penColor, size: 6 },
    });
  }, [stroke, penColor, addNode, remember]);

  // ── Images ────────────────────────────────────────────────────────────────
  const addImage = useMutation({
    mutationFn: ({ file, at }: { file: File; at: { x: number; y: number } }) =>
      uploadCanvasImage(
        projectId,
        canvasId,
        file,
        { ...at, width: 280, height: 200 },
        source,
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response
        ?.data?.detail;
      setError(detail ?? "That image could not be added.");
    },
  });

  useEffect(() => {
    if (!editable) return;
    const onPaste = (event: ClipboardEvent) => {
      if (!wrapper.current?.contains(document.activeElement) && document.activeElement !== document.body) {
        return;
      }
      const file = Array.from(event.clipboardData?.files ?? [])[0];
      if (!file || !file.type.startsWith("image/")) return;
      event.preventDefault();
      const box = wrapper.current?.getBoundingClientRect();
      const at = flow.screenToFlowPosition({
        x: (box?.left ?? 0) + (box?.width ?? 0) / 2,
        y: (box?.top ?? 0) + (box?.height ?? 0) / 2,
      });
      addImage.mutate({ file, at });
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [editable, flow, addImage]);

  // ── Material rail ─────────────────────────────────────────────────────────
  const { data: space } = useQuery({
    queryKey: ["project-space", source, projectId],
    queryFn: () => getProjectSpace(projectId, source),
  });
  const workroomId = space?.workroom?.id ?? null;

  const { data: railTasks } = useQuery({
    queryKey: ["tasks", { project_id: projectId }, source],
    queryFn: () => listTasks({ project_id: projectId }, source),
  });
  const { data: room } = useQuery({
    queryKey: ["workroom", workroomId],
    queryFn: () => getWorkroom(workroomId!),
    // The workroom behind a hub project lives on the hub, not here.
    enabled: Boolean(workroomId) && source === "local",
  });

  const placed = useMemo(
    () => new Set((data?.nodes ?? []).map((n) => n.ref_id).filter(Boolean) as string[]),
    [data?.nodes],
  );

  const rail = useMemo(() => {
    const items: { kind: NodeKind; refId: string; label: string }[] = [];
    (railTasks ?? []).forEach((t) =>
      items.push({ kind: "task", refId: t.id, label: t.title }),
    );
    (room?.items ?? [])
      .filter((i) => RAIL_KINDS.includes(i.kind))
      .forEach((i) =>
        items.push({ kind: i.kind as NodeKind, refId: i.ref_id, label: i.label }),
      );
    return items.filter((i) => !placed.has(i.refId));
  }, [railTasks, room?.items, placed]);

  const dropRef = useCallback(
    (kind: NodeKind, refId: string, label: string, clientX: number, clientY: number) => {
      const point = flow.screenToFlowPosition({ x: clientX, y: clientY });
      remember();
      addNode.mutate({
        kind,
        ref_id: refId,
        label,
        x: point.x,
        y: point.y,
        width: 200,
        height: 96,
      });
    },
    [flow, addNode, remember],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const raw = event.dataTransfer.getData(DRAG_MIME);
      if (raw) {
        try {
          const item = JSON.parse(raw) as { kind: NodeKind; refId: string; label: string };
          dropRef(item.kind, item.refId, item.label, event.clientX, event.clientY);
        } catch {
          setError("That item could not be read.");
        }
        return;
      }
      const file = Array.from(event.dataTransfer.files ?? [])[0];
      if (file?.type.startsWith("image/")) {
        addImage.mutate({
          file,
          at: flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
        });
      }
    },
    [editable, dropRef, addImage, flow],
  );

  /** Double-clicking a reference node opens the real thing it points at. */
  const openNode = useCallback(
    (nodeId: string) => {
      const node = (data?.nodes ?? []).find((n) => n.id === nodeId);
      if (!node?.ref_id) return;
      switch (node.kind) {
        case "website":
          window.open(node.ref_id, "_blank", "noopener,noreferrer");
          break;
        case "task":
          navigate(`${base}/space/tasks`);
          break;
        case "kb_doc":
          navigate("/documents");
          break;
        case "budget":
          navigate("/budgets");
          break;
        case "regulatory_doc":
          navigate("/regulatory");
          break;
        case "generated_file":
          navigate("/files");
          break;
        case "email_thread":
          navigate("/inbox");
          break;
        case "conversation":
          navigate(`/chat/${node.ref_id}`);
          break;
        case "project":
          navigate(`/projects/${node.ref_id}/space`);
          break;
        default:
          break;
      }
    },
    [data?.nodes, navigate, base],
  );

  // ── Dragging with snap ────────────────────────────────────────────────────
  const boxFor = useCallback(
    (n: Node): Box => ({
      id: n.id,
      x: n.position.x,
      y: n.position.y,
      width: n.width ?? (n.data as unknown as NodeData).node.width,
      height: n.height ?? (n.data as unknown as NodeData).node.height,
    }),
    [],
  );

  const onNodeDrag = useCallback(
    (_: unknown, node: Node) => {
      if (snapGrid) return; // the grid is doing the work
      const others = nodes.filter((n) => n.id !== node.id).map(boxFor);
      const snapped = snapToObjects(boxFor(node), others, SNAP_PX);
      setGuides(snapped.guides);
    },
    [snapGrid, nodes, boxFor],
  );

  const onNodeDragStart = useCallback(() => remember(), [remember]);

  const onNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      setGuides([]);
      let { x, y } = node.position;
      if (!snapGrid) {
        const others = nodes.filter((n) => n.id !== node.id).map(boxFor);
        const snapped = snapToObjects(boxFor(node), others, SNAP_PX);
        x = snapped.x;
        y = snapped.y;
        if (x !== node.position.x || y !== node.position.y) {
          setNodes((ns) =>
            ns.map((n) => (n.id === node.id ? { ...n, position: { x, y } } : n)),
          );
        }
      }
      queueSave(node.id, { x, y });
    },
    [snapGrid, nodes, boxFor, setNodes, queueSave],
  );

  // ── Keyboard ──────────────────────────────────────────────────────────────
  const SHORTCUT_TOOLS: Record<string, Tool> = useMemo(
    () => ({ v: "select", s: "sticky", t: "text", r: "shape", f: "frame", p: "pen", e: "eraser" }),
    [],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (!wrapper.current?.contains(target) && target !== document.body) return;

      const meta = event.ctrlKey || event.metaKey;
      if (meta && event.key.toLowerCase() === "z") {
        event.preventDefault();
        void (event.shiftKey ? redo() : undo());
        return;
      }
      if (meta && event.key.toLowerCase() === "y") {
        event.preventDefault();
        void redo();
        return;
      }
      if (!editable) return;
      if (meta && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicateNodes(
          (data?.nodes ?? []).filter((n) => selection.some((s) => s.id === n.id)),
        );
        return;
      }
      if (meta && event.key.toLowerCase() === "c") {
        copySelection();
        return;
      }
      if (meta && event.key.toLowerCase() === "v") {
        // An image on the clipboard is handled by the paste listener instead.
        if (clipboard.current.length) duplicateNodes(clipboard.current);
        return;
      }
      if (meta && event.key === "0") {
        event.preventDefault();
        flow.fitView({ padding: 0.2 });
        return;
      }
      if (!meta && SHORTCUT_TOOLS[event.key.toLowerCase()]) {
        setTool(SHORTCUT_TOOLS[event.key.toLowerCase()]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    editable,
    undo,
    redo,
    duplicateNodes,
    copySelection,
    selection,
    data?.nodes,
    flow,
    SHORTCUT_TOOLS,
  ]);

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  const tools: { id: Tool; icon: typeof StickyNote; label: string }[] = [
    { id: "select", icon: MousePointer2, label: "Select" },
    { id: "sticky", icon: StickyNote, label: "Sticky note" },
    { id: "text", icon: Type, label: "Text" },
    { id: "shape", icon: Square, label: "Shape" },
    { id: "frame", icon: Frame, label: "Frame" },
    { id: "pen", icon: PenLine, label: "Draw" },
    { id: "eraser", icon: Eraser, label: "Erase" },
  ];

  return (
    <div
      ref={wrapper}
      onDrop={onDrop}
      onDragOver={(e) => {
        if (editable) e.preventDefault();
      }}
      className="relative h-[70vh] w-full overflow-hidden rounded-lg border border-border bg-background"
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onPaneClick={onPaneClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onNodesDelete={(deleted) => {
          if (!editable) return;
          remember();
          deleted.forEach((n) => removeNode.mutate(n.id));
        }}
        onEdgesDelete={(deleted) => {
          if (!editable) return;
          remember();
          deleted.forEach((e) => removeEdgeMutation.mutate(e.id));
        }}
        onNodeClick={(_, node) => {
          if (tool === "eraser" && editable) {
            remember();
            removeNode.mutate(node.id);
          }
        }}
        onNodeDoubleClick={(_, node) => openNode(node.id)}
        nodesDraggable={editable && tool === "select"}
        nodesConnectable={editable}
        elementsSelectable
        snapToGrid={snapGrid}
        snapGrid={[GRID, GRID]}
        panOnDrag={tool === "select"}
        selectionOnDrag={false}
        fitView
        proOptions={{ hideAttribution: false }}
        defaultViewport={data?.viewport}
        className={cn(tool === "pen" && "cursor-crosshair", tool === "eraser" && "cursor-cell")}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        <Controls />
        <MiniMap pannable zoomable className="!bg-muted" />

        {editable ? (
          <Panel position="top-left" className="flex flex-wrap items-center gap-1 rounded-md border border-border bg-card/95 p-1 shadow-sm">
            {tools.map((t) => (
              <button
                key={t.id}
                type="button"
                title={t.label}
                onClick={() => setTool(t.id)}
                className={cn(
                  "rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground",
                  tool === t.id && "bg-primary/10 text-primary",
                )}
              >
                <t.icon className="h-4 w-4" />
              </button>
            ))}
            <div className="mx-1 h-5 w-px bg-border" />
            {STICKY_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                title="Colour"
                onClick={() => {
                  setColor(c);
                  setPenColor(c === "#e5e7eb" ? "#0f172a" : c);
                }}
                style={{ background: c }}
                className={cn(
                  "h-5 w-5 rounded-full border",
                  color === c ? "border-primary" : "border-border",
                )}
              />
            ))}
            <div className="mx-1 h-5 w-px bg-border" />
            <button
              type="button"
              title="Paste an image with Ctrl+V"
              className="rounded p-1.5 text-muted-foreground"
            >
              <ImageIcon className="h-4 w-4" />
            </button>
            <div className="mx-1 h-5 w-px bg-border" />
            <button
              type="button"
              title="Undo (Ctrl+Z)"
              disabled={depths.past === 0 || busy}
              onClick={() => void undo()}
              className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
            >
              <Undo2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              title="Redo (Ctrl+Shift+Z)"
              disabled={depths.future === 0 || busy}
              onClick={() => void redo()}
              className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
            >
              <Redo2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              title={snapGrid ? "Snapping to the grid" : "Snapping to nearby items"}
              onClick={() => setSnapGrid((s) => !s)}
              className={cn(
                "rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground",
                snapGrid && "bg-primary/10 text-primary",
              )}
            >
              <Grid3x3 className="h-4 w-4" />
            </button>
          </Panel>
        ) : (
          <Panel position="top-left" className="rounded-md border border-border bg-card/95 px-2 py-1 text-xs text-muted-foreground">
            Read-only
          </Panel>
        )}

        {stroke.length > 1 ? (
          <svg className="pointer-events-none absolute inset-0 h-full w-full">
            <g
              transform={`translate(${flow.getViewport().x} ${flow.getViewport().y}) scale(${flow.getViewport().zoom})`}
            >
              <path d={strokePath(stroke, 6)} fill={penColor} />
            </g>
          </svg>
        ) : null}

        {guides.length > 0 ? (
          <svg className="pointer-events-none absolute inset-0 h-full w-full">
            <g
              transform={`translate(${flow.getViewport().x} ${flow.getViewport().y}) scale(${flow.getViewport().zoom})`}
            >
              {guides.map((g) =>
                g.axis === "x" ? (
                  <line
                    key={`x-${g.at}`}
                    x1={g.at}
                    x2={g.at}
                    y1={-10000}
                    y2={10000}
                    stroke="#ec4899"
                    strokeWidth={1 / flow.getViewport().zoom}
                  />
                ) : (
                  <line
                    key={`y-${g.at}`}
                    x1={-10000}
                    x2={10000}
                    y1={g.at}
                    y2={g.at}
                    stroke="#ec4899"
                    strokeWidth={1 / flow.getViewport().zoom}
                  />
                ),
              )}
            </g>
          </svg>
        ) : null}

        {editable && selection.length > 1 ? (
          <Panel
            position="bottom-center"
            className="mb-2 flex items-center gap-1 rounded-md border border-border bg-card/95 p-1 shadow-sm"
          >
            <span className="px-1 text-xs text-muted-foreground">
              {selection.length} picked
            </span>
            {(
              [
                ["left", AlignStartVertical, "Align left"],
                ["center", AlignCenterVertical, "Align centres"],
                ["right", AlignEndVertical, "Align right"],
                ["top", AlignStartHorizontal, "Align top"],
                ["middle", AlignCenterHorizontal, "Align middles"],
                ["bottom", AlignEndHorizontal, "Align bottom"],
              ] as [AlignMode, typeof AlignStartVertical, string][]
            ).map(([mode, Icon, label]) => (
              <button
                key={mode}
                type="button"
                title={label}
                onClick={() => align(mode)}
                className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Icon className="h-4 w-4" />
              </button>
            ))}
            <div className="mx-1 h-5 w-px bg-border" />
            <button
              type="button"
              title="Even out the horizontal gaps"
              disabled={selection.length < 3}
              onClick={() => distribute("x")}
              className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
            >
              <AlignHorizontalDistributeCenter className="h-4 w-4" />
            </button>
            <button
              type="button"
              title="Even out the vertical gaps"
              disabled={selection.length < 3}
              onClick={() => distribute("y")}
              className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
            >
              <AlignVerticalDistributeCenter className="h-4 w-4" />
            </button>
            <div className="mx-1 h-5 w-px bg-border" />
            <button
              type="button"
              title="Bring to front"
              onClick={() => restack("front")}
              className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <BringToFront className="h-4 w-4" />
            </button>
            <button
              type="button"
              title="Send to back"
              onClick={() => restack("back")}
              className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <SendToBack className="h-4 w-4" />
            </button>
            <button
              type="button"
              title="Duplicate (Ctrl+D)"
              onClick={() =>
                duplicateNodes(
                  (data?.nodes ?? []).filter((n) =>
                    selection.some((s) => s.id === n.id),
                  ),
                )
              }
              className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Copy className="h-4 w-4" />
            </button>
          </Panel>
        ) : null}

        {editable && rail.length > 0 ? (
          <Panel
            position="top-right"
            className="max-h-[60%] w-56 overflow-y-auto rounded-md border border-border bg-card/95 p-2 shadow-sm"
          >
            <p className="mb-1.5 text-xs font-medium text-foreground">Material</p>
            <p className="mb-2 text-[11px] leading-snug text-muted-foreground">
              Drag onto the board, or click to drop it in the middle.
            </p>
            <ul className="space-y-1">
              {rail.map((item) => (
                <li key={`${item.kind}-${item.refId}`}>
                  <button
                    type="button"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DRAG_MIME, JSON.stringify(item));
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    onClick={() => {
                      const box = wrapper.current?.getBoundingClientRect();
                      dropRef(
                        item.kind,
                        item.refId,
                        item.label,
                        (box?.left ?? 0) + (box?.width ?? 0) / 2,
                        (box?.top ?? 0) + (box?.height ?? 0) / 2,
                      );
                    }}
                    className="w-full cursor-grab rounded border border-border bg-background px-2 py-1 text-left text-xs hover:bg-muted active:cursor-grabbing"
                  >
                    <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">
                      {item.kind.replace("_", " ")}
                    </span>
                    <span className="line-clamp-2 text-foreground">{item.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}
      </ReactFlow>

      {error ? (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          {error}
          <button
            type="button"
            onClick={() => setError(null)}
            className="ml-2 underline"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {editable && nodes.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="max-w-sm text-center text-sm text-muted-foreground">
            An empty canvas. Pick a tool above, then click to place a note, some
            text or a shape. Paste an image straight in. Drag between two things
            to link them.
          </p>
        </div>
      ) : null}
    </div>
  );
}

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

export function CanvasTab(props: Props) {
  return (
    <ReactFlowProvider>
      <Board {...props} />
    </ReactFlowProvider>
  );
}
