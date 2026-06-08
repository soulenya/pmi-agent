import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Users,
  UserPlus,
  ShieldCheck,
  ShieldOff,
  ToggleLeft,
  ToggleRight,
  X,
  Loader2,
  Mail,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { listUsers, inviteUser, updateUser } from "@/api/users";
import type { User } from "@/types/users";

// ── Role badge ─────────────────────────────────────────────────────────────────

const ROLE_STYLES: Record<string, string> = {
  admin: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  member: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  manager: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  user: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  readonly: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

function RoleBadge({ role }: { role: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
        ROLE_STYLES[role] ?? ROLE_STYLES.user,
      )}
    >
      {role === "admin" ? (
        <ShieldCheck className="h-3 w-3" />
      ) : role === "readonly" ? (
        <ShieldOff className="h-3 w-3" />
      ) : null}
      {role}
    </span>
  );
}

// ── Invite modal ───────────────────────────────────────────────────────────────

function InviteModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ email: "", display_name: "", message: "" });
  const [emailError, setEmailError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: inviteUser,
  });

  function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!form.email.includes("@")) {
      setEmailError("Valid email required");
      return;
    }
    setEmailError(null);
    mutation.mutate({
      email: form.email.toLowerCase().trim(),
      display_name: form.display_name.trim() || undefined,
      message: form.message.trim() || undefined,
    });
  }

  const sent = mutation.isSuccess;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">Invite User</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {sent ? (
          <div className="space-y-4 p-6 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-green-500" />
            <div>
              <p className="font-semibold">Invitation sent</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {mutation.data?.message ?? `An email is on its way to ${form.email}.`}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              They&apos;ll install Little Gerry and sign in with Google — their account is created
              automatically on first login as a full-access member.
            </p>
            <button
              onClick={onClose}
              className="mx-auto rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 p-5">
            <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              We&apos;ll email a download link. The invitee installs Little Gerry and signs in with
              Google — no password needed, and their account is set up automatically as a full-access
              member.
            </p>

            {/* Email */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Email</label>
              <input
                type="email"
                autoFocus
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="jane@pmi-llc.com"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              {emailError && <p className="text-xs text-destructive">{emailError}</p>}
            </div>

            {/* Display name (optional) */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Name <span className="text-muted-foreground/60">(optional)</span>
              </label>
              <input
                value={form.display_name}
                onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
                placeholder="Jane Smith"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {/* Personal message (optional) */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Personal message <span className="text-muted-foreground/60">(optional)</span>
              </label>
              <textarea
                value={form.message}
                onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                placeholder="Looking forward to having you on board!"
                rows={3}
                className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {/* API error */}
            {mutation.isError && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {(mutation.error as { response?: { data?: { detail?: string } } })?.response?.data
                  ?.detail ?? "Failed to send the invitation."}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border px-4 py-2 text-sm text-muted-foreground hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={mutation.isPending}
                className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {mutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Mail className="h-3.5 w-3.5" />
                )}
                Send Invite
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ── User row ───────────────────────────────────────────────────────────────────

function UserRow({ user }: { user: User }) {
  const qc = useQueryClient();

  const updateMutation = useMutation({
    mutationFn: (body: { is_active?: boolean; role?: string; can_write_regulatory?: boolean }) =>
      updateUser(user.id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });

  const joinDate = new Date(user.created_at).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <tr className="border-b last:border-0 hover:bg-accent/20 transition-colors">
      {/* Avatar + name + email */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
            {user.display_name.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="text-sm font-medium leading-tight">{user.display_name}</p>
            <p className="text-xs text-muted-foreground">{user.email}</p>
          </div>
        </div>
      </td>

      {/* Role (editable) */}
      <td className="px-4 py-3">
        <select
          value={user.role}
          onChange={(e) => updateMutation.mutate({ role: e.target.value })}
          disabled={updateMutation.isPending}
          className="rounded-md border bg-background px-2 py-1 text-xs disabled:opacity-50"
          title="Change role"
        >
          <option value="user">User</option>
          <option value="manager">Manager</option>
          <option value="admin">Admin</option>
          <option value="readonly">Read Only</option>
        </select>
        <span className="ml-2 hidden sm:inline">
          <RoleBadge role={user.role} />
        </span>
      </td>

      {/* Active toggle */}
      <td className="px-4 py-3">
        <button
          onClick={() => updateMutation.mutate({ is_active: !user.is_active })}
          disabled={updateMutation.isPending}
          title={user.is_active ? "Deactivate user" : "Activate user"}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50",
            user.is_active
              ? "bg-green-100 text-green-800 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-300"
              : "bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400",
          )}
        >
          {user.is_active ? (
            <ToggleRight className="h-3.5 w-3.5" />
          ) : (
            <ToggleLeft className="h-3.5 w-3.5" />
          )}
          {user.is_active ? "Active" : "Inactive"}
        </button>
      </td>

      {/* Regulatory write access */}
      <td className="px-4 py-3">
        {user.role === "admin" ? (
          <span
            title="Admins always have regulatory write access"
            className="inline-flex items-center gap-1.5 rounded-md bg-purple-100 px-2.5 py-1 text-xs font-medium text-purple-800 dark:bg-purple-900/30 dark:text-purple-300"
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            Always
          </span>
        ) : (
          <button
            onClick={() => updateMutation.mutate({ can_write_regulatory: !user.can_write_regulatory })}
            disabled={updateMutation.isPending}
            title={
              user.can_write_regulatory
                ? "Revoke regulatory write access"
                : "Grant regulatory write access"
            }
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50",
              user.can_write_regulatory
                ? "bg-blue-100 text-blue-800 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-300"
                : "bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400",
            )}
          >
            {user.can_write_regulatory ? (
              <ToggleRight className="h-3.5 w-3.5" />
            ) : (
              <ToggleLeft className="h-3.5 w-3.5" />
            )}
            {user.can_write_regulatory ? "Read / Write" : "Read only"}
          </button>
        )}
      </td>

      {/* Joined */}
      <td className="hidden px-4 py-3 text-xs text-muted-foreground md:table-cell">
        {joinDate}
      </td>
    </tr>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export function UsersPage() {
  const [showInvite, setShowInvite] = useState(false);
  const [roleFilter, setRoleFilter] = useState("all");

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: listUsers,
    staleTime: 30_000,
  });

  const filtered = roleFilter === "all" ? users : users.filter((u) => u.role === roleFilter);

  const counts = {
    total: users.length,
    active: users.filter((u) => u.is_active).length,
    admins: users.filter((u) => u.role === "admin").length,
  };

  return (
    <div className="flex flex-col gap-6 p-6 max-w-5xl mx-auto">
      {showInvite && <InviteModal onClose={() => setShowInvite(false)} />}

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="h-6 w-6" />
            User Management
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {counts.active} active · {counts.total} total · {counts.admins} admin
            {counts.admins !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          onClick={() => setShowInvite(true)}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <UserPlus className="h-4 w-4" />
          Invite User
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total Users", value: counts.total },
          { label: "Active", value: counts.active },
          { label: "Administrators", value: counts.admins },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-xl border bg-card p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-bold">{value}</p>
          </div>
        ))}
      </div>

      {/* Filter */}
      <div className="flex gap-1 rounded-lg border bg-muted p-1 w-fit">
        {["all", "admin", "manager", "user", "readonly"].map((r) => (
          <button
            key={r}
            onClick={() => setRoleFilter(r)}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors",
              roleFilter === r
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {r === "all" ? "All Roles" : r}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading users…
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground">
            <Users className="h-8 w-8 mx-auto mb-3 opacity-30" />
            <p className="text-sm font-medium">No users found</p>
            {roleFilter !== "all" && (
              <p className="text-xs mt-1">No users with role "{roleFilter}"</p>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                  User
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                  Role
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                  Status
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                  Regulatory
                </th>
                <th className="hidden px-4 py-2.5 text-left text-xs font-medium text-muted-foreground md:table-cell">
                  Joined
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <UserRow key={u.id} user={u} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Access control compliant with FDA 21 CFR Part 11 § 11.300 — unique identifiers, role-based
        authorization, and account deactivation without deletion of audit records.
      </p>
    </div>
  );
}
