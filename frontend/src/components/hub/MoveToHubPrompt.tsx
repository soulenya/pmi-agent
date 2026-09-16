/**
 * "Move your work to the hub" — offered once per build after the boot popups.
 *
 * The hub is where a person's work is meant to live now, and the desktop still
 * holds whatever was made before that was true. This asks, with the exact list
 * of what would move, and does it in one go. "Not now" brings it back after
 * the next update; "Don't ask again" does not. Nothing here is automatic.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cloud, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { moveAllToHub, previewMoveAll, type MoveAllResult } from "@/api/hub";
import { getClientState, setClientState } from "@/api/settings";
import { useHubRemote } from "@/hooks/useAllWork";
import { useBootPopupStore } from "@/stores/bootPopupStore";
import { useMoveToHubStore } from "@/stores/moveToHubStore";
import { BUILD_NUMBER } from "@/version";

const KEY = "hub.movePrompt";

interface PromptState {
  dismissed_build?: number;
  never?: boolean;
  done?: boolean;
}

export function MoveToHubPrompt() {
  const qc = useQueryClient();
  const phase = useBootPopupStore((s) => s.phase);
  const hubRemote = useHubRemote();
  const requests = useMoveToHubStore((s) => s.requests);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<PromptState | null>(null);
  const [result, setResult] = useState<MoveAllResult | null>(null);

  const preview = useQuery({
    queryKey: ["hub", "move-all", "preview"],
    queryFn: previewMoveAll,
    enabled: hubRemote,
    staleTime: 60_000,
    retry: false,
  });
  const total = (preview.data?.projects.length ?? 0) + (preview.data?.orphan_tasks ?? 0);

  useEffect(() => {
    if (!hubRemote) return;
    getClientState<PromptState>(KEY)
      .then((v) => setState(v ?? {}))
      .catch(() => setState({}));
  }, [hubRemote]);

  // Boot: after What's New has had its turn, once per build, only when there is something to move.
  useEffect(() => {
    if (phase !== "done" || !hubRemote || !state || !preview.data) return;
    if (state.never || state.done || state.dismissed_build === BUILD_NUMBER) return;
    if (total === 0) return;
    setOpen(true);
  }, [phase, hubRemote, state, preview.data, total]);

  // Settings → The hub asks for it explicitly.
  useEffect(() => {
    if (requests > 0) {
      setResult(null);
      setOpen(true);
    }
  }, [requests]);

  const remember = (patch: PromptState) => {
    const next = { ...(state ?? {}), ...patch };
    setState(next);
    void setClientState(KEY, next).catch(() => undefined);
  };

  const move = useMutation({
    mutationFn: moveAllToHub,
    onSuccess: (r) => {
      setResult(r);
      if (r.failed.length === 0) remember({ done: true });
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["hub"] });
      qc.invalidateQueries({ queryKey: ["portfolio"] });
    },
  });

  if (!open) return null;

  const p = preview.data;
  const close = () => setOpen(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={close}>
      <div
        className="w-full max-w-lg rounded-xl border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="move-to-hub-title"
      >
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h3 id="move-to-hub-title" className="flex items-center gap-2 text-base font-semibold">
            <Cloud className="h-4 w-4 text-primary" />
            Move your work to the hub
          </h3>
          <button onClick={close} className="rounded-md p-1 hover:bg-accent" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-5 py-4 text-sm">
          {result ? (
            <>
              <p>
                {result.moved.length} project{result.moved.length === 1 ? "" : "s"} and{" "}
                {result.tasks_moved} task{result.tasks_moved === 1 ? "" : "s"} are now on the hub.
                The copies on this computer are archived, not deleted.
              </p>
              {result.moved.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
                  {result.moved.map((m) => (
                    <li key={m.hub_project_id ?? m.name}>
                      {m.name} · {m.tasks} task{m.tasks === 1 ? "" : "s"}
                    </li>
                  ))}
                </ul>
              )}
              {result.failed.length > 0 && (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs">
                  <p className="font-medium">Not moved:</p>
                  <ul className="mt-1 list-disc pl-5">
                    {result.failed.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : !p ? (
            <p className="text-muted-foreground">Looking at what is on this computer…</p>
          ) : total === 0 ? (
            <p className="text-muted-foreground">
              Everything you own is already on the hub. There is nothing to move.
            </p>
          ) : (
            <>
              <p>
                Your work is meant to live on the hub now, so it is there from any browser when you
                travel, and shared projects, Team and Gerry all work with it. This computer still
                holds:
              </p>
              <ul className="list-disc space-y-0.5 pl-5">
                {p.projects.map((pr) => (
                  <li key={pr.id}>
                    <span className="font-medium">{pr.name}</span>
                    <span className="text-muted-foreground">
                      {" "}· {pr.visibility} · {pr.tasks} task{pr.tasks === 1 ? "" : "s"}
                    </span>
                  </li>
                ))}
                {p.orphan_tasks > 0 && (
                  <li>
                    <span className="font-medium">{p.orphan_tasks} tasks with no project</span>
                    <span className="text-muted-foreground">
                      {" "}· {p.orphan_open} still open · they will arrive in a private project called
                      "My tasks"
                    </span>
                  </li>
                )}
              </ul>
              <p className="text-xs text-muted-foreground">
                Private projects stay private on the hub. Chat history, the knowledge base and
                meeting notes stay on this computer. The copies here are archived once the hub has
                them, and nothing is deleted.
              </p>
              {move.isError && (
                <p className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs">
                  {String(
                    (move.error as { response?: { data?: { detail?: string } } })?.response?.data
                      ?.detail ?? "The move did not complete.",
                  )}
                </p>
              )}
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t bg-muted/30 px-5 py-3">
          {result || total === 0 ? (
            <button
              onClick={close}
              className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Done
            </button>
          ) : (
            <>
              <button
                onClick={() => {
                  remember({ never: true });
                  close();
                }}
                className="mr-auto rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                Don't ask again
              </button>
              <button
                onClick={() => {
                  remember({ dismissed_build: BUILD_NUMBER });
                  close();
                }}
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
              >
                Not now
              </button>
              <button
                onClick={() => move.mutate()}
                disabled={move.isPending || !p}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                {move.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}
                {move.isPending ? "Moving…" : "Move everything to the hub"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
