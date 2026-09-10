/**
 * One team channel: the thread and the composer. Used by the Team page and by
 * a hub project's Team tab. The hub cannot push, so the thread polls — every
 * 4 s for rows created, edited or deleted since the newest one we hold.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AtSign,
  Check,
  Download,
  FileText,
  Link2,
  ListTodo,
  Loader2,
  Paperclip,
  Pencil,
  Send,
  Trash2,
  X,
} from "lucide-react";

import {
  MAX_ATTACHMENT_BYTES,
  deleteMessage,
  editMessage,
  fetchAttachmentBlob,
  listMessages,
  markChannelRead,
  postMessage,
  uploadAttachment,
  type Person,
  type TeamAttachment,
  type TeamChannel,
  type TeamMessage,
  type TeamRef,
} from "@/api/team";
import { ArtifactChips } from "@/components/chat/MessageBubble";
import { apiErrorText } from "@/components/waiting/WaitingForYou";
import { useAllTasks } from "@/hooks/useAllWork";
import { formatAgo } from "@/lib/formatWhen";
import { hasNativeSaveFile, saveFileNative } from "@/lib/externalLinks";
import { cn } from "@/lib/utils";
import { useToastStore } from "@/stores/toastStore";

const POLL_MS = 4_000;

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

async function downloadAttachment(att: TeamAttachment) {
  const blob = await fetchAttachmentBlob(att);
  if (hasNativeSaveFile()) {
    const saved = await saveFileNative(att.name, await blobToDataURL(blob), false);
    if (saved) return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = att.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Merge a poll page into what we hold: replace edited/deleted rows, append new ones. */
