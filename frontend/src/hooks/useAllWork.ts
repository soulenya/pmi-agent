/**
 * Your work, wherever it lives.
 *
 * A project moved to the hub takes its tasks with it, so a task list that only
 * asks this computer stops showing the work you actually do. These hooks ask
 * both, mark each row with where it came from, and hand back one list. Writes
 * go back to the row's own source.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { getHubStatus } from "@/api/hub";
import { listProjects, listTasks, type Source } from "@/api/tasks";
import type { Project, Task } from "@/types/tasks";

export type SourcedTask = Task & { source: Source };
export type SourcedProject = Project & { source: Source };

export function useHubConnected(): boolean {
  const { data } = useQuery({
    queryKey: ["hub", "status"],
    queryFn: getHubStatus,
    staleTime: 60_000,
    retry: false,
  });
  return data?.connected === true;
}

export function useAllTasks() {
  const hubConnected = useHubConnected();
  const local = useQuery({
    queryKey: ["tasks"],
    queryFn: () => listTasks(),
  });
  const hub = useQuery({
    queryKey: ["hub", "tasks"],
    queryFn: () => listTasks(undefined, "hub"),
    enabled: hubConnected,
    staleTime: 30_000,
    retry: false,
  });
  // Moving a project to the hub archives the copy here but leaves its tasks
  // in place, so without this every moved task would be listed twice.
  const localProjects = useQuery({
    queryKey: ["projects", "all"],
    queryFn: () => listProjects(true),
    staleTime: 60_000,
  });
  const tasks = useMemo<SourcedTask[]>(() => {
    const archived = new Set(
      (localProjects.data ?? []).filter((p) => p.is_archived).map((p) => p.id),
    );
    return [
      ...(local.data ?? [])
        .filter((t) => !t.project_id || !archived.has(t.project_id))
        .map((t) => ({ ...t, source: "local" as Source })),
      ...(hub.data ?? []).map((t) => ({ ...t, source: "hub" as Source })),
    ];
  }, [local.data, hub.data, localProjects.data]);
  return { tasks, isLoading: local.isLoading, hubConnected, hubLoading: hub.isLoading };
}

export function useAllProjects(includeArchived = false) {
  const hubConnected = useHubConnected();
  const local = useQuery({
    queryKey: includeArchived ? ["projects", "all"] : ["projects"],
    queryFn: () => listProjects(includeArchived),
    staleTime: 60_000,
  });
  const hub = useQuery({
    queryKey: includeArchived ? ["hub", "projects", "all"] : ["hub", "projects"],
    queryFn: () => listProjects(includeArchived, "hub"),
    enabled: hubConnected,
    staleTime: 30_000,
    retry: false,
  });
  const projects = useMemo<SourcedProject[]>(
    () => [
      ...(local.data ?? []).map((p) => ({ ...p, source: "local" as Source })),
      ...(hub.data ?? []).map((p) => ({ ...p, source: "hub" as Source })),
    ],
    [local.data, hub.data],
  );
  return { projects, isLoading: local.isLoading, hubConnected };
}

/** Refresh every task list, on this computer and on the hub. */
export function useInvalidateTasks() {
  const qc = useQueryClient();
  return useCallback(() => {
    qc.invalidateQueries({ queryKey: ["tasks"] });
    qc.invalidateQueries({ queryKey: ["hub", "tasks"] });
  }, [qc]);
}

/** Where a task or project lives, for a row that may not have been tagged. */
export function sourceOf(item: { source?: Source } | null | undefined): Source {
  return item?.source ?? "local";
}

/** The route into a project's space, wherever the project lives. */
export function projectSpacePath(projectId: string, source: Source): string {
  return source === "hub" ? `/hub/projects/${projectId}/space` : `/projects/${projectId}/space`;
}
