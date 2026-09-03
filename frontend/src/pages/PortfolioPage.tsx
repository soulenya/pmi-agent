/**
 * The portfolio — every project you can see, and how they relate.
 *
 * Read-only on purpose: links are made inside a project, where the person
 * making one has the rights and the context. This is the view from above.
 *
 * A project you may not see is absent, not greyed out. A link pointing into
 * one is drawn dangling: the relationship is not a secret, the name is.
 */
import { useCallback, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AlertTriangle, Loader2, Network, ShieldAlert } from "lucide-react";

import { getPortfolio } from "@/api/projectLinks";
import type { PortfolioEdge, PortfolioNode, ProjectLinkKind } from "@/types/tasks";
import { cn } from "@/lib/utils";

const COL_WIDTH = 300;
const ROW_HEIGHT = 190;
const PER_ROW = 4;

const EDGE_LABELS: Record<ProjectLinkKind, string> = {
  depends_on: "waits for",
  gates: "gates",
  parallel: "alongside",
  subproject_of: "part of",
};

const EDGE_COLOURS: Record<ProjectLinkKind, string> = {
  depends_on: "#f59e0b",
  gates: "#ef4444",
  parallel: "#94a3b8",
  subproject_of: "#38bdf8",
};

type ProjectNodeData = PortfolioNode & {
  onOpen: (id: string) => void;
} & Record<string, unknown>;

