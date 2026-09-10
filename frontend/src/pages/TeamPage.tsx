/**
 * Team — people talking to people. Channels on the left (Everyone, your
 * projects, groups, direct messages), the open thread on the right. Everything
 * here is on the hub; without a hub connection there is nobody to talk to.
 */
import { useEffect, useMemo, useState } from "react";
import { NavLink, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FolderOpen,
  Globe2,
  Hash,
  Loader2,
  MessageCircle,
  Plus,
  Search,
  Settings2,
  UserPlus,
  Users,
  X,
} from "lucide-react";

import {
  createGroup,
  ensureProjectChannel,
  listChannels,
  listPeople,
  openDirectMessage,
  updateChannel,
  type Person,
  type TeamChannel,
} from "@/api/team";
import { TeamChannelView } from "@/components/team/TeamChannelView";
import { apiErrorText } from "@/components/waiting/WaitingForYou";
import { useAllProjects, useHubConnected } from "@/hooks/useAllWork";
import { formatAgo } from "@/lib/formatWhen";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";
import { useRecentPlace } from "@/stores/recentPlacesStore";
import { useToastStore } from "@/stores/toastStore";

const KIND_ICON = {
  global: Globe2,
  project: FolderOpen,
  group: Hash,
  dm: MessageCircle,
} as const;

export function TeamPage() {
  const hub = useHubConnected();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("channel");
  const qc = useQueryClient();
  const toast = useToastStore((s) => s.push);
  const me = useAuthStore((s) => s.user);
  const [filter, setFilter] = useState("");
  const [creating, setCreating] = useState<"group" | "dm" | null>(null);
  const [managing, setManaging] = useState(false);
  useRecentPlace("Team", "team", "/team");

  const channels = useQuery({
    queryKey: ["team", "channels"],
    queryFn: listChannels,
    enabled: hub,
    refetchInterval: 15_000,
    retry: false,
  });
  const { projects } = useAllProjects();
  const hubProjects = useMemo(() => projects.filter((p) => p.source === "hub" && !p.is_archived), [projects]);

  const select = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("channel", id);
    else next.delete("channel");
    setParams(next, { replace: true });
    setManaging(false);
  };

  // Land on Everyone when nothing is chosen.
  useEffect(() => {
    if (!selectedId && channels.data?.length) select(channels.data[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels.data, selectedId]);

  const openProject = useMutation({
    mutationFn: (projectId: string) => ensureProjectChannel(projectId),
    onSuccess: (ch) => {
      qc.invalidateQueries({ queryKey: ["team", "channels"] });
      select(ch.id);
    },
    onError: (e) => toast("error", apiErrorText(e, "That project's channel could not be opened.")),
  });

  const selected = channels.data?.find((c) => c.id === selectedId) ?? null;
  const visible = (channels.data ?? []).filter(
    (c) => !filter || c.name.toLowerCase().includes(filter.toLowerCase()),
  );
  const byKind = (kind: TeamChannel["kind"]) => visible.filter((c) => c.kind === kind);
  const projectsWithoutChannel = hubProjects.filter(
    (p) => !(channels.data ?? []).some((c) => c.project_id === p.id),
  );

  if (!hub) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <Users className="mx-auto h-10 w-10 text-muted-foreground/60" />
        <h1 className="mt-4 text-xl font-bold">Team</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Team chat lives on the hub, so everyone reads the same conversation. Connect this computer to the hub
          first.
        </p>
        <NavLink to="/settings?section=hub" className="mt-4 inline-block rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
          Open Settings
        </NavLink>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 gap-0 overflow-hidden rounded-xl border bg-card">
      {/* ── channel list ── */}
      <aside className="flex w-72 shrink-0 flex-col border-r">
        <div className="flex items-center gap-1 border-b p-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Find a channel"
              className="w-full rounded-md border bg-background py-1.5 pl-7 pr-2 text-sm"
            />
          </div>
          <button
            type="button"
            title="New group"
            onClick={() => setCreating("group")}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {channels.isLoading && <p className="px-3 py-2 text-xs text-muted-foreground">Loading…</p>}
          {channels.isError && (
            <p className="px-3 py-2 text-xs text-destructive">{apiErrorText(channels.error, "The hub did not answer.")}</p>
          )}

          <Section title="Everyone">
            {byKind("global").map((c) => (
              <ChannelRow key={c.id} c={c} active={c.id === selectedId} onClick={() => select(c.id)} />
            ))}
          </Section>

          <Section
            title="Projects"
            action={
              projectsWithoutChannel.length > 0 ? (
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) openProject.mutate(e.target.value);
                  }}
                  className="max-w-[8rem] rounded border bg-background px-1 py-0.5 text-[11px] text-muted-foreground"
                  title="Start a project's channel"
                >
                  <option value="">Start…</option>
                  {projectsWithoutChannel.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              ) : null
            }
          >
            {byKind("project").map((c) => (
              <ChannelRow key={c.id} c={c} active={c.id === selectedId} onClick={() => select(c.id)} />
            ))}
            {byKind("project").length === 0 && (
              <p className="px-3 py-1 text-[11px] text-muted-foreground">
                {hubProjects.length ? "No project channel yet — start one above." : "No hub projects yet."}
              </p>
            )}
          </Section>

          <Section
            title="Groups"
            action={
              <button type="button" onClick={() => setCreating("group")} className="text-[11px] text-muted-foreground hover:text-foreground">
                + New
              </button>
            }
          >
            {byKind("group").map((c) => (
              <ChannelRow key={c.id} c={c} active={c.id === selectedId} onClick={() => select(c.id)} />
            ))}
            {byKind("group").length === 0 && <p className="px-3 py-1 text-[11px] text-muted-foreground">No groups yet.</p>}
          </Section>

          <Section
            title="People"
            action={
              <button type="button" onClick={() => setCreating("dm")} className="text-[11px] text-muted-foreground hover:text-foreground">
                + Message
              </button>
            }
          >
            {byKind("dm").map((c) => (
              <ChannelRow key={c.id} c={c} active={c.id === selectedId} onClick={() => select(c.id)} />
            ))}
            {byKind("dm").length === 0 && <p className="px-3 py-1 text-[11px] text-muted-foreground">No direct messages yet.</p>}
          </Section>
        </div>
      </aside>

      {/* ── thread ── */}
      <section className="flex min-w-0 flex-1 flex-col">
        {selected ? (
          <>
            <header className="flex items-center gap-2 border-b px-4 py-2">
              {(() => {
                const Icon = KIND_ICON[selected.kind];
                return <Icon className="h-4 w-4 text-muted-foreground" />;
              })()}
              <h1 className="truncate text-base font-semibold">{selected.name}</h1>
              <span className="text-xs text-muted-foreground" title={selected.members.map((m) => m.display_name).join(", ")}>
                {selected.members.length} {selected.members.length === 1 ? "person" : "people"}
              </span>
              {selected.kind === "project" && selected.project_id && (
                <NavLink
                  to={`/hub/projects/${selected.project_id}/space`}
                  className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                >
                  Open project
                </NavLink>
              )}
              {selected.kind === "group" && (
                <button
                  type="button"
                  title="Rename, add or remove people"
                  onClick={() => setManaging((v) => !v)}
                  className="ml-auto rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Settings2 className="h-4 w-4" />
                </button>
              )}
            </header>
            {managing && selected.kind === "group" && (
              <ManageGroup
                channel={selected}
                meId={me?.id ?? ""}
                onDone={() => setManaging(false)}
                onLeft={() => select(null)}
              />
            )}
            <TeamChannelView key={selected.id} channel={selected} autoFocus />
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            {channels.isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Pick a channel."}
          </div>
        )}
      </section>

      {creating && (
        <NewChannelDialog
          kind={creating}
          meId={me?.id ?? ""}
          onClose={() => setCreating(null)}
          onCreated={(ch) => {
            setCreating(null);
            qc.invalidateQueries({ queryKey: ["team", "channels"] });
            select(ch.id);
          }}
        />
      )}
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <div className="flex items-center justify-between px-3 pb-0.5 pt-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
        {action}
      </div>
      {children}
    </div>
  );
}

