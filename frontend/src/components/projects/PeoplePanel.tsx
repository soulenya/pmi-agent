import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, UserPlus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  addProjectMember,
  removeProjectMember,
  updateProjectMember,
} from "@/api/tasks";
import type { Source } from "@/api/tasks";
import type { AssignableRole, ProjectMember } from "@/types/tasks";

const ROLES: { value: AssignableRole; label: string; hint: string }[] = [
  { value: "viewer", label: "Can view", hint: "Read the project. Change nothing." },
  { value: "commenter", label: "Can comment", hint: "Read, and leave comments." },
  { value: "editor", label: "Can edit", hint: "Do the work: tasks, canvas, notes." },
];

function errorMessage(err: unknown): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response
    ?.data?.detail;
  if (typeof detail === "string" && detail) return detail;
  if (err instanceof Error && err.message) return err.message;
  return "Please try again.";
}

/**
 * The member list, and the owner's controls for it.
 *
 * Adding someone hands them a role. It does not hand them a way in: they still
 * have to sign in as themselves before the role means anything, which is why an
 * address outside the firm is refused outright.
 */
export function ProjectPeoplePanel({
  projectId,
  source = "local",
  members,
  isOwner,
}: {
  projectId: string;
  source?: Source;
  members: ProjectMember[];
  isOwner: boolean;
}) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AssignableRole>("editor");

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["project-space", source, projectId] });
  };

  const addMutation = useMutation({
    mutationFn: () => addProjectMember(projectId, email.trim(), role, source),
    onSuccess: () => {
      setEmail("");
      refresh();
    },
  });

  const roleMutation = useMutation({
    mutationFn: (v: { userId: string; role: AssignableRole }) =>
      updateProjectMember(projectId, v.userId, v.role, source),
    onSuccess: refresh,
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) => removeProjectMember(projectId, userId, source),
    onSuccess: refresh,
  });

  const busy = addMutation.isPending || roleMutation.isPending || removeMutation.isPending;
  const failure = addMutation.error ?? roleMutation.error ?? removeMutation.error;

  return (
    <div className="rounded-xl border bg-card p-5">
      <h2 className="mb-1 text-sm font-medium">People</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        {isOwner
          ? "Everyone here can open this project. Only you can change the list."
          : "Everyone on this list can open this project."}
      </p>

      <ul className="space-y-1.5 text-sm">
        {members.map(m => (
          <li key={m.user_id} className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate">
              {m.display_name || m.email || m.user_id}
              {m.display_name && m.email && (
                <span className="ml-1.5 text-xs text-muted-foreground">{m.email}</span>
              )}
            </span>

            {m.role === "owner" || !isOwner ? (
              <span className="shrink-0 text-xs text-muted-foreground">
                {m.role === "owner"
                  ? "Owner"
                  : ROLES.find(r => r.value === m.role)?.label ?? m.role}
              </span>
            ) : (
              <span className="flex shrink-0 items-center gap-1">
                <select
                  value={m.role}
                  disabled={busy}
                  onChange={e =>
                    roleMutation.mutate({
                      userId: m.user_id,
                      role: e.target.value as AssignableRole,
                    })
                  }
                  className="rounded-md border bg-background px-1.5 py-1 text-xs disabled:opacity-50"
                >
                  {ROLES.map(r => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={busy}
                  title={`Remove ${m.display_name || m.email || "this person"}`}
                  onClick={() => {
                    if (
                      confirm(
                        `Remove ${m.display_name || m.email || "this person"} from the project? They will lose access to it.`,
                      )
                    ) {
                      removeMutation.mutate(m.user_id);
                    }
                  }}
                  className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>

      {isOwner && (
        <form
          onSubmit={e => {
            e.preventDefault();
            if (email.trim()) addMutation.mutate();
          }}
          className="mt-4 space-y-2 border-t pt-4"
        >
          <div className="flex gap-2">
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="name@pmi-llc.com"
              className="min-w-0 flex-1 rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <select
              value={role}
              onChange={e => setRole(e.target.value as AssignableRole)}
              className="rounded-md border bg-background px-2 py-1.5 text-sm"
            >
              {ROLES.map(r => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={!email.trim() || busy}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 py-1.5",
                "text-sm font-medium text-primary-foreground disabled:opacity-50",
              )}
            >
              {addMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <UserPlus className="h-3.5 w-3.5" />
              )}
              Add
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            {ROLES.find(r => r.value === role)?.hint}
          </p>
        </form>
      )}

      {failure != null && (
        // A refusal here is usually meaningful — the wrong domain, or already
        // added — so it is worth showing rather than swallowing.
        <p className="mt-2 text-xs text-destructive">{errorMessage(failure)}</p>
      )}
    </div>
  );
}