function ProjectCard({ data }: NodeProps<Node<ProjectNodeData>>) {
  const late = data.late_tasks > 0;
  const gated = data.open_gates > 0;
  return (
    <div
      onDoubleClick={() => data.onOpen(data.id)}
      title="Double-click to open this project"
      className={cn(
        "w-60 cursor-pointer rounded-xl border bg-card p-3 shadow-sm transition",
        "hover:border-primary/60",
        late && "border-destructive/50",
      )}
      style={data.color ? { borderTopColor: data.color, borderTopWidth: 3 } : undefined}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2" />
      <p className="truncate text-sm font-medium">{data.name}</p>
      {data.goal && (
        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{data.goal}</p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="rounded-full border px-1.5 py-0.5 text-muted-foreground">
          {data.open_tasks} open
        </span>
        {late && (
          <span className="inline-flex items-center gap-1 rounded-full border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-destructive">
            <AlertTriangle className="h-3 w-3" />
            {data.late_tasks} late
          </span>
        )}
        {gated && (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-amber-600 dark:text-amber-400">
            <ShieldAlert className="h-3 w-3" />
            {data.open_gates} {data.open_gates === 1 ? "gate" : "gates"}
          </span>
        )}
      </div>
      {data.next_milestone && (
        <p className="mt-2 truncate text-[11px] text-muted-foreground">
          Next: {data.next_milestone}
          {data.next_milestone_date
            ? ` · ${new Date(data.next_milestone_date).toLocaleDateString()}`
            : ""}
        </p>
      )}
      <Handle type="source" position={Position.Right} className="!h-2 !w-2" />
    </div>
  );
}

const NODE_TYPES = { project: ProjectCard };

/** Rank by how far down the "waits for" chain a project sits. */
function columns(projects: PortfolioNode[], links: PortfolioEdge[]): Map<string, number> {
  const known = new Set(projects.map(p => p.id));
  const upstream = new Map<string, string[]>();
  for (const link of links) {
    if (!known.has(link.from_project_id) || !known.has(link.to_project_id)) continue;
    if (link.kind === "depends_on") {
      upstream.set(link.from_project_id, [
        ...(upstream.get(link.from_project_id) ?? []),
        link.to_project_id,
      ]);
    } else if (link.kind === "gates") {
      upstream.set(link.to_project_id, [
        ...(upstream.get(link.to_project_id) ?? []),
        link.from_project_id,
      ]);
    }
  }
  const depth = new Map<string, number>();
  const walking = new Set<string>();
  const of = (id: string): number => {
    if (depth.has(id)) return depth.get(id)!;
    // The server refuses loops, but a stale payload must not hang the layout.
    if (walking.has(id)) return 0;
    walking.add(id);
    const parents = upstream.get(id) ?? [];
    const d = parents.length === 0 ? 0 : Math.max(...parents.map(of)) + 1;
    walking.delete(id);
    depth.set(id, d);
    return d;
  };
  for (const p of projects) of(p.id);
  return depth;
}

function PortfolioGraph() {
  const navigate = useNavigate();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["portfolio", "local"],
    queryFn: () => getPortfolio(),
  });

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<ProjectNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const open = useCallback(
    (id: string) => navigate(`/projects/${id}/space`),
    [navigate],
  );

  const built = useMemo(() => {
    if (!data) return { nodes: [], edges: [] };
    const depth = columns(data.projects, data.links);
    const perColumn = new Map<number, number>();
    const laidOut: Node<ProjectNodeData>[] = data.projects.map(p => {
      const col = depth.get(p.id) ?? 0;
      const row = perColumn.get(col) ?? 0;
      perColumn.set(col, row + 1);
      return {
        id: p.id,
        type: "project",
        position: {
          x: col * COL_WIDTH + Math.floor(row / PER_ROW) * 40,
          y: row * ROW_HEIGHT,
        },
        data: { ...p, onOpen: open },
      };
    });

    const visible = new Set(data.projects.map(p => p.id));
    const drawn: Edge[] = data.links
      .filter(l => visible.has(l.from_project_id) && visible.has(l.to_project_id))
      .map(l => {
        // depends_on reads "from waits for to", so the arrow runs to -> from.
        const forward = l.kind !== "depends_on";
        const colour = EDGE_COLOURS[l.kind] ?? EDGE_COLOURS.parallel;
        const spent = l.kind === "gates" && l.status !== "open";
        return {
          id: l.id,
          source: forward ? l.from_project_id : l.to_project_id,
          target: forward ? l.to_project_id : l.from_project_id,
          label: l.kind === "gates" && spent ? `${EDGE_LABELS.gates} (${l.status})` : EDGE_LABELS[l.kind],
          animated: l.kind === "gates" && l.status === "open",
          style: {
            stroke: colour,
            strokeWidth: 1.5,
            strokeDasharray: l.kind === "parallel" ? "4 4" : undefined,
            opacity: spent ? 0.4 : 1,
          },
          labelStyle: { fontSize: 10, fill: "currentColor" },
          labelBgStyle: { fill: "var(--card)", fillOpacity: 0.85 },
          markerEnd:
            l.kind === "parallel"
              ? undefined
              : { type: MarkerType.ArrowClosed, color: colour },
        } satisfies Edge;
      });
    return { nodes: laidOut, edges: drawn };
  }, [data, open]);

  useEffect(() => {
    setNodes(built.nodes);
    setEdges(built.edges);
  }, [built, setNodes, setEdges]);

  const hidden = useMemo(
    () => (data ? data.links.filter(l => l.dangling).length : 0),
    [data],
  );

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (isError) {
    return (
      <p className="p-6 text-sm text-destructive">The portfolio could not be loaded.</p>
    );
  }
  if (!data || data.projects.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <Network className="h-8 w-8" />
        <p className="text-sm">No projects yet.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b px-6 py-3">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <Network className="h-5 w-5" /> Portfolio
        </h1>
        <span className="text-xs text-muted-foreground">
          {data.projects.length} {data.projects.length === 1 ? "project" : "projects"} ·
          {" "}
          {data.links.length} {data.links.length === 1 ? "link" : "links"} · double-click a
          card to open it
        </span>
        {hidden > 0 && (
          <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-600 dark:text-amber-400">
            {hidden} {hidden === 1 ? "link goes" : "links go"} to a project you cannot see
          </span>
        )}
      </header>
      <div className="flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={NODE_TYPES}
          nodesConnectable={false}
          edgesFocusable={false}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable className="!bg-card" />
        </ReactFlow>
      </div>
    </div>
  );
}

export function PortfolioPage() {
  return (
    <ReactFlowProvider>
      <PortfolioGraph />
    </ReactFlowProvider>
  );
}