function ChannelRow({ c, active, onClick }: { c: TeamChannel; active: boolean; onClick: () => void }) {
  const Icon = KIND_ICON[c.kind];
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-accent/60",
        active && "bg-primary/10",
      )}
    >
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={cn("truncate text-sm", c.unread > 0 ? "font-semibold" : "font-medium")}>{c.name}</span>
          {c.last_message_at && (
            <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{formatAgo(c.last_message_at)}</span>
          )}
        </span>
        {c.last_message_preview && (
          <span className="block truncate text-[11px] text-muted-foreground">{c.last_message_preview}</span>
        )}
      </span>
      {c.unread > 0 && (
        <span className="mt-0.5 flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold leading-none text-primary-foreground">
          {c.unread > 99 ? "99+" : c.unread}
        </span>
      )}
    </button>
  );
}

// ── new group / direct message ───────────────────────────────────────────────

function PeoplePicker({
  exclude,
  selected,
  onToggle,
  single,
}: {
  exclude: Set<string>;
  selected: Set<string>;
  onToggle: (p: Person) => void;
  single?: boolean;
}) {
  const [q, setQ] = useState("");
  const people = useQuery({ queryKey: ["team", "people"], queryFn: listPeople, staleTime: 60_000 });
  const rows = (people.data ?? []).filter(
    (p) => !exclude.has(p.id) && (p.display_name.toLowerCase().includes(q.toLowerCase()) || p.email.toLowerCase().includes(q.toLowerCase())),
  );
  return (
    <div>
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search people"
        className="mb-2 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
      />
      <ul className="max-h-56 overflow-y-auto rounded-md border">
        {people.isLoading && <li className="px-3 py-2 text-xs text-muted-foreground">Loading…</li>}
        {rows.map((p) => {
          const on = selected.has(p.id);
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onToggle(p)}
                className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent", on && "bg-primary/10")}
              >
                <input type={single ? "radio" : "checkbox"} readOnly checked={on} className="h-3.5 w-3.5" />
                <span className="truncate">{p.display_name}</span>
                <span className="ml-auto truncate text-xs text-muted-foreground">{p.email}</span>
              </button>
            </li>
          );
        })}
        {!people.isLoading && rows.length === 0 && <li className="px-3 py-2 text-xs text-muted-foreground">Nobody found.</li>}
      </ul>
    </div>
  );
}

