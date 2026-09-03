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
  Unlock,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ensureProjectWorkroom,
  getProjectSpace,
  listHeldItems,
  listTasks,
  releaseHeldItem,
  updateProject,
} from "@/api/tasks";
import type { Source } from "@/api/tasks";
import type { HeldItem, ProjectVisibility } from "@/types/tasks";
import { TimelineTab } from "@/components/projects/TimelineTab";
import { CanvasTab } from "@/components/projects/CanvasTab";
import { ProjectLinksPanel } from "@/components/projects/ProjectLinksPanel";
import { ProjectPeoplePanel } from "@/components/projects/PeoplePanel";

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

export function ProjectSpacePage({ source = "local" }: { source?: Source } = {}) {
  const { id, tab } = useParams<{ id: string; tab?: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const onHub = source === "hub";
  const base = onHub ? `/hub/projects/${id}` : `/projects/${id}`;
  const active: TabId = useMemo(() => {
    const found = TABS.find(t => t.id === tab);
    return found ? found.id : "overview";
  }, [tab]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["project-space", source, id],
    queryFn: () => getProjectSpace(id!, source),
    enabled: Boolean(id),
  });

  const visibilityMutation = useMutation({
    mutationFn: (visibility: ProjectVisibility) =>
      updateProject(id!, { visibility }, source),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-space", source, id] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["hub", "projects"] });
    },
  });

  const workroomMutation = useMutation({
    mutationFn: () => ensureProjectWorkroom(id!, source),
    onSuccess: room => {
      qc.invalidateQueries({ queryKey: ["project-space", source, id] });
      // A hub conversation is held on the hub; this app can only open its own.
      if (onHub) return;
      if (room.conversation_id) navigate(`/chat/${room.conversation_id}`);
      else navigate("/workrooms");
    },
  });

  const { data: held = [] } = useQuery({
    queryKey: ["project-held", source, id],
    queryFn: () => listHeldItems(id!, source),
    enabled: Boolean(id),
  });

  // The hub has no task board in this window, so the space lists them itself.
  const { data: hubTasks = [] } = useQuery({
    queryKey: ["hub", "tasks", id],
    queryFn: () => listTasks({ project_id: id! }, "hub"),
    enabled: onHub && Boolean(id),
  });

  const releaseMutation = useMutation({
    mutationFn: (item: HeldItem) =>
      releaseHeldItem(id!, item.item_type, item.item_id, undefined, source),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-held", source, id] });
      qc.invalidateQueries({ queryKey: ["project-space", source, id] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["hub", "tasks"] });
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
        {onHub
          ? "The hub didn't hand that project over. It may not be shared with you, or the hub connection may have lapsed."
          : "That project isn't available to you."}
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
          {onHub && (
            <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs">
              On the hub
            </span>
          )}
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
                onClick={() => navigate(`${base}/space/${t.id}`)}
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
            </div>

            <ProjectPeoplePanel
              projectId={id!}
              source={source}
              members={members}
              isOwner={myRole === "owner"}
            />

            <ProjectLinksPanel projectId={id!} source={source} canEdit={canEdit} />
          </div>
        )}

        {active === "canvas" && (
          <CanvasTab projectId={id!} source={source} canEdit={canEdit} />
        )}

        {active === "timeline" && (
          <TimelineTab projectId={id!} source={source} canEdit={canEdit} />
        )}

        {active === "tasks" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {counts.tasks_open} open of {counts.tasks_total}.
            </p>
            {onHub ? (
              hubTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No tasks on this project yet.
                </p>
              ) : (
                <ul className="divide-y rounded-xl border">
                  {hubTasks.map(t => (
                    <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-2">
                      <span className="truncate text-sm">{t.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {t.status.replace("_", " ")}
                        {t.due_date
                          ? ` \u00b7 due ${new Date(t.due_date).toLocaleDateString()}`
                          : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )
            ) : (
              <NavLink
                to={`/projects/${id}`}
                className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
              >
                <FolderOpen className="h-4 w-4" /> Open the task board
              </NavLink>
            )}

            {held.length > 0 && (
              <div className="rounded-xl border p-4">
                <h3 className="text-sm font-medium">Held by this project</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Made here, so it can only be changed here, by someone on the
                  project. Releasing it lets it move elsewhere.
                </p>
                <ul className="mt-3 divide-y">
                  {held.map(h => (
                    <li
                      key={`${h.item_type}:${h.item_id}`}
                      className="flex items-center justify-between gap-3 py-2"
                    >
                      <span className="truncate text-sm">
                        {h.label ?? h.item_id}
                      </span>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="text-xs text-muted-foreground">
                          since {new Date(h.since).toLocaleDateString()}
                        </span>
                        {myRole === "owner" && (
                          <button
                            type="button"
                            disabled={releaseMutation.isPending}
                            onClick={() => releaseMutation.mutate(h)}
                            className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
                          >
                            <Unlock className="h-3.5 w-3.5" /> Release
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
                {myRole !== "owner" && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Only the owner can release work from the project.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {active === "material" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {counts.items} pinned {counts.items === 1 ? "item" : "items"} and{" "}
              {counts.journal} journal {counts.journal === 1 ? "entry" : "entries"}.
            </p>
            {onHub ? (
              <p className="text-sm text-muted-foreground">
                This material sits in the project's workroom on the hub, alongside
                the rest of the project. Open the hub in a browser to work in it.
              </p>
            ) : (
              <NavLink
                to="/workrooms"
                className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
              >
                <Paperclip className="h-4 w-4" /> Open the workroom
              </NavLink>
            )}
          </div>
        )}

        {active === "chat" && (
          <div className="space-y-3">
            {onHub ? (
              <p className="text-sm text-muted-foreground">
                {workroom?.conversation_id
                  ? "This project's conversation is held on the hub. Open the hub in a browser to read or add to it."
                  : "This project has no conversation yet. It would be started on the hub, where the project lives."}
              </p>
            ) : workroom?.conversation_id ? (
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
