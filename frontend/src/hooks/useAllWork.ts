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
import { useHubReachStore } from "@/stores/hubReachStore";
import type { Project, Task } from "@/types/tasks";

export type SourcedTask = Task & { source: Source };
export type SourcedProject = Project & { source: Source };

export function useHubStatus() {
  return useQuery({
    queryKey: ["hub", "status"],
    queryFn: getHubStatus,
    staleTime: 60_000,
    retry: false,
  });
}

/** Shared work can be reached: from a desktop that has signed in, or on the hub itself. */
export function useHubConnected(): boolean {
  const { data } = useHubStatus();
  return data?.connected === true;
}

/**
 * This browser is on the hub. The "local" and "hub" halves of a merged list
 * are then the same database, so one of them has to stay quiet.
 */
export function useHubHere(): boolean {
  const { data } = useHubStatus();
  return data?.here === true;
}

/** The hub is somewhere else and reachable: worth asking as a second source. */
export function useHubRemote(): boolean {
  const { data } = useHubStatus();
  return data?.connected === true && data?.here !== true;
}

/**
 * Where new work goes when nothing else decides. The hub is the record once
 * this computer is signed in to it; only an install with no hub link keeps
 * writing to its own tables.
 */
export function useDefaultSource(): Source {
  return useHubConnected() ? "hub" : "local";
}

/**
 * The hub is linked but did not answer. Lists are then missing everything
 * that lives there and nothing there can be changed, and the page has to say
 * so rather than show a shorter list as if it were the whole truth.
 */
export function useHubOffline(): boolean {
  const remote = useHubRemote();
  const offline = useHubReachStore((s) => s.offline);
  return remote && offline;
}

// While the hub is down, ask again on a timer so the page recovers by itself.
const RETRY_MS = 30_000;

export function useAllTasks() {
  const hubConnected = useHubConnected();
  const here = useHubHere();
  const offline = useHubOffline();
  // On the hub every row is a hub row; asking twice would list each one twice.
  const local = useQuery({
    queryKey: ["tasks"],
    queryFn: () => listTasks(),
    enabled: !here,
  });
  const hub = useQuery({
    queryKey: ["hub", "tasks"],
    queryFn: () => listTasks(undefined, "hub"),
    enabled: hubConnected,
    staleTime: 30_000,
    retry: false,
    refetchInterval: offline ? RETRY_MS : false,
  });
  // Moving a project to the hub archives the copy here but leaves its tasks
  // in place, so without this every moved task would be listed twice.
  const localProjects = useQuery({
    queryKey: ["projects", "all"],
    queryFn: () => listProjects(true),
    staleTime: 60_000,
    enabled: !here,
  });
  const tasks = useMemo<SourcedTask[]>(() => {
    const archived = new Set(
      (localProjects.data ?? []).filter((p) => p.is_archived).map((p) => p.id),
    );
    return [
      ...(here ? [] : local.data ?? [])
        .filter((t) => !t.project_id || !archived.has(t.project_id))
        .map((t) => ({ ...t, source: "local" as Source })),
      ...(hub.data ?? []).map((t) => ({ ...t, source: "hub" as Source })),
    ];
  }, [local.data, hub.data, localProjects.data, here]);
  return {
    tasks,
    isLoading: here ? hub.isLoading : local.isLoading,
    hubConnected,
    hubLoading: hub.isLoading,
    /** The hub was asked and did not answer; `tasks` is missing what lives there. */
    hubError: hubConnected && hub.isError,
  };
}

export function useAllProjects(includeArchived = false) {
  const hubConnected = useHubConnected();
  const here = useHubHere();
  const offline = useHubOffline();
  const local = useQuery({
    queryKey: includeArchived ? ["projects", "all"] : ["projects"],
    queryFn: () => listProjects(includeArchived),
    staleTime: 60_000,
    enabled: !here,
  });
  const hub = useQuery({
    queryKey: includeArchived ? ["hub", "projects", "all"] : ["hub", "projects"],
    queryFn: () => listProjects(includeArchived, "hub"),
    enabled: hubConnected,
    staleTime: 30_000,
    retry: false,
    refetchInterval: offline ? RETRY_MS : false,
  });
  const projects = useMemo<SourcedProject[]>(
    () => [
      ...(here ? [] : local.data ?? []).map((p) => ({ ...p, source: "local" as Source })),
      ...(hub.data ?? []).map((p) => ({ ...p, source: "hub" as Source })),
    ],
    [local.data, hub.data, here],
  );
  return {
    projects,
    isLoading: here ? hub.isLoading : local.isLoading,
    hubConnected,
    hubError: hubConnected && hub.isError,
  };
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
