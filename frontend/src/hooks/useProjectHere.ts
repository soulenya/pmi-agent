/**
 * The project the user is standing in, read off the route.
 *
 * Inside a project space, Gerry should be the project's Gerry: the panel binds
 * to the project's conversation and every turn says which project and tab the
 * question came from. Outside one, this is null and the panel is general.
 */
import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { getProjectSpace, type Source } from "@/api/tasks";

const SPACE = /^\/(hub\/)?projects\/([0-9a-f-]{36})\/space(?:\/([a-z]+))?/i;

export interface ProjectHere {
  id: string;
  source: Source;
  tab: string;
  name: string | null;
  conversationId: string | null;
  loaded: boolean;
}

export function useProjectHere(): ProjectHere | null {
  const { pathname } = useLocation();
  const match = useMemo(() => {
    const m = SPACE.exec(pathname);
    if (!m) return null;
    return {
      id: m[2],
      source: (m[1] ? "hub" : "local") as Source,
      tab: m[3] ?? "overview",
    };
  }, [pathname]);

  // Same key as the project space page, so this is a cache read, not a second fetch.
  const { data, isFetched } = useQuery({
    queryKey: ["project-space", match?.source ?? "local", match?.id ?? ""],
    queryFn: () => getProjectSpace(match!.id, match!.source),
    enabled: Boolean(match),
    staleTime: 30_000,
  });

  if (!match) return null;
  return {
    ...match,
    name: data?.project.name ?? null,
    conversationId: data?.workroom?.conversation_id ?? null,
    loaded: isFetched,
  };
}

/** What Gerry is told about where a typed question came from. */
export function projectContextPrefix(here: ProjectHere): string {
  const name = here.name ?? "this project";
  const where = here.source === "hub" ? " (shared on the hub)" : "";
  return `[Context: I am inside the project "${name}"${where}, on its ${here.tab} tab]`;
}
