import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Loader2, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { promoteProject } from "@/api/tasks";
import type { ProjectMember } from "@/types/tasks";

type Reach = "shared" | "company";

const REACH: { value: Reach; label: string; hint: string }[] = [
  {
    value: "shared",
    label: "Only the people I name",
    hint: "Nobody else at the firm will see it, or know it exists.",
  },
  {
    value: "company",
    label: "Everyone at the firm",
    hint: "Anyone signed in can find and open it.",
  },
];

function errorMessage(err: unknown): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response
    ?.data?.detail;
  if (typeof detail === "string" && detail) return detail;
  if (err instanceof Error && err.message) return err.message;
  return "Please try again.";
}

/**
 * The People panel for a project that lives on this computer.
 *
 * There is no member list to offer here, because there is nobody to offer it
 * to: the project is in this database and no other. Sharing it means sending it
 * to the hub, so that is what this panel does.
 */
export function MoveToHubCard({
  projectId,
  projectName,
  members,
  isOwner,
}: {
  projectId: string;
  projectName?: string;
  members: ProjectMember[];
  isOwner: boolean;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [reach, setReach] = useState<Reach>("shared");

  const move = useMutation({
    mutationFn: () => promoteProject(projectId, reach),
    onSuccess: result => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["hub", "projects"] });
      navigate(`/hub/projects/${result.project_id}/space`);
    },
  });

  // Roles granted before the move went nowhere, but they say who was meant to
  // be here, and they travel with the project.
  const invited = members.filter(m => m.role !== "owner");

  return (
    <div className="rounded-xl border bg-card p-5">
      <h2 className="mb-1 text-sm font-medium">People</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        This project is on this computer only. Nobody else can open it, however
        it is labelled, until it is moved to the hub.
      </p>

      {invited.length > 0 && (
        <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5">
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {invited.length === 1 ? "One person was" : `${invited.length} people were`}{" "}
            added here and cannot see any of it. Moving the project takes{" "}
            {invited.length === 1 ? "them" : "them all"} with it.
          </p>
          <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
            {invited.map(m => (
              <li key={m.user_id} className="truncate">
                {m.email || m.display_name || m.user_id}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!isOwner ? (
        <p className="text-xs text-muted-foreground">
          Only the owner can move a project to the hub.
        </p>
      ) : (
        <div className="space-y-3 border-t pt-4">
          <p className="text-xs font-medium">Who should be able to reach it?</p>
          <div className="space-y-1.5">
            {REACH.map(r => (
              <label
                key={r.value}
                className={cn(
                  "flex cursor-pointer gap-2.5 rounded-md border p-2.5",
                  reach === r.value ? "border-primary bg-primary/5" : "hover:bg-accent",
                )}
              >
                <input
                  type="radio"
                  name="reach"
                  checked={reach === r.value}
                  onChange={() => setReach(r.value)}
                  className="mt-0.5"
                />
                <span className="min-w-0">
                  <span className="block text-sm">{r.label}</span>
                  <span className="block text-xs text-muted-foreground">{r.hint}</span>
                </span>
              </label>
            ))}
          </div>

          <button
            type="button"
            disabled={move.isPending}
            onClick={() => {
              if (
                confirm(
                  `Move ${projectName || "this project"} to the hub?\n\nIts tasks, canvas and notes go with it. The copy on this computer is archived, not deleted.`,
                )
              ) {
                move.mutate();
              }
            }}
            className={cn(
              "flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2",
              "text-sm font-medium text-primary-foreground disabled:opacity-50",
            )}
          >
            {move.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            {move.isPending ? "Moving…" : "Move to the hub"}
          </button>

          <p className="text-xs text-muted-foreground">
            {reach === "shared"
              ? "You name the people once it is there."
              : "Everyone signed in will be able to open it once it is there."}
          </p>
        </div>
      )}

      {move.error != null && (
        <p className="mt-2 text-xs text-destructive">{errorMessage(move.error)}</p>
      )}
    </div>
  );
}
