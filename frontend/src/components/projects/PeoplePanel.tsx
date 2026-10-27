import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, UserPlus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { exampleEmail } from "@/lib/brand";
import {
  addProjectMember,
  removeProjectMember,
  updateProjectMember,
} from "@/api/tasks";
import type { MemberAdd, Source } from "@/api/tasks";
import { listPeople } from "@/api/team";
import type { AssignableRole, ProjectMember } from "@/types/tasks";
import { MoveToHubCard } from "./MoveToHub";

const ROLES: { value: AssignableRole; label: string; hint: string }[] = [
  { value: "viewer", label: "Can view", hint: "Read the project. Change nothing." },
  { value: "commenter", label: "Can comment", hint: "Read, and leave comments." },
  { value: "editor", label: "Can edit", hint: "Do the work: tasks, canvas, notes." },
];

/** The picker's escape hatch for someone the directory does not list yet. */
const BY_EMAIL = "__email__";

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
 * People are added the way team chat adds them: picked from the directory of
 * accounts that exist here, by id. A typed address can miss the account it was
 * meant for — the role then sits on nobody and the person never hears of it —
 * so typing one is the fallback, not the default, and it has to match someone
 * who has already signed in.
 */
export function ProjectPeoplePanel({
  projectId,
  projectName,
  source = "local",
  members,
  isOwner,
}: {
  projectId: string;
  projectName?: string;
  source?: Source;
  members: ProjectMember[];
  isOwner: boolean;
}) {
  const qc = useQueryClient();
  const [pick, setPick] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AssignableRole>("editor");

  // Member lists only mean something on the hub, and that is where team chat's
  // directory lives too — the same people, under the same ids.
  const people = useQuery({
    queryKey: ["team", "people"],
    queryFn: listPeople,
    staleTime: 60_000,
    enabled: isOwner && source === "hub",
  });

  const candidates = useMemo(() => {
    const onProject = new Set(members.map(m => m.user_id));
    return (people.data ?? []).filter(p => !p.is_me && !onProject.has(p.id));
  }, [people.data, members]);

  const byEmail = pick === BY_EMAIL;
  const who: MemberAdd | null = byEmail
    ? email.trim()
      ? { email: email.trim() }
      : null
    : pick
      ? { user_id: pick }
      : null;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["project-space", source, projectId] });
  };

  const addMutation = useMutation({
    mutationFn: (target: MemberAdd) => addProjectMember(projectId, target, role, source),
    onSuccess: () => {
      setPick("");
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

  // A local project exists in this database and no other, so a member list on
  // one is decoration. Say so instead of adding to it.
  if (source === "local") {
    return (
      <MoveToHubCard
        projectId={projectId}
        projectName={projectName}
        members={members}
        isOwner={isOwner}
      />
    );
  }

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
              {m.has_signed_in === false && (
                <span
                  className="ml-1.5 text-xs text-amber-600"
                  title="No one has signed in to this account. If this is not the address they use, remove it and pick them from the list."
                >
                  never signed in
                </span>
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
            if (who) addMutation.mutate(who);
          }}
          className="mt-4 space-y-2 border-t pt-4"
        >
          <div className="flex gap-2">
            <select
              value={pick}
              disabled={busy || people.isLoading}
              onChange={e => setPick(e.target.value)}
              className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5 text-sm disabled:opacity-50"
            >
              <option value="">
                {people.isLoading
                  ? "Loading people…"
                  : candidates.length
                    ? "Choose someone…"
                    : "Everyone here is already on this project"}
              </option>
              {candidates.map(p => (
                <option key={p.id} value={p.id}>
                  {p.display_name}
                  {p.display_name !== p.email ? ` — ${p.email}` : ""}
                </option>
              ))}
              <option value={BY_EMAIL}>Someone else, by email…</option>
            </select>
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
              disabled={!who || busy}
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
          {byEmail && (
            <input
              type="email"
              autoFocus
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder={exampleEmail()}
              className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          )}
          <p className="text-xs text-muted-foreground">
            {byEmail
              ? "They need to have signed in at least once; the address has to match their account."
              : ROLES.find(r => r.value === role)?.hint}
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