function merge(prev: TeamMessage[], incoming: TeamMessage[]): TeamMessage[] {
  if (incoming.length === 0) return prev;
  const byId = new Map(prev.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

function newest(rows: TeamMessage[]): string | undefined {
  let best: string | undefined;
  for (const m of rows) {
    for (const t of [m.created_at, m.edited_at, m.deleted_at]) {
      if (t && (!best || t > best)) best = t;
    }
  }
  return best;
}

// ── one message ──────────────────────────────────────────────────────────────

function MessageRow({
  m,
  people,
  onEdit,
  onDelete,
}: {
  m: TeamMessage;
  people: Person[];
  onEdit: (id: string, content: string) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.content);
  const [busyFile, setBusyFile] = useState<string | null>(null);
  const toast = useToastStore((s) => s.push);
  const mentionedNames = useMemo(
    () => new Set(people.filter((p) => m.mentions.includes(p.id)).map((p) => p.display_name)),
    [people, m.mentions],
  );
  const name = m.author?.display_name ?? "Someone";
  const initials = name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="group flex gap-3 px-4 py-2 hover:bg-accent/40">
      <div
        className={cn(
          "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
          m.mine ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
        )}
        title={m.author?.email}
      >
        {initials || "?"}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold">{m.mine ? "You" : name}</span>
          <span className="text-[11px] text-muted-foreground" title={new Date(m.created_at).toLocaleString()}>
            {formatAgo(m.created_at)}
          </span>
          {m.edited_at && !m.deleted_at && <span className="text-[11px] text-muted-foreground">(edited)</span>}
          {m.mine && !m.deleted_at && !editing && (
            <span className="ml-auto hidden items-center gap-1 group-hover:flex">
              <button
                type="button"
                title="Edit"
                onClick={() => {
                  setDraft(m.content);
                  setEditing(true);
                }}
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                title="Delete"
                onClick={() => {
                  if (window.confirm("Delete this message for everyone?")) onDelete(m.id);
                }}
                className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </span>
          )}
        </div>

        {m.deleted_at ? (
          <p className="text-sm italic text-muted-foreground">Message deleted.</p>
        ) : editing ? (
          <div className="mt-1">
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setEditing(false);
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (draft.trim()) {
                    onEdit(m.id, draft.trim());
                    setEditing(false);
                  }
                }
              }}
              rows={Math.min(8, Math.max(2, draft.split("\n").length))}
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
            <div className="mt-1 flex gap-2 text-[11px]">
              <button
                type="button"
                onClick={() => {
                  if (draft.trim()) {
                    onEdit(m.id, draft.trim());
                    setEditing(false);
                  }
                }}
                className="flex items-center gap-1 rounded-md bg-primary px-2 py-1 font-medium text-primary-foreground"
              >
                <Check className="h-3 w-3" /> Save
              </button>
              <button type="button" onClick={() => setEditing(false)} className="rounded-md border px-2 py-1">
                Cancel
              </button>
              <span className="self-center text-muted-foreground">Enter saves · Shift+Enter for a new line</span>
            </div>
          </div>
        ) : (
          <>
            {m.content && (
              <div className="prose prose-sm max-w-none break-words dark:prose-invert prose-p:my-1 prose-pre:my-2 prose-ul:my-1 prose-ol:my-1">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    a: ({ href, children }) => (
                      <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                        {children}
                      </a>
                    ),
                    // Highlight the names this message pinged.
                    p: ({ children }) => <p>{highlightMentions(children, mentionedNames)}</p>,
                  }}
                >
                  {m.content}
                </ReactMarkdown>
              </div>
            )}
            {m.attachments.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {m.attachments.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    disabled={busyFile === a.id}
                    onClick={async () => {
                      setBusyFile(a.id);
                      try {
                        await downloadAttachment(a);
                      } catch (e) {
                        toast("error", apiErrorText(e, "That file could not be fetched from the hub."));
                      } finally {
                        setBusyFile(null);
                      }
                    }}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-md border bg-background px-2.5 py-1 text-xs hover:bg-accent disabled:opacity-60"
                    title={`${a.name} · ${bytes(a.size)}`}
                  >
                    {busyFile === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5 text-muted-foreground" />}
                    <span className="truncate">{a.name}</span>
                    <span className="text-muted-foreground">{bytes(a.size)}</span>
                    <Download className="h-3 w-3 text-muted-foreground" />
                  </button>
                ))}
              </div>
            )}
            {m.refs.length > 0 && (
              <ArtifactChips
                artifacts={m.refs.map((r) => ({
                  type: "artifact_link" as const,
                  tool: r.kind,
                  label: r.label,
                  route: r.route,
                  url: r.url,
                }))}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function highlightMentions(children: React.ReactNode, names: Set<string>): React.ReactNode {
  if (names.size === 0) return children;
  const pattern = new RegExp(`@(${[...names].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
  const walk = (node: React.ReactNode): React.ReactNode => {
    if (typeof node === "string") {
      const parts = node.split(pattern);
      if (parts.length === 1) return node;
      return parts.map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="rounded bg-primary/15 px-1 font-medium text-primary">
            @{part}
          </span>
        ) : (
          part
        ),
      );
    }
    if (Array.isArray(node)) return node.map((n, i) => <span key={i}>{walk(n)}</span>);
    return node;
  };
  return walk(children);
}

// ── the view ─────────────────────────────────────────────────────────────────

export function TeamChannelView({
  channel,
  className,
  autoFocus,
}: {
  channel: TeamChannel;
  className?: string;
  autoFocus?: boolean;
}) {
  const qc = useQueryClient();
  const toast = useToastStore((s) => s.push);
  const [rows, setRows] = useState<TeamMessage[]>([]);
  const [hasEarlier, setHasEarlier] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // First page.
  const first = useQuery({
    queryKey: ["team", "messages", channel.id],
    queryFn: () => listMessages(channel.id, { limit: 50 }),
    staleTime: Infinity,
  });
  useEffect(() => {
    if (first.data) {
      setRows(first.data);
      setHasEarlier(first.data.length >= 50);
      stickToBottom.current = true;
    }
  }, [first.data]);

  // Poll for anything newer than what we hold.
  const since = newest(rows);
  useQuery({
    queryKey: ["team", "messages", channel.id, "poll", since ?? ""],
    queryFn: async () => {
      const page = await listMessages(channel.id, since ? { after: since, limit: 200 } : { limit: 50 });
      if (page.length) setRows((prev) => merge(prev, page));
      return page.length;
    },
    enabled: first.isSuccess,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });

  // Mark read on open and whenever a new row arrives while we are looking.
  const lastCount = useRef(0);
  useEffect(() => {
    if (!first.isSuccess) return;
    if (rows.length === lastCount.current && lastCount.current !== 0) return;
    lastCount.current = rows.length;
    void markChannelRead(channel.id)
      .then(() => {
        qc.invalidateQueries({ queryKey: ["team", "channels"] });
        qc.invalidateQueries({ queryKey: ["team", "unread"] });
      })
      .catch(() => undefined);
  }, [rows.length, first.isSuccess, channel.id, qc]);

  useEffect(() => {
    if (stickToBottom.current) endRef.current?.scrollIntoView({ block: "end" });
  }, [rows]);

  const loadEarlier = async () => {
    if (!rows.length) return;
    setLoadingEarlier(true);
    const el = listRef.current;
    const before = el ? el.scrollHeight - el.scrollTop : 0;
    try {
      const page = await listMessages(channel.id, { before: rows[0].created_at, limit: 50 });
      setHasEarlier(page.length >= 50);
      stickToBottom.current = false;
      setRows((prev) => merge(prev, page));
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - before;
      });
    } finally {
      setLoadingEarlier(false);
    }
  };

  const send = useMutation({
    mutationFn: (body: Parameters<typeof postMessage>[1]) => postMessage(channel.id, body),
    onSuccess: (m) => {
      stickToBottom.current = true;
      setRows((prev) => merge(prev, [m]));
      qc.invalidateQueries({ queryKey: ["team", "channels"] });
    },
    onError: (e) => toast("error", apiErrorText(e, "The message did not send.")),
  });
  const edit = useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) => editMessage(id, content),
    onSuccess: (m) => setRows((prev) => merge(prev, [m])),
    onError: (e) => toast("error", apiErrorText(e, "The edit did not save.")),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteMessage(id),
    onSuccess: (m) => setRows((prev) => merge(prev, [m])),
    onError: (e) => toast("error", apiErrorText(e, "The message could not be deleted.")),
  });

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-y-auto py-2"
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {first.isLoading && <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p>}
        {first.isError && (
          <p className="px-4 py-6 text-sm text-destructive">{apiErrorText(first.error, "The hub did not answer.")}</p>
        )}
        {hasEarlier && (
          <div className="flex justify-center py-1">
            <button
              type="button"
              disabled={loadingEarlier}
              onClick={() => void loadEarlier()}
              className="rounded-md border px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-accent disabled:opacity-50"
            >
              {loadingEarlier ? "Loading…" : "Load earlier"}
            </button>
          </div>
        )}
        {first.isSuccess && rows.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            Nothing here yet. Say hello.
          </div>
        )}
        {rows.map((m) => (
          <MessageRow
            key={m.id}
            m={m}
            people={channel.members}
            onEdit={(id, content) => edit.mutate({ id, content })}
            onDelete={(id) => remove.mutate(id)}
          />
        ))}
        <div ref={endRef} />
      </div>
      <Composer
        channel={channel}
        busy={send.isPending}
        autoFocus={autoFocus}
        onSend={(body) => send.mutate(body)}
      />
    </div>
  );
}

// ── composer ─────────────────────────────────────────────────────────────────

function Composer({
  channel,
  busy,
  autoFocus,
  onSend,
}: {
  channel: TeamChannel;
  busy: boolean;
  autoFocus?: boolean;
  onSend: (body: Parameters<typeof postMessage>[1]) => void;
}) {
  const toast = useToastStore((s) => s.push);
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<TeamAttachment[]>([]);
  const [refs, setRefs] = useState<TeamRef[]>([]);
  const [mentioned, setMentioned] = useState<Person[]>([]);
  const [uploading, setUploading] = useState(0);
  const [picker, setPicker] = useState<"mention" | "task" | "link" | null>(null);
  const [filter, setFilter] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { tasks } = useAllTasks();

  const others = channel.members;
  const mentionChoices = others.filter((p) => p.display_name.toLowerCase().includes(filter.toLowerCase()));
  // Only tasks on the hub can be opened by whoever reads this; a local task is on one computer.
  const taskChoices = tasks
    .filter((t) => t.source === "hub" && t.title.toLowerCase().includes(filter.toLowerCase()))
    .slice(0, 12);

  const addFiles = async (files: FileList | File[]) => {
    for (const f of Array.from(files)) {
      if (f.size > MAX_ATTACHMENT_BYTES) {
        toast("error", `${f.name} is over 15 MB. Share a Drive link instead.`);
        continue;
      }
      setUploading((n) => n + 1);
      try {
        const att = await uploadAttachment(channel.id, f);
        setAttachments((prev) => [...prev, att]);
      } catch (e) {
        toast("error", apiErrorText(e, `${f.name} could not be uploaded.`));
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  const insertMention = (p: Person) => {
    const ta = taRef.current;
    const token = `@${p.display_name} `;
    if (ta) {
      const start = ta.selectionStart ?? text.length;
      // Replace a half-typed "@abc" before the caret if there is one.
      const head = text.slice(0, start).replace(/@[^\s@]*$/, "");
      const next = head + token + text.slice(start);
      setText(next);
      requestAnimationFrame(() => {
        ta.focus();
        ta.selectionStart = ta.selectionEnd = head.length + token.length;
      });
    } else {
      setText((t) => t + token);
    }
    setMentioned((prev) => (prev.some((x) => x.id === p.id) ? prev : [...prev, p]));
    setPicker(null);
    setFilter("");
  };

  const canSend = !busy && uploading === 0 && (text.trim() || attachments.length || refs.length);

  const submit = () => {
    if (!canSend) return;
    // A name removed from the text is not a mention any more.
    const mention_ids = mentioned.filter((p) => text.includes(`@${p.display_name}`)).map((p) => p.id);
    onSend({ content: text.trim(), attachments, refs, mention_ids });
    setText("");
    setAttachments([]);
    setRefs([]);
    setMentioned([]);
  };

  return (
    <div
      className="border-t p-2"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
      }}
    >
      {(attachments.length > 0 || refs.length > 0 || uploading > 0) && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {attachments.map((a) => (
            <span key={a.id} className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-0.5 text-xs">
              <Paperclip className="h-3 w-3 text-muted-foreground" />
              <span className="max-w-[16rem] truncate">{a.name}</span>
              <span className="text-muted-foreground">{bytes(a.size)}</span>
              <button type="button" onClick={() => setAttachments((p) => p.filter((x) => x.id !== a.id))} aria-label="Remove">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {refs.map((r, i) => (
            <span key={`${r.kind}-${i}`} className="inline-flex items-center gap-1 rounded-full border border-primary/50 px-2 py-0.5 text-xs text-primary">
              {r.kind === "task" ? <ListTodo className="h-3 w-3" /> : <Link2 className="h-3 w-3" />}
              <span className="max-w-[16rem] truncate">{r.label}</span>
              <button type="button" onClick={() => setRefs((p) => p.filter((_, j) => j !== i))} aria-label="Remove">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {uploading > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Uploading…
            </span>
          )}
        </div>
      )}

      {picker && (
        <div className="mb-2 rounded-md border bg-popover p-2 text-sm shadow-md">
          {picker === "link" ? (
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex-1 text-xs">
                Address
                <input
                  autoFocus
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="https://…"
                  className="mt-0.5 w-full rounded-md border bg-background px-2 py-1 text-sm"
                />
              </label>
              <label className="flex-1 text-xs">
                Shown as
                <input
                  value={linkLabel}
                  onChange={(e) => setLinkLabel(e.target.value)}
                  placeholder="Term sheet (Drive)"
                  className="mt-0.5 w-full rounded-md border bg-background px-2 py-1 text-sm"
                />
              </label>
              <button
                type="button"
                disabled={!/^https?:\/\/\S+/.test(linkUrl.trim())}
                onClick={() => {
                  const url = linkUrl.trim();
                  setRefs((p) => [...p, { kind: "url", label: (linkLabel.trim() || url).slice(0, 200), url }]);
                  setLinkUrl("");
                  setLinkLabel("");
                  setPicker(null);
                }}
                className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
              >
                Add link
              </button>
              <button type="button" onClick={() => setPicker(null)} className="rounded-md border px-2 py-1 text-xs">
                Cancel
              </button>
            </div>
          ) : (
            <>
              <input
                autoFocus
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setPicker(null);
                }}
                placeholder={picker === "mention" ? "Who?" : "Which task? (hub projects only)"}
                className="mb-1 w-full rounded-md border bg-background px-2 py-1 text-sm"
              />
              <ul className="max-h-48 overflow-y-auto">
                {picker === "mention" &&
                  mentionChoices.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => insertMention(p)}
                        className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-accent"
                      >
                        <AtSign className="h-3.5 w-3.5 text-muted-foreground" />
                        {p.display_name}
                        <span className="text-xs text-muted-foreground">{p.email}</span>
                      </button>
                    </li>
                  ))}
                {picker === "task" &&
                  taskChoices.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setRefs((p) => [
                            ...p,
                            { kind: "task", id: t.id, label: t.title.slice(0, 200), route: `/tasks?task=${t.id}` },
                          ]);
                          setPicker(null);
                          setFilter("");
                        }}
                        className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-accent"
                      >
                        <ListTodo className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="truncate">{t.title}</span>
                        <span className="ml-auto text-xs text-muted-foreground">{t.status.replace("_", " ")}</span>
                      </button>
                    </li>
                  ))}
                {picker === "mention" && mentionChoices.length === 0 && (
                  <li className="px-2 py-1 text-xs text-muted-foreground">Nobody by that name here.</li>
                )}
                {picker === "task" && taskChoices.length === 0 && (
                  <li className="px-2 py-1 text-xs text-muted-foreground">No hub task by that name.</li>
                )}
              </ul>
            </>
          )}
        </div>
      )}

      <div className="flex items-end gap-2">
        <textarea
          ref={taRef}
          autoFocus={autoFocus}
          value={text}
          disabled={busy}
          onChange={(e) => {
            setText(e.target.value);
            const caret = e.target.selectionStart ?? e.target.value.length;
            const m = /(^|\s)@([^\s@]*)$/.exec(e.target.value.slice(0, caret));
            if (m) {
              setPicker("mention");
              setFilter(m[2]);
            } else if (picker === "mention") {
              setPicker(null);
              setFilter("");
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && picker !== "mention") {
              e.preventDefault();
              submit();
            }
            if (e.key === "Enter" && picker === "mention" && mentionChoices.length > 0) {
              e.preventDefault();
              insertMention(mentionChoices[0]);
            }
            if (e.key === "Escape") setPicker(null);
          }}
          onPaste={(e) => {
            if (e.clipboardData.files.length) {
              e.preventDefault();
              void addFiles(e.clipboardData.files);
            }
          }}
          placeholder={`Message ${channel.name} — Enter sends, Shift+Enter for a new line, @ to mention`}
          rows={Math.min(8, Math.max(1, text.split("\n").length))}
          className="min-h-[38px] flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm"
        />
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            title="Mention someone"
            onClick={() => {
              setPicker(picker === "mention" ? null : "mention");
              setFilter("");
            }}
            className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <AtSign className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Attach a file (up to 15 MB)"
            onClick={() => fileRef.current?.click()}
            className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Paperclip className="h-4 w-4" />
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) void addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            title="Link a task"
            onClick={() => {
              setPicker(picker === "task" ? null : "task");
              setFilter("");
            }}
            className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ListTodo className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Add a link"
            onClick={() => setPicker(picker === "link" ? null : "link")}
            className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Link2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={!canSend}
            onClick={submit}
            className="ml-1 flex items-center gap-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
