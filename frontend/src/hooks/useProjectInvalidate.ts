/**
 * One refresh for the whole project.
 *
 * The tabs of a project space are five views of one thing: a task drawn on the
 * canvas is the same row the timeline draws a bar for and the tasks tab lists,
 * and a budget node reads the ledger the budget tab edits. Each tab used to
 * invalidate its own corner of the cache, so a change made in one would sit
 * there unseen until the other was reloaded by hand.
 *
 * Anything that writes to a project calls this instead, and every tab catches
 * up at once.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import type { Source } from "@/api/tasks";

export function useProjectInvalidate(projectId: string, source: Source = "local") {
  const qc = useQueryClient();
  return useCallback(() => {
    // The project's own summary, and its counts.
    qc.invalidateQueries({ queryKey: ["project-space", source, projectId] });
    qc.invalidateQueries({ queryKey: ["project-held", source, projectId] });
    qc.invalidateQueries({ queryKey: ["project-timeline", source, projectId] });
    qc.invalidateQueries({ queryKey: ["project-budgets", source, projectId] });
    qc.invalidateQueries({ queryKey: ["project-budget", source, projectId] });
    qc.invalidateQueries({ queryKey: ["project-canvas", source, projectId] });
    qc.invalidateQueries({ queryKey: ["project-canvas-refs", source] });
    // Task lists are keyed by their filter, so match the family rather than one
    // key: the same task shows up in the project list, the tasks page and the
    // canvas rail.
    qc.invalidateQueries({ queryKey: ["tasks"] });
    qc.invalidateQueries({ queryKey: ["hub", "tasks"] });
    qc.invalidateQueries({ queryKey: ["workroom"] });
  }, [qc, projectId, source]);
}
