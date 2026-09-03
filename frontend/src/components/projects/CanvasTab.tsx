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
  Eraser,
  Frame,
  Image as ImageIcon,
  Loader2,
  MousePointer2,
  PenLine,
  Square,
  StickyNote,
  Type,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Source } from "@/api/tasks";
import {
  createEdge,
  createNode,
  deleteEdge,
  deleteNode,
  getDefaultCanvas,
  resolveNodes,
  saveNodes,
} from "@/api/canvas";
import type {
  CanvasFull,
  CanvasNode as ApiNode,
  InkStroke,
  NodeKind,
  ResolvedRef,
} from "@/types/canvas";

const SAVE_DEBOUNCE_MS = 700;

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
  const { node, canEdit } = data as unknown as NodeData;
  return (
    <>
      <NodeResizer isVisible={Boolean(selected) && canEdit} minWidth={60} minHeight={60} />
      {handles()}
      <img
        src={node.content}
        alt={node.label || "Image"}
        draggable={false}
        className="h-full w-full rounded-sm object-contain"
      />
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
        draggable: canEdit && n.kind !== "ink",
        selectable: true,
        parentId: n.parent_node_id ?? undefined,
        data: { node: n, resolved: resolvedByNode.get(n.id), canEdit },
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
  }, [data, resolvedByNode, canEdit, setNodes, setEdges]);

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

  const onConnect: OnConnect = useCallback(
    (connection) => {
      if (!editable || !connection.source || !connection.target) return;
      setEdges((eds) => addEdge(connection, eds));
      addEdgeMutation.mutate(connection);
    },
    [editable, setEdges, addEdgeMutation],
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
    [flow, tool, color, addNode],
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
    addNode.mutate({
      kind: "ink",
      x: b.minX,
      y: b.minY,
      width: Math.max(b.maxX - b.minX, 1),
      height: Math.max(b.maxY - b.minY, 1),
      style: { points: local, color: penColor, size: 6 },
    });
  }, [stroke, penColor, addNode]);

  // ── Images ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!editable) return;
    const onPaste = (event: ClipboardEvent) => {
      const file = Array.from(event.clipboardData?.files ?? [])[0];
      if (!file || !file.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = () => {
        const center = flow.screenToFlowPosition({
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        });
        addNode.mutate({
          kind: "image",
          x: center.x,
          y: center.y,
          width: 280,
          height: 200,
          content: String(reader.result),
          label: file.name,
        });
      };
      reader.readAsDataURL(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [editable, flow, addNode]);

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
        onNodeDragStop={(_, node) =>
          queueSave(node.id, { x: node.position.x, y: node.position.y })
        }
        onNodesDelete={(deleted) => {
          if (!editable) return;
          deleted.forEach((n) => removeNode.mutate(n.id));
        }}
        onEdgesDelete={(deleted) => {
          if (!editable) return;
          deleted.forEach((e) => removeEdgeMutation.mutate(e.id));
        }}
        onNodeClick={(_, node) => {
          if (tool === "eraser" && editable) removeNode.mutate(node.id);
        }}
        onNodeDoubleClick={(_, node) => {
          const ref = resolvedByNode.get(node.id);
          if (ref?.kind === "website" && ref.ref_id) window.open(ref.ref_id, "_blank");
        }}
        nodesDraggable={editable && tool === "select"}
        nodesConnectable={editable}
        elementsSelectable
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
