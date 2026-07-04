import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Inbox,
  Mail,
  MailOpen,
  Paperclip,
  RefreshCw,
  BookPlus,
  Download,
  ExternalLink,
  Reply,
  Send,
  Sparkles,
  PenLine,
  PenSquare,
  ShieldCheck,
  Tag,
  Trash2,
  Loader2,
  ReplyAll,
  X,
} from "lucide-react";
import { apiClient } from "@/api/client";
import { hasNativeSaveFile, saveFileNative, openExternal } from "@/lib/externalLinks";
import { EmailsPage } from "@/pages/EmailsPage";
import { AskGerryButton } from "@/components/AskGerryButton";

const GOOGLE_PREFIX = "/api/google";

// ── Types ──────────────────────────────────────────────────────────────────

interface InboxThread {
  thread_id: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  message_count: number;
  unread: boolean;
  tags?: string[];
}

interface TagData {
  sender: string;
  domain: string;
  contact_tags: string[];
  domain_tags: string[];
}

interface ThreadAttachment {
  filename: string;
  mime_type: string;
  attachment_id: string;
  size: number;
  content_id: string;
  inline: boolean;
}

interface ThreadMessage {
  id: string;
  from: string;
  to: string;
  cc: string;
  subject: string;
  date: string;
  body: string;
  body_html: string;
  attachments: ThreadAttachment[];
}

interface ThreadDetail {
  thread_id: string;
  subject: string;
  me?: string;
  messages: ThreadMessage[];
}

interface GoogleStatus {
  connected: boolean;
  status: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function senderName(from: string): string {
  const m = from.match(/^\s*"?([^"<]+?)"?\s*<.*>$/);
  return (m ? m[1] : from).trim() || from;
}

function emailOf(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim();
}