function NewChannelDialog({
  kind,
  meId,
  onClose,
  onCreated,
}: {
  kind: "group" | "dm";
  meId: string;
  onClose: () => void;
  onCreated: (ch: TeamChannel) => void;
}) {
  const toast = useToastStore((s) => s.push);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const create = useMutation({
    mutationFn: () =>
      kind === "dm" ? openDirectMessage([...picked][0]) : createGroup(name.trim(), [...picked]),
    onSuccess: onCreated,
    onError: (e) => toast("error", apiErrorText(e, "That could not be created.")),
  });
  const ok = kind === "dm" ? picked.size === 1 : name.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border bg-card p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            {kind === "dm" ? <MessageCircle className="h-4 w-4" /> : <Hash className="h-4 w-4" />}
            {kind === "dm" ? "Message someone" : "New group"}
          </h2>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-accent" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        {kind === "group" && (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Group name"
            className="mb-3 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          />
        )}
        <PeoplePicker
          exclude={new Set([meId])}
          selected={picked}
          single={kind === "dm"}
          onToggle={(p) =>
            setPicked((prev) => {
              const next = new Set(kind === "dm" ? [] : prev);
              if (prev.has(p.id) && kind !== "dm") next.delete(p.id);
              else next.add(p.id);
              return next;
            })
          }
        />
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border px-3 py-1.5 text-sm">
            Cancel
          </button>
          <button
            type="button"
            disabled={!ok || create.isPending}
            onClick={() => create.mutate()}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {create.isPending ? "Creating…" : kind === "dm" ? "Open" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ManageGroup({
  channel,
  meId,
  onDone,
  onLeft,
}: {
  channel: TeamChannel;
  meId: string;
  onDone: () => void;
  onLeft: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToastStore((s) => s.push);
  const [name, setName] = useState(channel.name);
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const members = new Set(channel.members.map((m) => m.id));
  const update = useMutation({
    mutationFn: (body: Parameters<typeof updateChannel>[1]) => updateChannel(channel.id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team", "channels"] });
      setAdding(false);
      setPicked(new Set());
    },
    onError: (e) => toast("error", apiErrorText(e, "The group could not be changed.")),
  });

  return (
    <div className="border-b bg-muted/30 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs">
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-0.5 block w-56 rounded-md border bg-background px-2 py-1 text-sm"
          />
        </label>
        <button
          type="button"
          disabled={!name.trim() || name.trim() === channel.name || update.isPending}
          onClick={() => update.mutate({ name: name.trim() })}
          className="rounded-md border px-2.5 py-1 text-xs hover:bg-accent disabled:opacity-50"
        >
          Rename
        </button>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs hover:bg-accent"
        >
          <UserPlus className="h-3.5 w-3.5" /> Add people
        </button>
        <button
          type="button"
          onClick={() => {
            if (window.confirm("Leave this group? You will stop seeing its messages.")) {
              update.mutate({ remove_member_ids: [meId] }, { onSuccess: onLeft });
            }
          }}
          className="rounded-md border px-2.5 py-1 text-xs text-destructive hover:bg-destructive/10"
        >
          Leave group
        </button>
        <button type="button" onClick={onDone} className="ml-auto rounded p-1 hover:bg-accent" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {channel.members.map((m) => (
          <span key={m.id} className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-xs">
            {m.display_name}
            {m.id !== meId && (
              <button
                type="button"
                title={`Remove ${m.display_name}`}
                onClick={() => update.mutate({ remove_member_ids: [m.id] })}
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        ))}
      </div>
      {adding && (
        <div className="mt-2 max-w-md">
          <PeoplePicker
            exclude={members}
            selected={picked}
            onToggle={(p) =>
              setPicked((prev) => {
                const next = new Set(prev);
                if (next.has(p.id)) next.delete(p.id);
                else next.add(p.id);
                return next;
              })
            }
          />
          <button
            type="button"
            disabled={picked.size === 0 || update.isPending}
            onClick={() => update.mutate({ add_member_ids: [...picked] })}
            className="mt-2 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            Add {picked.size || ""}
          </button>
        </div>
      )}
    </div>
  );
}
