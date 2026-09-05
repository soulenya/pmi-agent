/**
 * CanvasTab — the project's infinite whiteboard.
 *
 * Free-form nodes carry their own content; reference nodes point at something
 * that already exists in the app and are resolved in one batch, never one
 * request per node. Ink is decorative: stored and drawn, never indexed.
 *
 * Geometry is the server's. Every local change is queued into a debounced
 * batch, and a refetch that lands while a change is still in flight is merged
 * over rather than allowed to undo it.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useStore,
  type Connection,
  type Edge,
  type Node,
  type OnConnect,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  Eraser,
  Frame,
  Grid3x3,
  Image as ImageIcon,
  Loader2,
  MousePointer2,
  PenLine,
  Redo2,
  Square,
  StickyNote,
  Type,
  Undo2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Source } from "@/api/tasks";
import { getProjectSpace, listTasks, updateTask } from "@/api/tasks";
import type { TaskStatus } from "@/types/tasks";
import { listProjectBudgets } from "@/api/budgets";
import { getWorkroom, type WorkroomItemKind } from "@/api/workrooms";
import { useCanvasSinkStore, type TextDropKind } from "@/stores/canvasSinkStore";
import {
  createEdge,
  createNode,
  deleteEdge,
  deleteNode,
  getDefaultCanvas,
  resolveNodes,
  saveNodes,
  uploadCanvasImage,
} from "@/api/canvas";
import type {
  CanvasEdge as ApiEdge,
  CanvasFull,
  CanvasNode as ApiNode,
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
import {
  BoardContext,
  DRAG_MIME,
  type BoardApi,
  type NodeData,
  type RailItem,
  type ResizeBox,
} from "./canvas/board";
import { CanvasMenu, type MenuItem } from "./canvas/ContextMenu";
import { CanvasInspector } from "./canvas/Inspector";
import { inkBounds, strokePath, type InkPoint } from "./canvas/ink";
import { NODE_TYPES, isHollow, typeFor } from "./canvas/nodes";
import {
  STICKY_COLORS,
  autoHeight,
  cleanStyle,
  styleOf,
  type StylePatch,
} from "./canvas/style";

const SAVE_DEBOUNCE_MS = 700;

/** How close a dragged node has to come before it snaps to a neighbour. */
const SNAP_PX = 6;
const GRID = 8;
const UNDO_DEPTH = 40;
/** Zoom out past this and a task's sub-task cards fold into it. */
const FOLD_ZOOM = 0.5;
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

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

/** Kinds that hold their own words. */
const TEXT_KINDS = ["sticky", "text", "shape", "frame"];

/** Sizes for text arriving from outside the board — pasted, or from the chat. */
const TEXT_DROP_SIZES: Record<TextDropKind, { w: number; h: number }> = {
  sticky: { w: 180, h: 140 },
  text: { w: 260, h: 40 },
  shape: { w: 200, h: 140 },
};

type Tool = "select" | "sticky" | "text" | "shape" | "frame" | "pen" | "eraser";