/** Split a comma-separated address header into individual address strings. */
function splitAddresses(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function replySubject(subject: string): string {
  const t = (subject || "").trim();
  if (!t) return "Re:";
  return t.toLowerCase().startsWith("re:") ? t : `Re: ${t}`;
}

interface SignatureData {
  mode: "gmail" | "custom" | "none";
  custom: string;
  gmail: string;
}

function resolveSig(data?: SignatureData): string {
  if (!data) return "";
  if (data.mode === "custom") return data.custom || "";
  if (data.mode === "gmail") return data.gmail || "";
  return "";
}

function fmtDate(raw: string): string {
  const d = new Date(raw);
  return isNaN(d.getTime()) ? raw : d.toLocaleString();
}

function getError(e: unknown): string {
  const err = e as { response?: { status?: number; data?: { detail?: unknown } } };
  const detail = err?.response?.data?.detail;
  if (err?.response?.status === 409) {
    return typeof detail === "object" && detail !== null && "message" in detail
      ? String((detail as { message: unknown }).message)
      : "This email is already in the Knowledge Base.";
  }
  if (typeof detail === "string") return detail;
  if (!err?.response) return "Cannot reach the server. Is Little Gerry running?";
  return "Something went wrong. Please try again.";
}

function formatBytes(n: number): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function fetchAttachmentBlob(messageId: string, att: ThreadAttachment): Promise<Blob> {
  const res = await apiClient.get(
    `${GOOGLE_PREFIX}/gmail/message/${messageId}/attachment/${att.attachment_id}`,
    { params: { mime: att.mime_type, filename: att.filename }, responseType: "blob" },
  );
  return res.data as Blob;
}

// ── Message body (HTML in a sandboxed iframe, with cid: inline images) ────────

function EmailFrame({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(80);
  const doc = `<!doctype html><html><head><base target="_blank"><meta charset="utf-8">` +
    `<style>html,body{margin:0;padding:0;}body{font-family:system-ui,sans-serif;` +
    `font-size:14px;line-height:1.5;color:#d4d4d8;background:transparent;` +
    `word-wrap:break-word;overflow-wrap:break-word;}img{max-width:100%;height:auto;}` +
    `a{color:#fbbf24;}table{max-width:100%;}</style></head><body>${html}</body></html>`;
  return (
    <iframe
      ref={ref}
      title="email-body"
      // No allow-scripts: email JavaScript can never execute.
      sandbox="allow-same-origin allow-popups"
      srcDoc={doc}
      onLoad={() => {
        const body = ref.current?.contentDocument?.body;
        if (body) setHeight(body.scrollHeight + 8);
      }}
      style={{ width: "100%", height, border: 0 }}
    />
  );
}

function MessageBody({ message }: { message: ThreadMessage }) {
  const inlineAtts = message.attachments.filter((a) => a.content_id);
  const inline = useQuery({
    queryKey: ["gmail-inline", message.id],
    enabled: !!message.body_html && inlineAtts.length > 0,
    staleTime: Infinity,
    queryFn: async () => {
      const map: Record<string, string> = {};
      for (const a of inlineAtts) {
        try {
          const blob = await fetchAttachmentBlob(message.id, a);
          map[a.content_id] = await blobToDataURL(blob);
        } catch {
          /* skip images that fail to load */
        }
      }
      return map;
    },
  });

  if (!message.body_html) {
    return (
      <p className="text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed">
        {message.body}
      </p>
    );
  }

  const cidMap = inline.data ?? {};
  const html = message.body_html.replace(
    /cid:([^"')\s>]+)/gi,
    (m, cid) => cidMap[cid.trim()] ?? m,
  );
  return <EmailFrame html={html} />;
}

// ── Attachments (image previews + downloads) ─────────────────────────────────

function AttachmentItem({ messageId, att }: { messageId: string; att: ThreadAttachment }) {
  const isImage = att.mime_type.startsWith("image/");
  const blob = useQuery({
    queryKey: ["gmail-att", messageId, att.attachment_id],
    enabled: isImage,
    staleTime: Infinity,
    queryFn: async () => URL.createObjectURL(await fetchAttachmentBlob(messageId, att)),
  });

  async function download() {
    // In the desktop (pywebview) shell, blob-URL anchor downloads silently
    // do nothing — fetch the bytes and save them via the native bridge.
    if (hasNativeSaveFile()) {
      const dataUrl = await blobToDataURL(await fetchAttachmentBlob(messageId, att));
      const saved = await saveFileNative(att.filename, dataUrl, false);
      if (saved) return;
    }
    const url = blob.data ?? URL.createObjectURL(await fetchAttachmentBlob(messageId, att));
    const a = document.createElement("a");
    a.href = url;
    a.download = att.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function openInBrowser() {
    // Desktop shell: save to Downloads and open with the OS default app
    // (window.open on a blob URL does nothing inside the embedded webview).
    if (hasNativeSaveFile()) {
      const dataUrl = await blobToDataURL(await fetchAttachmentBlob(messageId, att));
      const saved = await saveFileNative(att.filename, dataUrl, true);
      if (saved) return;
    }
    const url = blob.data ?? URL.createObjectURL(await fetchAttachmentBlob(messageId, att));
    window.open(url, "_blank", "noopener,noreferrer");
  }

  // Copy the attachment into Google Drive (converting Office/text files into
  // native Google Docs/Sheets/Slides) and open it in the user's browser.
  const openInWorkspace = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post(
        `${GOOGLE_PREFIX}/gmail/message/${messageId}/attachment/${att.attachment_id}/open-in-drive`,
        { filename: att.filename, mime_type: att.mime_type },
        { timeout: 60000 },
      );
      return res.data as { url: string };
    },
    onSuccess: (data) => {
      if (data?.url) openExternal(data.url);
    },
  });

  if (isImage) {
    return (
      <div className="rounded border border-zinc-800 overflow-hidden bg-zinc-900">
        {blob.data ? (
          <img src={blob.data} alt={att.filename} className="max-w-xs max-h-64 object-contain" />
        ) : (
          <div className="w-40 h-24 flex items-center justify-center text-xs text-zinc-500">
            Loading…
          </div>
        )}
        <button
          onClick={download}
          className="w-full text-xs px-2 py-1 text-zinc-400 hover:text-amber-400 flex items-center gap-1.5 border-t border-zinc-800"
        >
          <Download className="w-3 h-3" />
          {att.filename} {att.size ? `(${formatBytes(att.size)})` : ""}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center rounded bg-zinc-800 overflow-hidden">
        <button
          onClick={() => openInWorkspace.mutate()}
          disabled={openInWorkspace.isPending}
          title="Open in Google Workspace"
          className="text-xs px-2 py-1 text-zinc-300 hover:text-amber-400 flex items-center gap-1.5 disabled:opacity-60"
        >
          {openInWorkspace.isPending ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Paperclip className="w-3 h-3" />
          )}
          {att.filename} {att.size ? `(${formatBytes(att.size)})` : ""}
        </button>
        <button
          onClick={openInBrowser}
          title="Open with default app"
          className="px-2 py-1 text-zinc-500 hover:text-amber-400 border-l border-zinc-700"
        >
          <ExternalLink className="w-3 h-3" />
        </button>
        <button
          onClick={download}
          title="Download"
          className="px-2 py-1 text-zinc-500 hover:text-amber-400 border-l border-zinc-700"
        >
          <Download className="w-3 h-3" />
        </button>
        <AskGerryButton
          title="Ask Gerry about this attachment"
          className="px-2 py-1 text-zinc-500 hover:text-amber-400 border-l border-zinc-700"
          build={async () => ({
            title: `Attachment: ${att.filename}`,
            prompt:
              `I'd like your help with this email attachment: "${att.filename}". ` +
              `I've attached it — please read it and give me a summary, then I'll ask follow-ups.`,
            file: { blob: await fetchAttachmentBlob(messageId, att), filename: att.filename },
          })}
        />
      </div>
      {openInWorkspace.isError && (
        <span className="text-[11px] text-red-400 mt-1 px-1">
          Couldn’t open in Google Workspace. Try Download instead.
        </span>
      )}
    </div>
  );
}

function Attachments({ message }: { message: ThreadMessage }) {
  // Show real attachments; skip inline images already rendered in the HTML body.
  const shown = message.attachments.filter(
    (a) => !(a.inline && message.body_html && a.content_id),
  );
  if (shown.length === 0) return null;
  return (
    <div className="mt-3 pt-3 border-t border-zinc-800 flex flex-wrap gap-2 items-start">
      {shown.map((a) => (
        <AttachmentItem key={a.attachment_id} messageId={message.id} att={a} />
      ))}
    </div>
  );
}

const FILTERS: { id: string; label: string; q: string }[] = [
  { id: "inbox", label: "Inbox", q: "in:inbox" },
  { id: "unread", label: "Unread", q: "in:inbox is:unread" },
  { id: "today", label: "Today", q: "in:inbox newer_than:1d" },
];

// ── Page ───────────────────────────────────────────────────────────────────

export default function InboxPage() {
  const [filterId, setFilterId] = useState("inbox");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const { data: gstatus } = useQuery<GoogleStatus>({
    queryKey: ["google-status"],
    queryFn: async () => (await apiClient.get(`${GOOGLE_PREFIX}/status`)).data,
  });

  const activeQuery = search.trim() || FILTERS.find((f) => f.id === filterId)?.q || "in:inbox";

  const threads = useQuery({
    queryKey: tagFilter ? ["gmail-by-tag", tagFilter] : ["gmail-inbox", activeQuery],
    queryFn: async () => {
      if (tagFilter) {
        const res = await apiClient.get<{ threads: InboxThread[] }>(
          `${GOOGLE_PREFIX}/gmail/by-tag`,
          { params: { tag: tagFilter, max: 30 } },
        );
        return res.data.threads ?? [];
      }
      const res = await apiClient.get<{ threads: InboxThread[] }>(
        `${GOOGLE_PREFIX}/gmail/inbox`,
        { params: { q: activeQuery, max: 30 } },
      );
      return res.data.threads ?? [];
    },
    enabled: gstatus?.connected === true,
  });

  const tagList = useQuery<{ tags: { tag: string; count: number }[] }>({
    queryKey: ["gmail-tag-list"],
    queryFn: async () => (await apiClient.get(`${GOOGLE_PREFIX}/gmail/tags`)).data,
    enabled: gstatus?.connected === true,
  });

  const thread = useQuery({
    queryKey: ["gmail-thread", selected],
    queryFn: async () => {
      const res = await apiClient.get<ThreadDetail>(
        `${GOOGLE_PREFIX}/gmail/thread/${selected}`,
      );
      return res.data;
    },
    enabled: !!selected,
  });

  const [batchNotice, setBatchNotice] = useState<{
    kind: "ok" | "error";
    text: string;
    approvals?: boolean;
  } | null>(null);
  const [batchDrafted, setBatchDrafted] = useState(0);
  const [showSig, setShowSig] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [view, setView] = useState<"inbox" | "drafts">("inbox");

  const signature = useQuery<SignatureData>({
    queryKey: ["gmail-signature"],
    queryFn: async () => (await apiClient.get(`${GOOGLE_PREFIX}/gmail/signature`)).data,
    enabled: gstatus?.connected === true,
  });

  const draftSelected = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post(
        `${GOOGLE_PREFIX}/gmail/draft-selected`,
        { thread_ids: Array.from(selectedIds) },
        { timeout: 10 * 60 * 1000 },
      );
      return res.data as { count: number; skipped: { error: string }[] };
    },
    onSuccess: (data) => {
      setBatchDrafted(data.count);
      setSelectedIds(new Set());
      if (data.count === 0) {
        setBatchNotice({
          kind: "error",
          text: "Gerry couldn't draft replies for the selected emails.",
        });
      } else {
        const skip = data.skipped.length ? ` (${data.skipped.length} skipped)` : "";
        setBatchNotice({
          kind: "ok",
          text: `Gerry drafted ${data.count} repl${data.count === 1 ? "y" : "ies"} and sent ${data.count === 1 ? "it" : "them"} to Approvals for your review${skip}.`,
        });
      }
    },
    onError: (e) => {
      setBatchDrafted(0);
      setBatchNotice({ kind: "error", text: getError(e) });
    },
  });

  const trashThread = useMutation({
    mutationFn: async (threadId: string) => {
      const res = await apiClient.post(`${GOOGLE_PREFIX}/gmail/thread/${threadId}/trash`);
      return res.data;
    },
    onSuccess: (_data, threadId) => {
      if (selected === threadId) setSelected(null);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(threadId);
        return next;
      });
      threads.refetch();
      setBatchNotice({ kind: "ok", text: "Email moved to Trash (recoverable in Gmail for 30 days)." });
    },
    onError: (e) => {
      setBatchNotice({ kind: "error", text: getError(e) });
    },
  });

  if (gstatus && !gstatus.connected) {
    return (
      <div className="max-w-xl mx-auto p-6">
        <h1 className="text-2xl font-bold text-white mb-3 flex items-center gap-2">
          <Inbox className="w-6 h-6" /> Gmail
        </h1>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-5 text-sm text-zinc-400">
          Connect your Google account first to read your inbox.{" "}
          <Link to="/google" className="text-yellow-400 hover:underline">
            Go to Google Workspace →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-semibold text-white flex items-center gap-2">
            <Inbox className="w-5 h-5" /> Gmail
          </h1>
          <div className="flex gap-1">
            {(["inbox", "drafts"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`text-xs px-3 py-1 rounded-full border transition-colors capitalize ${
                  view === v
                    ? "bg-zinc-700 border-zinc-600 text-white"
                    : "border-zinc-700 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setBatchNotice(null);
              setShowCompose(true);
            }}
            className="text-xs px-3 py-1 rounded bg-amber-600 hover:bg-amber-500 text-white transition-colors flex items-center gap-1.5"
          >
            <PenSquare className="w-3.5 h-3.5" />
            Compose
          </button>
          {view === "inbox" && (
            <>
              <button
                onClick={() => {
                  setBatchNotice(null);
                  draftSelected.mutate();
                }}
                disabled={draftSelected.isPending || selectedIds.size === 0}
                title={selectedIds.size === 0 ? "Tick the emails you want Gerry to draft replies for" : ""}
                className="text-xs px-2.5 py-1 rounded border border-amber-700 text-amber-300 hover:bg-amber-950/40 disabled:opacity-50 disabled:hover:bg-transparent transition-colors flex items-center gap-1.5"
              >
                <Sparkles
                  className={`w-3.5 h-3.5 ${draftSelected.isPending ? "animate-pulse" : ""}`}
                />
                {draftSelected.isPending
                  ? "Drafting…"
                  : `Draft selected${selectedIds.size ? ` (${selectedIds.size})` : ""}`}
              </button>
              <button
                onClick={() => setShowSig(true)}
                className="text-xs px-2.5 py-1 rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors flex items-center gap-1.5"
              >
                <PenLine className="w-3.5 h-3.5" />
                Signature
              </button>
              <button
                onClick={() => threads.refetch()}
                className="text-xs px-2.5 py-1 rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors flex items-center gap-1.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${threads.isFetching ? "animate-spin" : ""}`} />
                Refresh
              </button>
            </>
          )}
        </div>
      </div>

      {batchNotice && (
        <div
          className={`px-5 py-2 text-xs border-b border-zinc-800 flex items-center gap-3 ${
            batchNotice.kind === "ok" ? "text-green-400" : "text-red-400"
          }`}
        >
          <span>{batchNotice.text}</span>
          {batchNotice.kind === "ok" && (batchDrafted > 0 || batchNotice.approvals) && (
            <Link
              to="/approvals"
              className="shrink-0 inline-flex items-center gap-1.5 px-2 py-0.5 rounded border border-amber-700 text-amber-300 hover:bg-amber-950/40 transition-colors"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              Go to Approvals for review
            </Link>
          )}
        </div>
      )}

      {showSig && <SignatureModal data={signature.data} onClose={() => setShowSig(false)} />}
      {showCompose && (
        <ComposeModal
          signature={resolveSig(signature.data)}
          onClose={() => setShowCompose(false)}
          onNotice={(n) => {
            setBatchDrafted(0);
            setBatchNotice(n);
          }}
        />
      )}

      {view === "drafts" ? (
        <div className="flex-1 overflow-y-auto">
          <EmailsPage />
        </div>
      ) : (
        <div className="flex-1 flex min-h-0">
        {/* ── Thread list ── */}
        <div className="w-80 shrink-0 border-r border-zinc-800 flex flex-col">
          <div className="p-3 space-y-2 border-b border-zinc-800">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search mail…"
              className="w-full text-sm px-3 py-1.5 rounded bg-zinc-950 border border-zinc-700 text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
            />
            <div className="flex gap-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => {
                    setFilterId(f.id);
                    setSearch("");
                    setTagFilter(null);
                  }}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    filterId === f.id && !search && !tagFilter
                      ? "bg-zinc-700 border-zinc-600 text-white"
                      : "border-zinc-700 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {tagList.data && tagList.data.tags.length > 0 && (
              <div className="flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                <select
                  value={tagFilter ?? ""}
                  onChange={(e) => {
                    const v = e.target.value || null;
                    setTagFilter(v);
                    setSearch("");
                  }}
                  className="flex-1 text-xs px-2 py-1 rounded bg-zinc-950 border border-zinc-700 text-zinc-300 focus:outline-none focus:border-zinc-500"
                >
                  <option value="">Filter by tag…</option>
                  {tagList.data.tags.map((t) => (
                    <option key={t.tag} value={t.tag}>
                      {t.tag} ({t.count})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {threads.isLoading ? (
              <p className="p-4 text-xs text-zinc-500">Loading…</p>
            ) : threads.data && threads.data.length > 0 ? (
              threads.data.map((t) => (
                <div
                  key={t.thread_id}
                  onClick={() => setSelected(t.thread_id)}
                  className={`group w-full flex items-start gap-2 px-3 py-2.5 border-b border-zinc-800/60 transition-colors cursor-pointer ${
                    selected === t.thread_id ? "bg-zinc-800" : "hover:bg-zinc-900"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(t.thread_id)}
                    onChange={() => toggleSelect(t.thread_id)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label="Select email for Gerry to draft a reply"
                    className="mt-1 shrink-0 accent-amber-500 cursor-pointer"
                  />
                  <div className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-1.5">
                      {t.unread ? (
                        <Mail className="w-3.5 h-3.5 text-yellow-400 shrink-0" />
                      ) : (
                        <MailOpen className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
                      )}
                      <span
                        className={`text-sm truncate ${
                          t.unread ? "text-white font-medium" : "text-zinc-300"
                        }`}
                      >
                        {senderName(t.from)}
                      </span>
                      {t.message_count > 1 && (
                        <span className="ml-auto text-[10px] text-zinc-500">{t.message_count}</span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-400 truncate mt-0.5">
                      {t.subject || "(no subject)"}
                    </p>
                    <p className="text-xs text-zinc-600 truncate">{t.snippet}</p>
                    {t.tags && t.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {t.tags.map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-950/40 border border-amber-800/60 text-amber-300"
                          >
                            <Tag className="w-2.5 h-2.5" />
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm("Move this email to Trash? You can recover it from Gmail for 30 days.")) {
                        trashThread.mutate(t.thread_id);
                      }
                    }}
                    disabled={trashThread.isPending}
                    aria-label="Move to Trash"
                    title="Move to Trash"
                    className="shrink-0 mt-0.5 p-1 rounded text-zinc-600 opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-950/30 transition-all disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            ) : (
              <p className="p-4 text-xs text-zinc-500">
                {tagFilter ? `No emails tagged "${tagFilter}".` : "No messages."}
              </p>
            )}
          </div>
        </div>

        {/* ── Reading pane ── */}
        <div className="flex-1 overflow-y-auto">
          {!selected ? (
            <div className="h-full flex items-center justify-center text-sm text-zinc-600">
              Select an email to read it.
            </div>
          ) : thread.isLoading ? (
            <p className="p-6 text-sm text-zinc-500">Loading conversation…</p>
          ) : thread.data ? (
            <ThreadReader detail={thread.data} signature={resolveSig(signature.data)} />
          ) : (
            <p className="p-6 text-sm text-red-400">Could not load this conversation.</p>
          )}
        </div>
      </div>
      )}
    </div>
  );
}

// ── Signature settings ──────────────────────────────────────────────────────

function SignatureModal({ data, onClose }: { data?: SignatureData; onClose: () => void }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<SignatureData["mode"]>(data?.mode ?? "none");
  const [custom, setCustom] = useState(data?.custom ?? "");
  const [err, setErr] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const res = await apiClient.put(`${GOOGLE_PREFIX}/gmail/signature`, { mode, custom });
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gmail-signature"] });
      onClose();
    },
    onError: (e) => setErr(getError(e)),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-lg border border-zinc-700 bg-zinc-900 p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-white flex items-center gap-2">
            <PenLine className="w-4 h-4" /> Email signature
          </h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-zinc-500">
          Gerry appends this to the replies it drafts, and it pre-fills your reply box.
        </p>
        <div className="space-y-3">
          <label className="flex items-start gap-2 text-sm text-zinc-300">
            <input
              type="radio"
              name="sigmode"
              checked={mode === "gmail"}
              onChange={() => setMode("gmail")}
              className="mt-1 accent-amber-500"
            />
            <span className="flex-1">
              <span className="font-medium">Use my Gmail signature</span>
              {data?.gmail ? (
                <span className="block mt-1 text-xs text-zinc-400 whitespace-pre-wrap border border-zinc-800 rounded p-2 bg-zinc-950">
                  {data.gmail}
                </span>
              ) : (
                <span className="block mt-0.5 text-xs text-zinc-600">
                  No Gmail signature found on your account.
                </span>
              )}
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm text-zinc-300">
            <input
              type="radio"
              name="sigmode"
              checked={mode === "custom"}
              onChange={() => setMode("custom")}
              className="mt-1 accent-amber-500"
            />
            <span className="flex-1">
              <span className="font-medium">Use a custom signature</span>
              <textarea
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                rows={4}
                placeholder={"Best regards,\nYour Name\nPMI"}
                className="mt-1 w-full text-sm px-2 py-1.5 rounded bg-zinc-950 border border-zinc-700 text-zinc-200 focus:outline-none focus:border-zinc-500"
              />
            </span>
          </label>
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="radio"
              name="sigmode"
              checked={mode === "none"}
              onChange={() => setMode("none")}
              className="accent-amber-500"
            />
            <span className="font-medium">No signature</span>
          </label>
        </div>
        {err && <p className="text-xs text-red-400">{err}</p>}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded border border-zinc-700 text-zinc-300 hover:border-zinc-500"
          >
            Cancel
          </button>
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="text-xs px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50"
          >
            {save.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Reading pane ─────────────────────────────────────────────────────────────

interface ContactSuggestion {
  email: string;
  name: string;
  company: string;
}

function RecipientInput({
  value,
  onChange,
  placeholder = "To…",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const q = value.trim();
  const sug = useQuery({
    queryKey: ["contact-suggest", q],
    queryFn: async () =>
      (
        await apiClient.get<{ contacts: ContactSuggestion[] }>(
          `${GOOGLE_PREFIX}/contacts/suggest`,
          { params: { q } },
        )
      ).data.contacts ?? [],
    enabled: open,
    staleTime: 60_000,
  });
  const matches = (sug.data ?? []).filter(
    (c) => c.email.toLowerCase() !== q.toLowerCase(),
  );

  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        className="mt-1 w-full text-sm px-2 py-1 rounded bg-zinc-950 border border-zinc-700 text-zinc-200 focus:outline-none focus:border-zinc-500"
      />
      {open && matches.length > 0 && (
        <div className="absolute z-10 left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded border border-zinc-700 bg-zinc-900 shadow-lg">
          {matches.map((c) => (
            <button
              key={c.email}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(c.email);
                setOpen(false);
              }}
              className="w-full text-left px-2.5 py-1.5 hover:bg-zinc-800 transition-colors"
            >
              <span className="text-sm text-zinc-200">{c.name || c.email}</span>
              {c.name && <span className="text-xs text-zinc-500 ml-1.5">{c.email}</span>}
              {c.company && (
                <span className="block text-[11px] text-zinc-600">{c.company}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const COMPOSE_TONES = [
  { value: "professional", label: "Professional" },
  { value: "friendly", label: "Friendly" },
  { value: "formal", label: "Formal" },
  { value: "concise", label: "Concise" },
];

function ComposeModal({
  signature,
  onClose,
  onNotice,
}: {
  signature: string;
  onClose: () => void;
  onNotice: (n: { kind: "ok" | "error"; text: string; approvals?: boolean }) => void;
}) {
  const [mode, setMode] = useState<"self" | "gerry">("self");
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState(signature ? `\n\n${signature}` : "");
  const [files, setFiles] = useState<File[]>([]);
  const [instruction, setInstruction] = useState("");
  const [keyPoints, setKeyPoints] = useState("");
  const [tone, setTone] = useState("professional");
  const [err, setErr] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append("to", to);
      fd.append("subject", subject);
      fd.append("body", body);
      if (cc.trim()) fd.append("cc", cc);
      if (bcc.trim()) fd.append("bcc", bcc);
      for (const f of files) fd.append("files", f);
      const res = await apiClient.post(`${GOOGLE_PREFIX}/gmail/send-compose`, fd, {
        timeout: 5 * 60 * 1000,
      });
      return res.data;
    },
    onSuccess: () => {
      onNotice({ kind: "ok", text: `Email sent to ${to}.` });
      onClose();
    },
    onError: (e) => setErr(getError(e)),
  });

  const gerry = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post(`${GOOGLE_PREFIX}/gmail/compose-draft`, {
        to,
        subject: subject.trim() || undefined,
        instruction,
        key_points: keyPoints.trim() || undefined,
        tone,
        cc: cc.trim() || undefined,
        bcc: bcc.trim() || undefined,
      });
      return res.data;
    },
    onSuccess: () => {
      onNotice({
        kind: "ok",
        text: "Gerry drafted your email and sent it to Approvals for review.",
        approvals: true,
      });
      onClose();
    },
    onError: (e) => setErr(getError(e)),
  });

  const busy = send.isPending || gerry.isPending;

  function submit() {
    setErr(null);
    if (!to.trim()) {
      setErr("Add at least one recipient.");
      return;
    }
    if (mode === "self") {
      if (!subject.trim()) {
        setErr("Add a subject.");
        return;
      }
      send.mutate();
    } else {
      if (!instruction.trim()) {
        setErr("Tell Gerry what the email should say.");
        return;
      }
      gerry.mutate();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-white flex items-center gap-2">
            <PenSquare className="w-4 h-4" /> New email
          </h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode toggle */}
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => setMode("self")}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors flex items-center gap-1.5 ${
              mode === "self"
                ? "bg-zinc-700 border-zinc-600 text-white"
                : "border-zinc-700 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <PenSquare className="w-3.5 h-3.5" /> Write it myself
          </button>
          <button
            type="button"
            onClick={() => setMode("gerry")}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors flex items-center gap-1.5 ${
              mode === "gerry"
                ? "bg-amber-900/50 border-amber-700 text-amber-200"
                : "border-zinc-700 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" /> Let Gerry compose
          </button>
        </div>

        {/* Recipients */}
        <div className="space-y-2">
          <div>
            <label className="text-xs font-medium text-zinc-400">To</label>
            <RecipientInput value={to} onChange={setTo} placeholder="Name or email…" />
          </div>
          {showCcBcc ? (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-medium text-zinc-400">Cc</label>
                <RecipientInput value={cc} onChange={setCc} placeholder="Cc…" />
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-400">Bcc</label>
                <RecipientInput value={bcc} onChange={setBcc} placeholder="Bcc…" />
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowCcBcc(true)}
              className="text-[11px] text-zinc-500 hover:text-zinc-300"
            >
              + Add Cc / Bcc
            </button>
          )}
        </div>

        {/* Subject */}
        <div>
          <label className="text-xs font-medium text-zinc-400">
            Subject{mode === "gerry" ? " (optional — Gerry will suggest one)" : ""}
          </label>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject…"
            className="mt-1 w-full text-sm px-2 py-1.5 rounded bg-zinc-950 border border-zinc-700 text-zinc-200 focus:outline-none focus:border-zinc-500"
          />
        </div>

        {mode === "self" ? (
          <>
            <div>
              <label className="text-xs font-medium text-zinc-400">Message</label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={10}
                placeholder="Write your email…"
                className="mt-1 w-full text-sm px-2 py-1.5 rounded bg-zinc-950 border border-zinc-700 text-zinc-200 focus:outline-none focus:border-zinc-500 whitespace-pre-wrap"
              />
            </div>
            <div className="space-y-2">
              <label className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border border-zinc-700 text-zinc-300 hover:border-zinc-500 cursor-pointer">
                <Paperclip className="w-3.5 h-3.5" />
                Attach files
                <input
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    setFiles((prev) => [...prev, ...Array.from(e.target.files ?? [])]);
                    e.target.value = "";
                  }}
                />
              </label>
              {files.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {files.map((f, i) => (
                    <span
                      key={`${f.name}-${i}`}
                      className="flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-zinc-800 text-zinc-300"
                    >
                      <Paperclip className="w-3 h-3" />
                      {f.name} {f.size ? `(${formatBytes(f.size)})` : ""}
                      <button
                        type="button"
                        onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                        className="text-zinc-500 hover:text-red-400"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="text-xs font-medium text-zinc-400">
                What should this email say?
              </label>
              <textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                rows={3}
                placeholder="e.g. Tell Lindsey the NAR audit is delayed to mid-July and ask to reschedule the site visit."
                className="mt-1 w-full text-sm px-2 py-1.5 rounded bg-zinc-950 border border-zinc-700 text-zinc-200 focus:outline-none focus:border-zinc-500"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-400">Key points (optional)</label>
              <textarea
                value={keyPoints}
                onChange={(e) => setKeyPoints(e.target.value)}
                rows={3}
                placeholder={"• New target date: July 15\n• Offer two reschedule options\n• Keep it warm and apologetic"}
                className="mt-1 w-full text-sm px-2 py-1.5 rounded bg-zinc-950 border border-zinc-700 text-zinc-200 focus:outline-none focus:border-zinc-500"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-400">Tone</label>
              <select
                value={tone}
                onChange={(e) => setTone(e.target.value)}
                className="mt-1 w-full text-sm px-2 py-1.5 rounded bg-zinc-950 border border-zinc-700 text-zinc-200 focus:outline-none focus:border-zinc-500"
              >
                {COMPOSE_TONES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-[11px] text-amber-300/80 flex items-start gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              Gerry-composed emails go to Approvals for your review before anything is sent.
            </p>
          </>
        )}

        {err && <p className="text-xs text-red-400">{err}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded border border-zinc-700 text-zinc-300 hover:border-zinc-500"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="text-xs px-4 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50 flex items-center gap-1.5"
          >
            {busy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : mode === "self" ? (
              <Send className="w-3.5 h-3.5" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            {mode === "self"
              ? busy
                ? "Sending…"
                : "Send"
              : busy
                ? "Drafting…"
                : "Draft with Gerry → Approvals"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TagModal({ threadId, onClose }: { threadId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [scope, setScope] = useState<"contact" | "domain">("contact");
  const [selected, setSelected] = useState<string[]>([]);
  const [custom, setCustom] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const loadedRef = useRef(false);

  const info = useQuery<TagData>({
    queryKey: ["gmail-thread-tags", threadId],
    queryFn: async () =>
      (await apiClient.get(`${GOOGLE_PREFIX}/gmail/thread/${threadId}/tags`)).data,
  });

  // Seed the editable set from the stored contact tags once they load.
  useEffect(() => {
    if (info.data && !loadedRef.current) {
      loadedRef.current = true;
      setSelected(info.data.contact_tags);
    }
  }, [info.data]);

  function changeScope(next: "contact" | "domain") {
    if (next === scope || !info.data) return;
    setScope(next);
    setSelected(next === "contact" ? info.data.contact_tags : info.data.domain_tags);
  }

  function addTag(raw: string) {
    const t = raw.trim();
    if (!t) return;
    if (selected.some((s) => s.toLowerCase() === t.toLowerCase())) return;
    setSelected((prev) => [...prev, t]);
  }
  function removeTag(tag: string) {
    setSelected((prev) => prev.filter((s) => s !== tag));
  }

  const suggest = useMutation({
    mutationFn: async () =>
      (
        await apiClient.post(
          `${GOOGLE_PREFIX}/gmail/thread/${threadId}/tags/suggest`,
          {},
          { timeout: 2 * 60 * 1000 },
        )
      ).data as { suggested: string[] },
    onError: (e) => setErr(getError(e)),
  });

  const save = useMutation({
    mutationFn: async () => {
      const res = await apiClient.put(`${GOOGLE_PREFIX}/gmail/thread/${threadId}/tags`, {
        scope,
        tags: selected,
      });
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gmail-inbox"] });
      qc.invalidateQueries({ queryKey: ["gmail-by-tag"] });
      qc.invalidateQueries({ queryKey: ["gmail-tag-list"] });
      qc.invalidateQueries({ queryKey: ["gmail-thread-tags", threadId] });
      onClose();
    },
    onError: (e) => setErr(getError(e)),
  });

  const suggestions = (suggest.data?.suggested ?? []).filter(
    (s) => !selected.some((x) => x.toLowerCase() === s.toLowerCase()),
  );
  const target =
    scope === "contact" ? info.data?.sender || "this contact" : info.data?.domain || "this domain";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-lg border border-zinc-700 bg-zinc-900 p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-white flex items-center gap-2">
            <Tag className="w-4 h-4" /> Tags
          </h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-zinc-500">
          Gerry remembers these tags and applies them automatically to future mail from{" "}
          <span className="text-zinc-300">{target}</span>.
        </p>

        {info.isLoading ? (
          <p className="text-xs text-zinc-500">Loading…</p>
        ) : (
          <>
            <div className="flex gap-2 text-xs">
              <button
                onClick={() => changeScope("contact")}
                className={`flex-1 px-2 py-1.5 rounded border transition-colors ${
                  scope === "contact"
                    ? "bg-zinc-700 border-zinc-600 text-white"
                    : "border-zinc-700 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                Just {info.data?.sender || "this contact"}
              </button>
              <button
                onClick={() => changeScope("domain")}
                disabled={!info.data?.domain}
                className={`flex-1 px-2 py-1.5 rounded border transition-colors disabled:opacity-40 ${
                  scope === "domain"
                    ? "bg-zinc-700 border-zinc-600 text-white"
                    : "border-zinc-700 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                Everyone @ {info.data?.domain || "domain"}
              </button>
            </div>

            <div>
              <p className="text-xs text-zinc-500 mb-1.5">Tags</p>
              {selected.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {selected.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-950/40 border border-amber-800/60 text-amber-300"
                    >
                      {tag}
                      <button
                        onClick={() => removeTag(tag)}
                        className="hover:text-amber-100"
                        aria-label={`Remove ${tag}`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-zinc-600">No tags yet.</p>
              )}
            </div>

            <div className="flex gap-2">
              <input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTag(custom);
                    setCustom("");
                  }
                }}
                placeholder="Add a tag…"
                className="flex-1 text-sm px-2 py-1.5 rounded bg-zinc-950 border border-zinc-700 text-zinc-200 focus:outline-none focus:border-zinc-500"
              />
              <button
                onClick={() => {
                  addTag(custom);
                  setCustom("");
                }}
                className="text-xs px-3 py-1.5 rounded border border-zinc-700 text-zinc-300 hover:border-zinc-500"
              >
                Add
              </button>
            </div>

            <div>
              <button
                onClick={() => suggest.mutate()}
                disabled={suggest.isPending}
                className="text-xs px-2.5 py-1 rounded border border-amber-700 text-amber-300 hover:bg-amber-950/40 disabled:opacity-50 transition-colors flex items-center gap-1.5"
              >
                <Sparkles className={`w-3.5 h-3.5 ${suggest.isPending ? "animate-pulse" : ""}`} />
                {suggest.isPending ? "Thinking…" : "Suggest tags"}
              </button>
              {suggest.isSuccess && suggestions.length === 0 && (
                <p className="text-xs text-zinc-600 mt-1.5">No new suggestions.</p>
              )}
              {suggestions.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      onClick={() => addTag(s)}
                      className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border border-zinc-700 text-zinc-300 hover:border-amber-700 hover:text-amber-300 transition-colors"
                    >
                      + {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {err && <p className="text-xs text-red-400">{err}</p>}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded border border-zinc-700 text-zinc-300 hover:border-zinc-500"
          >
            Cancel
          </button>
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending || info.isLoading}
            className="text-xs px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50"
          >
            {save.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ThreadReader({ detail, signature }: { detail: ThreadDetail; signature: string }) {
  const [showImport, setShowImport] = useState(false);
  const [title, setTitle] = useState(
    detail.subject ? `Email: ${detail.subject}` : "Email thread",
  );
  const [includeAttachments, setIncludeAttachments] = useState(true);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const last = detail.messages[detail.messages.length - 1];
  const [showReply, setShowReply] = useState(false);
  const [replyTo, setReplyTo] = useState("");
  const [replyCc, setReplyCc] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [instruction, setInstruction] = useState("");
  const [showTags, setShowTags] = useState(false);
  const [draftedToApprovals, setDraftedToApprovals] = useState(false);

  function openReply() {
    setReplyTo(emailOf(last?.from || ""));
    setReplyCc("");
    setShowCc(false);
    setReplyBody(signature ? `\n\n${signature}` : "");
    setInstruction("");
    setDraftedToApprovals(false);
    setShowReply(true);
    setShowImport(false);
    setNotice(null);
  }

  /** Reply to the sender and everyone else on the last message (minus yourself). */
  function openReplyAll() {
    const me = (detail.me || "").trim().toLowerCase();
    const sender = emailOf(last?.from || "");
    const others = [
      ...splitAddresses(last?.to || ""),
      ...splitAddresses(last?.cc || ""),
    ]
      .map(emailOf)
      .filter((a) => {
        const lower = a.toLowerCase();
        return a && lower !== me && lower !== sender.toLowerCase();
      });
    const uniqueCc = Array.from(new Set(others));
    setReplyTo(sender);
    setReplyCc(uniqueCc.join(", "));
    setShowCc(uniqueCc.length > 0);
    setReplyBody(signature ? `\n\n${signature}` : "");
    setInstruction("");
    setDraftedToApprovals(false);
    setShowReply(true);
    setShowImport(false);
    setNotice(null);
  }

  const sendReply = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post(`${GOOGLE_PREFIX}/gmail/send`, {
        to: replyTo.trim(),
        cc: replyCc.trim() || undefined,
        subject: replySubject(detail.subject),
        body: replyBody,
        thread_id: detail.thread_id,
        reply_to_message_id: last?.id,
      });
      return res.data;
    },
    onSuccess: () => {
      setNotice({ kind: "ok", text: "Reply sent." });
      setShowReply(false);
      setReplyBody("");
    },
    onError: (e) => setNotice({ kind: "error", text: getError(e) }),
  });

  const gerryDraft = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post(
        `${GOOGLE_PREFIX}/gmail/draft-reply`,
        {
          thread_id: detail.thread_id,
          message_id: last?.id,
          instruction: instruction.trim() || null,
          cc: replyCc.trim() || null,
        },
        { timeout: 2 * 60 * 1000 },
      );
      return res.data;
    },
    onSuccess: () => {
      setNotice({
        kind: "ok",
        text: "Gerry drafted a reply and sent it to Approvals for your review.",
      });
      setDraftedToApprovals(true);
      setShowReply(false);
    },
    onError: (e) => setNotice({ kind: "error", text: getError(e) }),
  });

  const importThread = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post(
        `${GOOGLE_PREFIX}/gmail/thread/import`,
        {
          thread_id: detail.thread_id,
          title: title.trim() || null,
          include_attachments: includeAttachments,
        },
        { timeout: 5 * 60 * 1000 },
      );
      return res.data as { title: string; attachments: { status: string }[] };
    },
    onSuccess: (data) => {
      const imported = data.attachments.filter((a) => a.status === "imported").length;
      let text = `Added “${data.title}” to the Email knowledge base.`;
      if (imported) text += ` Imported ${imported} attachment${imported === 1 ? "" : "s"}.`;
      setNotice({ kind: "ok", text });
      setShowImport(false);
    },
    onError: (e) => setNotice({ kind: "error", text: getError(e) }),
  });

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-start justify-between gap-4 mb-4">
        <h2 className="text-xl font-semibold text-white">
          {detail.subject || "(no subject)"}
        </h2>
        <div className="shrink-0 flex items-center gap-2">
          <button
            onClick={openReply}
            className="text-xs px-3 py-1.5 rounded border border-amber-700 text-amber-300 hover:bg-amber-950/40 transition-colors flex items-center gap-1.5"
          >
            <Reply className="w-3.5 h-3.5" />
            Reply
          </button>
          <button
            onClick={openReplyAll}
            className="text-xs px-3 py-1.5 rounded border border-amber-700 text-amber-300 hover:bg-amber-950/40 transition-colors flex items-center gap-1.5"
          >
            <ReplyAll className="w-3.5 h-3.5" />
            Reply all
          </button>
          <AskGerryButton
            label="Ask Gerry"
            className="px-3 py-1.5 rounded border border-amber-700 text-amber-300 hover:bg-amber-950/40 hover:text-amber-200"
            build={() => {
              const last = detail.messages[detail.messages.length - 1];
              return {
                title: `Email: ${detail.subject || "(no subject)"}`,
                prompt:
                  `I'd like your help with this email thread.\n\n` +
                  `Subject: ${detail.subject || "(no subject)"}\n` +
                  (last?.from ? `From: ${last.from}\n` : "") +
                  (last?.to ? `To: ${last.to}\n` : "") +
                  (last?.cc ? `Cc: ${last.cc}\n` : "") +
                  `\n---\n${(last?.body ?? "").slice(0, 4000)}\n---\n` +
                  `\nCan you summarise it and suggest how I should respond?`,
              };
            }}
          />
          <button
            onClick={() => {
              setShowTags(true);
              setNotice(null);
            }}
            className="text-xs px-3 py-1.5 rounded border border-zinc-600 text-zinc-300 hover:border-zinc-400 transition-colors flex items-center gap-1.5"
          >
            <Tag className="w-3.5 h-3.5" />
            Tags
          </button>
          <button
            onClick={() => {
              setShowImport((v) => !v);
              setShowReply(false);
              setNotice(null);
            }}
            className="text-xs px-3 py-1.5 rounded border border-zinc-600 text-zinc-300 hover:border-zinc-400 transition-colors flex items-center gap-1.5"
          >
            <BookPlus className="w-3.5 h-3.5" />
            Add to Knowledge Base
          </button>
        </div>
      </div>

      {showTags && (
        <TagModal threadId={detail.thread_id} onClose={() => setShowTags(false)} />
      )}

      {showImport && (
        <div className="mb-4 rounded-lg border border-zinc-700 bg-zinc-900 p-4 space-y-2">
          <label className="block text-xs text-zinc-500">
            Title in knowledge base
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full text-sm px-2 py-1 rounded bg-zinc-950 border border-zinc-700 text-zinc-200 focus:outline-none focus:border-zinc-500"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-zinc-400">
            <input
              type="checkbox"
              checked={includeAttachments}
              onChange={(e) => setIncludeAttachments(e.target.checked)}
              className="accent-green-600"
            />
            Also import attachments
          </label>
          <button
            onClick={() => importThread.mutate()}
            disabled={importThread.isPending}
            className="text-xs px-3 py-1.5 rounded bg-green-700 hover:bg-green-600 text-white disabled:opacity-50 transition-colors"
          >
            {importThread.isPending ? "Importing…" : "Import to Knowledge Base"}
          </button>
        </div>
      )}

      {notice && (
        <p className={`mb-4 text-xs ${notice.kind === "ok" ? "text-green-400" : "text-red-400"}`}>
          {notice.text}
        </p>
      )}

      {draftedToApprovals && (
        <div className="mb-4">
          <Link
            to="/approvals"
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-amber-700 text-amber-300 hover:bg-amber-950/40 transition-colors"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            Go to Approvals
          </Link>
        </div>
      )}

      {showReply && (
        <div className="mb-4 rounded-lg border border-zinc-700 bg-zinc-900 p-4 space-y-3">
          <label className="block text-xs text-zinc-500">
            To
            <RecipientInput value={replyTo} onChange={setReplyTo} />
          </label>
          {showCc ? (
            <label className="block text-xs text-zinc-500">
              Cc
              <RecipientInput value={replyCc} onChange={setReplyCc} />
            </label>
          ) : (
            <button
              onClick={() => setShowCc(true)}
              className="text-[11px] text-zinc-500 hover:text-amber-400 transition-colors"
            >
              + Add Cc
            </button>
          )}
          <p className="text-xs text-zinc-500">
            Subject: <span className="text-zinc-300">{replySubject(detail.subject)}</span>
          </p>
          <textarea
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            rows={6}
            placeholder="Write your reply…"
            className="w-full text-sm px-2 py-1.5 rounded bg-zinc-950 border border-zinc-700 text-zinc-200 focus:outline-none focus:border-zinc-500"
          />
          <div className="flex items-center gap-3">
            <button
              onClick={() => sendReply.mutate()}
              disabled={sendReply.isPending || !replyTo.trim() || !replyBody.trim()}
              className="text-xs px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50 transition-colors flex items-center gap-1.5"
            >
              <Send className="w-3.5 h-3.5" />
              {sendReply.isPending ? "Sending…" : "Send"}
            </button>
            <span className="text-xs text-zinc-600">— or —</span>
            <button
              onClick={() => gerryDraft.mutate()}
              disabled={gerryDraft.isPending}
              className="text-xs px-3 py-1.5 rounded border border-amber-700 text-amber-300 hover:bg-amber-950/40 disabled:opacity-50 transition-colors flex items-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {gerryDraft.isPending ? "Drafting…" : "Let Gerry Draft"}
            </button>
          </div>
          <div>
            <input
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="Optional: tell Gerry what to say…"
              className="w-full text-xs px-2 py-1 rounded bg-zinc-950 border border-zinc-800 text-zinc-300 focus:outline-none focus:border-zinc-600"
            />
            <p className="text-[11px] text-zinc-600 mt-1">
              Gerry's drafts go to Approvals for your review before sending — they are
              never sent automatically.
            </p>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {detail.messages.map((m) => (
          <div key={m.id} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <p className="text-sm font-medium text-zinc-200">{senderName(m.from)}</p>
              <p className="text-xs text-zinc-500 shrink-0">{fmtDate(m.date)}</p>
            </div>
            <p className="text-xs text-zinc-500 mb-3">to {m.to}</p>
            <MessageBody message={m} />
            <Attachments message={m} />
          </div>
        ))}
      </div>
    </div>
  );
}
