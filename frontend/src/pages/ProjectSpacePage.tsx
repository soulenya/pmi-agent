import { useMemo } from "react";
import { NavLink, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CalendarRange,
  FolderOpen,
  Globe2,
  Layers,
  Lock,
  MessageSquare,
  Paperclip,
  PenTool,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ensureProjectWorkroom,
  getProjectSpace,
  updateProject,
} from "@/api/tasks";
import type { ProjectVisibility } from "@/types/tasks";

const TABS = [
  { id: "overview", label: "Overview", icon: Layers },
  { id: "canvas", label: "Canvas", icon: PenTool },
  { id: "timeline", label: "Timeline", icon: CalendarRange },
  { id: "tasks", label: "Tasks", icon: FolderOpen },
  { id: "material", label: "Material", icon: Paperclip },
  { id: "chat", label: "Chat", icon: MessageSquare },
] as const;

type TabId = (typeof TABS)[number]["id"];

const VISIBILITY: Record<
  ProjectVisibility,
  { label: string; hint: string; icon: typeof Lock }
> = {
  private: {
    label: "Private",
    hint: "Only you. Nobody else can see that this project exists.",
    icon: Lock,
  },
  shared: {
    label: "Shared",
    hint: "Visible to the people on the member list, at the role you gave them.",
    icon: Users,
  },
  company: {
    label: "Company",
    hint: "Visible to everyone signed in. Stays that way until you change it.",
    icon: Globe2,
  },
};

function Placeholder({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-md text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

export function ProjectSpacePage() {
  const { id, tab } = useParams<{ id: string; tab?: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const active: TabId = useMemo(() => {
    const found = TABS.find(t => t.id === tab);
    return found ? found.id : "overview";
  }, [tab]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["project-space", id],
    queryFn: () => getProjectSpace(id!),
    enabled: Boolean(id),
  });

  const visibilityMutation = useMutation({
    mutationFn: (visibility: ProjectVisibility) =>
      updateProject(id!, { visibility }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-space", id] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const workroomMutation = useMutation({
    mutationFn: () => ensureProjectWorkroom(id!),
    onSuccess: room => {
      qc.invalidateQueries({ queryKey: ["project-space", id] });
      if (room.conversation_id) navigate(`/chat/${room.conversation_id}`);
      else navigate("/workrooms");
    },
  });

  if (isLoading) {
    return (
      <div className="p-8 text-sm text-muted-foreground">Loading project…</div>
    );
  }
  if (isError || !data) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        That project isn't available to you.
      </div>
    );
  }

  const { project, counts, members, workroom, my_role: myRole } = data;
  const vis = VISIBILITY[project.visibility] ?? VISIBILITY.private;
  const VisIcon = vis.icon;
  const canEdit = myRole === "owner" || myRole === "editor";

  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-6 py-4">
        <NavLink
          to="/projects"
          className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> Projects
        </NavLink>
        <div className="flex flex-wrap items-center gap-3">
          <span
            className="h-3 w-3 shrink-0 rounded-full"
            style={{ backgroundColor: project.color ?? "#64748b" }}
          />
          <h1 className="text-xl font-semibold">{project.name}</h1>
          <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
            <VisIcon className="h-3 w-3" />
            {vis.label}
          </span>
          <span className="text-xs text-muted-foreground">
            you are {myRole}
          </span>
        </div>
        {project.goal ? (
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{project.goal}</p>
        ) : null}

        <nav className="mt-4 flex flex-wrap gap-1">
          {TABS.map(t => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => navigate(`/projects/${id}/space/${t.id}`)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm",
                  active === t.id
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </button>
            );
          })}
        </nav>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        {active === "overview" && (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border bg-card p-5">
              <h2 className="mb-3 text-sm font-medium">At a glance</h2>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">Open tasks</dt>
                  <dd className="text-lg font-semibold">{counts.tasks_open}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">All tasks</dt>
                  <dd className="text-lg font-semibold">{counts.tasks_total}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Pinned material</dt>
                  <dd className="text-lg font-semibold">{counts.items}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">People</dt>
                  <dd className="text-lg font-semibold">{counts.members}</dd>
                </div>
              </dl>
            </div>

            <div className="rounded-xl border bg-card p-5">
              <h2 className="mb-1 text-sm font-medium">Who can see this</h2>
              <p className="mb-3 text-xs text-muted-foreground">{vis.hint}</p>
              <div className="flex flex-wrap gap-1">
                {(Object.keys(VISIBILITY) as ProjectVisibility[]).map(v => (
                  <button
                    key={v}
                    type="button"
                    disabled={myRole !== "owner" || visibilityMutation.isPending}
                    onClick={() => visibilityMutation.mutate(v)}
                    className={cn(
                      "rounded-md border px-3 py-1.5 text-xs disabled:opacity-50",
                      project.visibility === v
                        ? "border-primary bg-primary/10 text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {VISIBILITY[v].label}
                  </button>
                ))}
              </div>
              {myRole !== "owner" && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Only the owner can change this.
                </p>
              )}
              <ul className="mt-4 space-y-1 text-sm">
                {members.map(m => (
                  <li key={m.user_id} className="flex justify-between gap-3">
                    <span className="truncate">{m.display_name || m.email || m.user_id}</span>
                    <span className="text-xs text-muted-foreground">{m.role}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {active === "canvas" && (
          <Placeholder
            title="Canvas"
            body="The infinite canvas — bubbles, links, ink and images — arrives in the next release. The project it hangs off exists now."
          />
        )}

        {active === "timeline" && (
          <Placeholder
            title="Timeline"
            body="The Gantt view arrives with the canvas. Tasks need start dates and dependencies first."
          />
        )}

        {active === "tasks" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {counts.tasks_open} open of {counts.tasks_total}.
            </p>
            <NavLink
              to={`/projects/${id}`}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
            >
              <FolderOpen className="h-4 w-4" /> Open the task board
            </NavLink>
          </div>
        )}

        {active === "material" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {counts.items} pinned {counts.items === 1 ? "item" : "items"} and{" "}
              {counts.journal} journal {counts.journal === 1 ? "entry" : "entries"}.
            </p>
            <NavLink
              to="/workrooms"
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
            >
              <Paperclip className="h-4 w-4" /> Open the workroom
            </NavLink>
          </div>
        )}

        {active === "chat" && (
          <div className="space-y-3">
            {workroom?.conversation_id ? (
              <NavLink
                to={`/chat/${workroom.conversation_id}`}
                className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
              >
                <MessageSquare className="h-4 w-4" /> Continue the project conversation
              </NavLink>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  This project has no conversation with Gerry yet.
                </p>
                <button
                  type="button"
                  disabled={!canEdit || workroomMutation.isPending}
                  onClick={() => workroomMutation.mutate()}
                  className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
                >
                  <MessageSquare className="h-4 w-4" /> Start one
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