/** Hollow kinds let the pointer through; a faded node says so on the wrapper. */
function wrapperStyle(node: ApiNode): CSSProperties | undefined {
  const style: CSSProperties = {};
  if (isHollow(node)) style.pointerEvents = "none";
  const opacity = styleOf(node).opacity;
  if (opacity !== undefined && opacity < 1) style.opacity = opacity;
  return Object.keys(style).length > 0 ? style : undefined;
}

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
  const [notice, setNotice] = useState<string | null>(null);
  const [stroke, setStroke] = useState<InkPoint[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; nodeId: string | null } | null>(
    null,
  );
  const [railFilter, setRailFilter] = useState("");
  const [showPlaced, setShowPlaced] = useState(false);
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

  // ── Saving ────────────────────────────────────────────────────────────────
  // `pending` is waiting for the debounce; `inFlight` is out on the wire. Both
  // are merged over whatever the server sends back, so a refetch cannot roll a
  // change back under the user's hands.
  const pending = useRef<Map<string, Record<string, unknown>>>(new Map());
  const inFlight = useRef<Map<string, Record<string, unknown>>>(new Map());
  const timer = useRef<number | null>(null);

  const unsavedFor = useCallback(
    (id: string) => ({
      ...(inFlight.current.get(id) ?? {}),
      ...(pending.current.get(id) ?? {}),
    }),
    [],
  );

  const flushSave = useCallback(async () => {
    if (!canvasId || pending.current.size === 0) return;
    const batch = Array.from(pending.current.entries()).map(([id, patch]) => ({
      id,
      ...patch,
    }));
    inFlight.current = new Map(pending.current);
    pending.current.clear();
    try {
      await saveNodes(projectId, canvasId, batch as never, source);
      inFlight.current.clear();
      await queryClient.invalidateQueries({ queryKey: key });
    } catch {
      inFlight.current.clear();
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

  /** Show a change straight away, and save it. */
  const edit = useCallback(
    (id: string, patch: Record<string, unknown>) => {
      if (!editable) return;
      setNodes((ns) =>
        ns.map((n) => {
          if (n.id !== id) return n;
          const held = n.data as unknown as NodeData;
          const merged = { ...held.node, ...patch } as ApiNode;
          const next: Node = { ...n, data: { ...held, node: merged } };
          if ("width" in patch) next.width = merged.width;
          if ("height" in patch) next.height = merged.height;
          if ("x" in patch || "y" in patch) {
            next.position = { x: merged.x, y: merged.y };
          }
          if ("z" in patch) next.zIndex = merged.z;
          if ("style" in patch) next.style = wrapperStyle(merged);
          return next;
        }),
      );
      queueSave(id, patch);
    },
    [editable, setNodes, queueSave],
  );

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
      void flushSave();
    };
  }, [flushSave]);

  // ── The board ─────────────────────────────────────────────────────────────
  // Rebuild whenever the server's copy changes, keeping anything unsaved.
  useEffect(() => {
    if (!data) return;
    setNodes(
      data.nodes.map((raw) => {
        const n = { ...raw, ...unsavedFor(raw.id) } as ApiNode;
        const built: Node = {
          id: n.id,
          type: typeFor(n.kind),
          position: { x: n.x, y: n.y },
          width: n.width,
          height: n.height,
          zIndex: n.z,
          style: wrapperStyle(n),
          draggable: canEdit && n.kind !== "ink",
          selectable: true,
          parentId: n.parent_node_id ?? undefined,
          data: {
            node: n,
            resolved: resolvedByNode.get(n.id),
            canEdit,
            ctx: { projectId, canvasId: data.id, source },
          } as unknown as Record<string, unknown>,
        };
        return built;
      }),
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
  }, [
    data,
    resolvedByNode,
    canEdit,
    setNodes,
    setEdges,
    projectId,
    source,
    unsavedFor,
  ]);

  /** The highest z handed out so far, so new things land on top. */
  const zCeil = useRef(0);
  useEffect(() => {
    if (!data) return;
    zCeil.current = Math.max(zCeil.current, 0, ...data.nodes.map((n) => n.z));
  }, [data]);
  const nextZ = useCallback(() => {
    zCeil.current += 1;
    return zCeil.current;
  }, []);

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
    onSuccess: (_created, c) => {
      queryClient.invalidateQueries({ queryKey: key });
      queryClient.invalidateQueries({ queryKey: ["project-timeline", source, projectId] });
      // A line between two task cards is not decoration: the backend turns it
      // into a real dependency, and the timeline redraws. Say so.
      const nodes = data?.nodes ?? [];
      const from = nodes.find((n) => n.id === c.source);
      const to = nodes.find((n) => n.id === c.target);
      if (from?.kind === "task" && to?.kind === "task") {
        setNotice("The timeline now waits for the first task before the second.");
      }
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
        const held = (l.data as unknown as NodeData).node;
        return {
          ...n,
          x: l.position.x,
          y: l.position.y,
          width: l.width ?? n.width,
          height: l.height ?? n.height,
          z: l.zIndex ?? n.z,
          content: held.content,
          style: held.style,
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

  // ── What is picked ────────────────────────────────────────────────────────
  const selection = useMemo(() => nodes.filter((n) => n.selected), [nodes]);
  const picked = useMemo(
    () => selection.map((n) => (n.data as unknown as NodeData).node),
    [selection],
  );

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

  const boxes = useMemo<Box[]>(() => selection.map(boxFor), [selection, boxFor]);

  const applyMoves = useCallback(
    (moves: Map<string, { x?: number; y?: number }>) => {
      if (!editable || moves.size === 0) return;
      remember();
      moves.forEach((move, id) => edit(id, { ...move }));
    },
    [editable, remember, edit],
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
      const bottom = Math.min(0, ...(data?.nodes ?? []).map((n) => n.z));
      selection.forEach((n, i) => {
        edit(n.id, { z: direction === "front" ? nextZ() : bottom - 1 - i });
      });
    },
    [editable, selection, remember, data?.nodes, edit, nextZ],
  );

  const applyStyle = useCallback(
    (patch: StylePatch) => {
      if (!editable || selection.length === 0) return;
      remember();
      selection.forEach((n) => {
        const held = (n.data as unknown as NodeData).node;
        edit(n.id, { style: cleanStyle({ ...styleOf(held), ...patch }) });
      });
    },
    [editable, selection, remember, edit],
  );

  /** Draw a hollow shape around what is picked, sitting behind it. */
  const wrapInShape = useCallback(() => {
    if (!editable || boxes.length === 0) return;
    const pad = 24;
    const x = Math.min(...boxes.map((b) => b.x)) - pad;
    const y = Math.min(...boxes.map((b) => b.y)) - pad;
    const right = Math.max(...boxes.map((b) => b.x + b.width)) + pad;
    const bottom = Math.max(...boxes.map((b) => b.y + b.height)) + pad;
    const under = Math.min(0, ...selection.map((n) => n.zIndex ?? 0)) - 1;
    remember();
    addNode.mutate({
      kind: "shape",
      x,
      y,
      width: right - x,
      height: bottom - y,
      z: under,
      style: { color, shape: "rounded", fill: "none" },
    });
  }, [editable, boxes, selection, remember, addNode, color]);

  /** Copy the picked nodes to a private clipboard; the OS one holds text. */
  const clipboard = useRef<ApiNode[]>([]);

  const copySelection = useCallback(() => {
    if (picked.length) clipboard.current = picked;
  }, [picked]);

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
          z: nextZ(),
          style: n.style,
        });
      });
    },
    [editable, remember, addNode, nextZ],
  );

  const deleteSelection = useCallback(() => {
    if (!editable || selection.length === 0) return;
    remember();
    selection.forEach((n) => removeNode.mutate(n.id));
  }, [editable, selection, remember, removeNode]);

  // ── What the node renderers may do ────────────────────────────────────────
  const endResize = useCallback(
    (node: ApiNode, box: ResizeBox) => {
      const patch: Record<string, unknown> = {
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height),
      };
      // A height dragged on purpose is a height the text must not overrule.
      if (autoHeight(styleOf(node)) && Math.abs(box.height - node.height) > 1) {
        patch.style = cleanStyle({ ...styleOf(node), autoHeight: false });
      }
      edit(node.id, patch);
    },
    [edit],
  );

  const setTaskStatus = useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: string }) =>
      updateTask(taskId, { status: status as TaskStatus }, source),
    onSuccess: () => {
      // The card reads through resolve, and the tasks tab and timeline read the
      // row directly. All three are looking at the same task.
      queryClient.invalidateQueries({ queryKey: ["project-canvas-refs", source] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["project-timeline", source, projectId] });
      queryClient.invalidateQueries({ queryKey: ["project-space", source, projectId] });
    },
    onError: () => setError("That task's status could not be changed."),
  });

  // ── Folding a task family when you zoom out ───────────────────────────────
  const zoom = useStore((s) => s.transform[2]);
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const folding = zoom < FOLD_ZOOM;

  // Zooming back in is the other way to open everything.
  useEffect(() => {
    if (!folding) setOpened(new Set());
  }, [folding]);

  /** Task cards whose task sits under another task card on this same board. */
  const kids = useMemo(() => {
    const cardFor = new Map<string, string>();
    for (const n of nodes) {
      const held = n.data as unknown as NodeData;
      if (held?.node?.kind === "task" && held.node.ref_id) {
        cardFor.set(held.node.ref_id, n.id);
      }
    }
    const out = new Map<string, string[]>();
    for (const n of nodes) {
      const above = (n.data as unknown as NodeData)?.resolved?.parent_ref_id;
      const owner = above ? cardFor.get(above) : undefined;
      if (owner && owner !== n.id) out.set(owner, [...(out.get(owner) ?? []), n.id]);
    }
    return out;
  }, [nodes]);

  /** What is folded away right now, and how many sit under each open card. */
  const folded = useMemo(() => {
    const away = new Set<string>();
    const count = new Map<string, number>();
    if (!folding || kids.size === 0) return { away, count };
    const gather = (id: string, into: Set<string>) => {
      for (const kid of kids.get(id) ?? []) {
        if (into.has(kid)) continue; // a cycle would otherwise never end
        into.add(kid);
        gather(kid, into);
      }
    };
    for (const parent of kids.keys()) {
      if (opened.has(parent)) continue;
      const mine = new Set<string>();
      gather(parent, mine);
      if (mine.size === 0) continue;
      count.set(parent, mine.size);
      for (const id of mine) away.add(id);
    }
    // A card that is itself folded away carries no count of its own.
    for (const id of away) count.delete(id);
    return { away, count };
  }, [folding, kids, opened]);

  const shownNodes = useMemo(() => {
    if (folded.away.size === 0 && folded.count.size === 0) return nodes;
    return nodes.map((n) => {
      const hide = folded.away.has(n.id);
      const under = folded.count.get(n.id) ?? 0;
      if (!hide && under === 0) return n;
      const held = n.data as unknown as NodeData;
      return {
        ...n,
        hidden: hide,
        data: { ...held, folded: under } as unknown as Record<string, unknown>,
      };
    });
  }, [nodes, folded]);

  const shownEdges = useMemo(() => {
    if (folded.away.size === 0) return edges;
    return edges.map((e) =>
      folded.away.has(e.source) || folded.away.has(e.target) ? { ...e, hidden: true } : e,
    );
  }, [edges, folded]);

  const board = useMemo<BoardApi>(
    () => ({
      editable,
      editingId,
      setEditingId,
      remember,
      saveContent: (id, content) => {
        remember();
        edit(id, { content });
      },
      grow: (id, height) => edit(id, { height: Math.round(height) }),
      endResize,
      setTaskStatus: (taskId, status) => setTaskStatus.mutate({ taskId, status }),
      toggleFolded: (nodeId) =>
        setOpened((open) => {
          const next = new Set(open);
          if (!next.delete(nodeId)) next.add(nodeId);
          return next;
        }),
    }),
    [editable, editingId, remember, edit, endResize, setTaskStatus],
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
        z: nextZ(),
        style: tool === "sticky" || tool === "shape" ? { color } : {},
        label: tool === "frame" ? "Frame" : "",
      });
      setTool("select");
    },
    [flow, tool, color, addNode, remember, nextZ],
  );

  const onPaneClick = useCallback(
    (event: React.MouseEvent) => {
      setMenu(null);
      setEditingId(null);
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
    const local = points.map(([x, y, p]) => [x - b.minX, y - b.minY, p] as InkPoint);
    // Ink commits on pen-up, never per sample.
    remember();
    addNode.mutate({
      kind: "ink",
      x: b.minX,
      y: b.minY,
      width: Math.max(b.maxX - b.minX, 1),
      height: Math.max(b.maxY - b.minY, 1),
      z: nextZ(),
      style: { points: local, color: penColor, size: 6 },
    });
  }, [stroke, penColor, addNode, remember, nextZ]);

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
    onSuccess: (made) => {
      queueSave(made.id, { z: nextZ() });
      queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response
        ?.data?.detail;
      setError(detail ?? "That image could not be added.");
    },
  });

  /** Put a block of text on the board, centred in the view. */
  const dropText = useCallback(
    (text: string, kind: TextDropKind = "text") => {
      const trimmed = text.trim();
      if (!editable || !trimmed) return;
      const box = wrapper.current?.getBoundingClientRect();
      const at = flow.screenToFlowPosition({
        x: (box?.left ?? 0) + (box?.width ?? 0) / 2,
        y: (box?.top ?? 0) + (box?.height ?? 0) / 2,
      });
      const size = TEXT_DROP_SIZES[kind];
      remember();
      addNode.mutate({
        kind,
        x: at.x - size.w / 2,
        y: at.y - size.h / 2,
        width: size.w,
        height: size.h,
        z: nextZ(),
        style: kind === "text" ? {} : { color },
        content: trimmed.slice(0, 8000),
      });
      setNotice("Added to the board.");
    },
    [editable, flow, remember, addNode, nextZ, color],
  );

  // The chat panel floats over the app and drops text here.
  const setCanvasSink = useCanvasSinkStore((s) => s.setDropText);
  useEffect(() => {
    if (!editable) return;
    setCanvasSink(dropText);
    return () => setCanvasSink(null);
  }, [editable, dropText, setCanvasSink]);

  useEffect(() => {
    if (!editable) return;
    const onPaste = (event: ClipboardEvent) => {
      if (
        !wrapper.current?.contains(document.activeElement) &&
        document.activeElement !== document.body
      ) {
        return;
      }
      const file = Array.from(event.clipboardData?.files ?? [])[0];
      if (file && file.type.startsWith("image/")) {
        event.preventDefault();
        const box = wrapper.current?.getBoundingClientRect();
        const at = flow.screenToFlowPosition({
          x: (box?.left ?? 0) + (box?.width ?? 0) / 2,
          y: (box?.top ?? 0) + (box?.height ?? 0) / 2,
        });
        addImage.mutate({ file, at });
        return;
      }
      // Nodes copied on this board take Ctrl+V; text only lands when they have
      // been superseded by a copy made somewhere else.
      if (clipboard.current.length) return;
      const text = event.clipboardData?.getData("text/plain");
      if (!text?.trim()) return;
      event.preventDefault();
      dropText(text);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [editable, flow, addImage, dropText]);

  /**
   * A copy made outside the board makes the board's own clipboard stale — the
   * system clipboard now holds that text, and Ctrl+V should produce it.
   */
  useEffect(() => {
    const onCopy = () => {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && !wrapper.current?.contains(sel.anchorNode)) {
        clipboard.current = [];
      }
    };
    window.addEventListener("copy", onCopy);
    window.addEventListener("cut", onCopy);
    return () => {
      window.removeEventListener("copy", onCopy);
      window.removeEventListener("cut", onCopy);
    };
  }, []);

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
  const { data: railBudgets } = useQuery({
    queryKey: ["project-budgets", source, projectId],
    queryFn: () => listProjectBudgets(projectId, source),
  });
  const { data: room } = useQuery({
    queryKey: ["workroom", source, workroomId],
    queryFn: () => getWorkroom(workroomId!, source),
    enabled: Boolean(workroomId),
  });

  const placed = useMemo(
    () => new Set((data?.nodes ?? []).map((n) => n.ref_id).filter(Boolean) as string[]),
    [data?.nodes],
  );

  const pool = useMemo(() => {
    const items: RailItem[] = [];
    (railTasks ?? []).forEach((t) =>
      items.push({ kind: "task", refId: t.id, label: t.title }),
    );
    (railBudgets ?? []).forEach((b) =>
      items.push({ kind: "budget", refId: b.id, label: b.title }),
    );
    (room?.items ?? [])
      .filter((i) => RAIL_KINDS.includes(i.kind))
      .forEach((i) =>
        items.push({ kind: i.kind as NodeKind, refId: i.ref_id, label: i.label }),
      );
    // The same thing can be pinned and be a task; show it once.
    const seen = new Set<string>();
    return items.filter((i) => {
      const key = `${i.kind}:${i.refId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [railTasks, railBudgets, room?.items]);

  const railGroups = useMemo(() => {
    const needle = railFilter.trim().toLowerCase();
    const visible = pool.filter(
      (i) =>
        (showPlaced || !placed.has(i.refId)) &&
        (!needle || i.label.toLowerCase().includes(needle)),
    );
    const byKind = new Map<NodeKind, RailItem[]>();
    visible.forEach((i) => {
      const bucket = byKind.get(i.kind);
      if (bucket) bucket.push(i);
      else byKind.set(i.kind, [i]);
    });
    return [...byKind.entries()].map(([kind, items]) => ({ kind, items }));
  }, [pool, placed, railFilter, showPlaced]);

  const hiddenBecausePlaced = useMemo(
    () => (showPlaced ? 0 : pool.filter((i) => placed.has(i.refId)).length),
    [pool, placed, showPlaced],
  );

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
        z: nextZ(),
      });
    },
    [flow, addNode, remember, nextZ],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      if (!editable) return;
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
  const onNodeDrag = useCallback(
    (_: unknown, node: Node, dragged: Node[]) => {
      if (snapGrid) return; // the grid is doing the work
      const moving = new Set((dragged?.length ? dragged : [node]).map((n) => n.id));
      const others = nodes
        .filter((n) => !moving.has(n.id) && !folded.away.has(n.id))
        .map(boxFor);
      const snapped = snapToObjects(boxFor(node), others, SNAP_PX);
      setGuides(snapped.guides);
    },
    [snapGrid, nodes, boxFor, folded],
  );

  const onNodeDragStart = useCallback(() => remember(), [remember]);

  /** Save every node that moved, not just the one under the pointer. */
  const settle = useCallback(
    (node: Node, dragged: Node[]) => {
      setGuides([]);
      const moved = dragged?.length ? dragged : [node];
      let dx = 0;
      let dy = 0;
      if (!snapGrid) {
        const moving = new Set(moved.map((n) => n.id));
        const others = nodes
          .filter((n) => !moving.has(n.id) && !folded.away.has(n.id))
          .map(boxFor);
        const snapped = snapToObjects(boxFor(node), others, SNAP_PX);
        // The snap nudges the whole group, so it keeps its shape.
        dx = snapped.x - node.position.x;
        dy = snapped.y - node.position.y;
      }
      for (const n of moved) {
        edit(n.id, { x: n.position.x + dx, y: n.position.y + dy });
      }
    },
    [snapGrid, nodes, boxFor, edit, folded],
  );

  const onNodeDragStop = useCallback(
    (_: unknown, node: Node, dragged: Node[]) => settle(node, dragged),
    [settle],
  );

  const onSelectionDragStop = useCallback(
    (_: unknown, dragged: Node[]) => {
      if (dragged.length) settle(dragged[0], dragged);
    },
    [settle],
  );

  /** Alt-click digs down through whatever is stacked under the pointer. */
  const cycleUnder = useCallback(
    (clientX: number, clientY: number) => {
      const point = flow.screenToFlowPosition({ x: clientX, y: clientY });
      const under = nodes
        .filter((n) => {
          const b = boxFor(n);
          return (
            point.x >= b.x &&
            point.x <= b.x + b.width &&
            point.y >= b.y &&
            point.y <= b.y + b.height
          );
        })
        .sort((a, b) => (b.zIndex ?? 0) - (a.zIndex ?? 0));
      if (under.length < 2) return;
      const at = under.findIndex((n) => n.selected);
      const next = under[(at + 1) % under.length];
      setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === next.id })));
    },
    [flow, nodes, boxFor, setNodes],
  );

  // ── Keyboard ──────────────────────────────────────────────────────────────
  const SHORTCUT_TOOLS: Record<string, Tool> = useMemo(
    () => ({
      v: "select",
      s: "sticky",
      t: "text",
      r: "shape",
      f: "frame",
      p: "pen",
      e: "eraser",
    }),
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
      const key = event.key.toLowerCase();
      // Text highlighted anywhere else — the chat panel, a page behind it —
      // owns the clipboard keys. The board only takes them when nothing else
      // is selected.
      if (meta && (key === "c" || key === "v" || key === "x")) {
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed && !wrapper.current?.contains(sel.anchorNode)) {
          return;
        }
      }
      if (meta && key === "z") {
        event.preventDefault();
        void (event.shiftKey ? redo() : undo());
        return;
      }
      if (meta && key === "y") {
        event.preventDefault();
        void redo();
        return;
      }
      if (event.key === "Escape") {
        setEditingId(null);
        setMenu(null);
        return;
      }
      if (!editable) return;
      if (meta && event.key === "]") {
        event.preventDefault();
        restack("front");
        return;
      }
      if (meta && event.key === "[") {
        event.preventDefault();
        restack("back");
        return;
      }
      if (event.key === "Enter" && picked.length === 1) {
        if (TEXT_KINDS.includes(picked[0].kind)) {
          event.preventDefault();
          setEditingId(picked[0].id);
        }
        return;
      }
      if (meta && key === "d") {
        event.preventDefault();
        duplicateNodes(picked);
        return;
      }
      if (meta && key === "c") {
        copySelection();
        return;
      }
      if (meta && key === "v") {
        // Text and images on the clipboard are handled by the paste listener.
        if (clipboard.current.length) duplicateNodes(clipboard.current);
        return;
      }
      if (meta && event.key === "0") {
        event.preventDefault();
        flow.fitView({ padding: 0.2 });
        return;
      }
      if (!meta && SHORTCUT_TOOLS[key]) {
        setTool(SHORTCUT_TOOLS[key]);
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
    picked,
    restack,
    flow,
    SHORTCUT_TOOLS,
  ]);

  // ── The right-click menu ──────────────────────────────────────────────────
  const openMenu = useCallback(
    (clientX: number, clientY: number, nodeId: string | null) => {
      const box = wrapper.current?.getBoundingClientRect();
      setMenu({ x: clientX - (box?.left ?? 0), y: clientY - (box?.top ?? 0), nodeId });
    },
    [],
  );

  const menuItems = useMemo<MenuItem[]>(() => {
    if (!menu || !editable) return [];
    if (!menu.nodeId) {
      return [
        {
          label: "Fit the board",
          hint: "Ctrl+0",
          onClick: () => flow.fitView({ padding: 0.2 }),
        },
        { label: "Snap to the grid", onClick: () => setSnapGrid((s) => !s) },
      ];
    }
    const only = picked.find((n) => n.id === menu.nodeId) ?? picked[0];
    const items: MenuItem[] = [];
    if (only && TEXT_KINDS.includes(only.kind)) {
      items.push({
        label: "Edit the text",
        hint: "Enter",
        onClick: () => setEditingId(only.id),
      });
    }
    if (only?.ref_id) {
      items.push({ label: "Open it", onClick: () => openNode(only.id) });
    }
    items.push(
      { label: "Draw a shape around", onClick: wrapInShape },
      { label: "Duplicate", hint: "Ctrl+D", onClick: () => duplicateNodes(picked) },
      { label: "Bring to front", hint: "Ctrl+]", onClick: () => restack("front") },
      { label: "Send to back", hint: "Ctrl+[", onClick: () => restack("back") },
      { label: "Delete", onClick: deleteSelection, danger: true },
    );
    return items;
  }, [
    menu,
    editable,
    picked,
    flow,
    wrapInShape,
    duplicateNodes,
    restack,
    deleteSelection,
    openNode,
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
    <BoardContext.Provider value={board}>
      <div
        ref={wrapper}
        onDrop={onDrop}
        onDragOver={(e) => {
          if (editable) e.preventDefault();
        }}
        className="relative h-[70vh] w-full overflow-hidden rounded-lg border border-border bg-background"
      >
        <ReactFlow
          nodes={shownNodes}
          edges={shownEdges}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onPaneClick={onPaneClick}
          onPaneContextMenu={(event) => {
            event.preventDefault();
            const e = event as React.MouseEvent;
            openMenu(e.clientX, e.clientY, null);
          }}
          onNodeContextMenu={(event, node) => {
            event.preventDefault();
            if (!node.selected) {
              setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === node.id })));
            }
            openMenu(event.clientX, event.clientY, node.id);
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onNodeDragStart={onNodeDragStart}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          onSelectionDragStart={onNodeDragStart}
          onSelectionDragStop={onSelectionDragStop}
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
          onNodeClick={(event, node) => {
            setMenu(null);
            if (event.altKey) {
              cycleUnder(event.clientX, event.clientY);
              return;
            }
            if (editingId && editingId !== node.id) setEditingId(null);
            if (tool === "eraser" && editable) {
              remember();
              removeNode.mutate(node.id);
            }
          }}
          onNodeDoubleClick={(_, node) => {
            const kind = (node.data as unknown as NodeData).node.kind;
            if (editable && (kind === "shape" || kind === "frame")) {
              setEditingId(node.id);
              return;
            }
            openNode(node.id);
          }}
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
          className={cn(
            tool === "pen" && "cursor-crosshair",
            tool === "eraser" && "cursor-cell",
          )}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
          <Controls />
          <MiniMap pannable zoomable className="!bg-muted" />

          <Panel position="top-left" className="flex flex-col items-start gap-2">
            {editable ? (
              <div className="flex flex-wrap items-center gap-1 rounded-md border border-border bg-card/95 p-1 shadow-sm">
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
                    title="Colour for the next thing you place"
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
              </div>
            ) : (
              <div className="rounded-md border border-border bg-card/95 px-2 py-1 text-xs text-muted-foreground">
                Read-only
              </div>
            )}

            {editable ? (
              <CanvasInspector
                selected={picked}
                onStyle={applyStyle}
                onWrap={wrapInShape}
                onEditText={() => picked[0] && setEditingId(picked[0].id)}
                onRestack={restack}
                onDuplicate={() => duplicateNodes(picked)}
                onDelete={deleteSelection}
              />
            ) : null}
          </Panel>

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
            </Panel>
          ) : null}

          {editable && pool.length > 0 ? (
            <Panel
              position="top-right"
              className="flex max-h-[70%] w-60 flex-col rounded-md border border-border bg-card/95 p-2 shadow-sm"
            >
              <p className="text-xs font-medium text-foreground">The pool</p>
              <p className="mb-2 text-[11px] leading-snug text-muted-foreground">
                Everything this project holds. Drag onto the board, or click to
                drop it in the middle.
              </p>
              <input
                value={railFilter}
                placeholder="Filter"
                onChange={(e) => setRailFilter(e.target.value)}
                className="mb-2 w-full rounded border border-border bg-background px-2 py-1 text-xs"
              />
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
                {railGroups.map((group) => (
                  <div key={group.kind}>
                    <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {group.kind.replace("_", " ")} · {group.items.length}
                    </p>
                    <ul className="space-y-1">
                      {group.items.map((item) => (
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
                            className={cn(
                              "w-full cursor-grab rounded border border-border bg-background px-2 py-1 text-left text-xs hover:bg-muted active:cursor-grabbing",
                              placed.has(item.refId) && "opacity-60",
                            )}
                          >
                            <span className="line-clamp-2 text-foreground">{item.label}</span>
                            {placed.has(item.refId) && (
                              <span className="text-[10px] text-muted-foreground">
                                already on the board
                              </span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                {railGroups.length === 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    Nothing left to place.
                  </p>
                )}
              </div>
              <label className="mt-2 flex items-center gap-1.5 border-t border-border pt-2 text-[11px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={showPlaced}
                  onChange={(e) => setShowPlaced(e.target.checked)}
                />
                Show what is already placed
                {hiddenBecausePlaced > 0 && ` (${hiddenBecausePlaced})`}
              </label>
            </Panel>
          ) : null}
        </ReactFlow>

        {menu ? (
          <CanvasMenu
            x={menu.x}
            y={menu.y}
            items={menuItems}
            onClose={() => setMenu(null)}
          />
        ) : null}

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

        {notice && !error ? (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-md border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
            {notice}
            <button
              type="button"
              onClick={() => setNotice(null)}
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
    </BoardContext.Provider>
  );
}

export function CanvasTab(props: Props) {
  return (
    <ReactFlowProvider>
      <Board {...props} />
    </ReactFlowProvider>
  );
}
