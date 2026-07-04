import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Users,
  RefreshCw,
  UserPlus,
  Pencil,
  Trash2,
  Tag,
  Mail,
  Building2,
  X,
} from "lucide-react";
import { apiClient } from "@/api/client";
import { AskGerryButton } from "@/components/AskGerryButton";

const GOOGLE_PREFIX = "/api/google";

interface Contact {
  email: string;
  name: string;
  company: string;
  domain: string;
  notes: string;
  source: "derived" | "manual";
  count: number;
  last_seen: string;
  tags?: string[];
}

interface GoogleStatus {
  connected: boolean;
  status: string;
}

function getError(e: unknown): string {
  const err = e as { response?: { status?: number; data?: { detail?: unknown } } };
  const detail = err?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (!err?.response) return "Cannot reach the server. Is Little Gerry running?";
  return "Something went wrong. Please try again.";
}

export function ContactsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Contact | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const syncedRef = useRef(false);

  const { data: gstatus } = useQuery<GoogleStatus>({
    queryKey: ["google-status"],
    queryFn: async () => (await apiClient.get(`${GOOGLE_PREFIX}/status`)).data,
  });

  const contacts = useQuery({
    queryKey: ["contacts", search],
    queryFn: async () => {
      const res = await apiClient.get<{ contacts: Contact[] }>(`${GOOGLE_PREFIX}/contacts`, {
        params: { q: search.trim() },
      });
      return res.data.contacts ?? [];
    },
    enabled: gstatus?.connected === true,
  });

  const sync = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post(
        `${GOOGLE_PREFIX}/contacts/sync`,
        {},
        { timeout: 3 * 60 * 1000 },
      );
      return res.data as { added: number; updated: number; total: number };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
      setNotice({
        kind: "ok",
        text: `Synced from inbox — ${data.added} new, ${data.total} total.`,
      });
    },
    onError: (e) => setNotice({ kind: "error", text: getError(e) }),
  });

  const remove = useMutation({
    mutationFn: async (email: string) => {
      await apiClient.delete(`${GOOGLE_PREFIX}/contacts/${encodeURIComponent(email)}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contacts"] }),
    onError: (e) => setNotice({ kind: "error", text: getError(e) }),
  });

  // Auto-derive contacts once when the page opens (the "open Gmail view / sync").
  useEffect(() => {
    if (gstatus?.connected && !syncedRef.current) {
      syncedRef.current = true;
      sync.mutate();
    }
  }, [gstatus?.connected]); // eslint-disable-line react-hooks/exhaustive-deps

  if (gstatus && !gstatus.connected) {
    return (
      <div className="max-w-xl mx-auto p-6">
        <h1 className="text-2xl font-bold text-white mb-3 flex items-center gap-2">
          <Users className="w-6 h-6" /> Contacts
        </h1>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-5 text-sm text-zinc-400">
          Connect your Google account first to build your contacts from email.{" "}
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
        <h1 className="text-lg font-semibold text-white flex items-center gap-2">
          <Users className="w-5 h-5" /> Contacts
        </h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setEditing(null);
              setShowForm(true);
              setNotice(null);
            }}
            className="text-xs px-2.5 py-1 rounded border border-amber-700 text-amber-300 hover:bg-amber-950/40 transition-colors flex items-center gap-1.5"
          >
            <UserPlus className="w-3.5 h-3.5" />
            Add contact
          </button>
          <button
            onClick={() => {
              setNotice(null);
              sync.mutate();
            }}
            disabled={sync.isPending}
            className="text-xs px-2.5 py-1 rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 disabled:opacity-50 transition-colors flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${sync.isPending ? "animate-spin" : ""}`} />
            {sync.isPending ? "Syncing…" : "Sync from inbox"}
          </button>
        </div>
      </div>

      {notice && (
        <div
          className={`px-5 py-2 text-xs border-b border-zinc-800 ${
            notice.kind === "ok" ? "text-green-400" : "text-red-400"
          }`}
        >
          {notice.text}
        </div>
      )}

      <div className="px-5 py-3 border-b border-zinc-800">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search contacts by name, email, or company…"
          className="w-full max-w-md text-sm px-3 py-1.5 rounded bg-zinc-950 border border-zinc-700 text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {contacts.isLoading ? (
          <p className="p-5 text-sm text-zinc-500">Loading…</p>
        ) : contacts.data && contacts.data.length > 0 ? (
          <div className="divide-y divide-zinc-800/60">
            {contacts.data.map((c) => (
              <div
                key={c.email}
                className="px-5 py-3 flex items-start gap-4 hover:bg-zinc-900/50 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white truncate">
                      {c.name || c.email}
                    </span>
                    {c.source === "manual" && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-zinc-700 text-zinc-400">
                        manual
                      </span>
                    )}
                    {c.count > 0 && (
                      <span className="text-[10px] text-zinc-600">seen {c.count}×</span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 mt-0.5 text-xs text-zinc-400">
                    <span className="inline-flex items-center gap-1 truncate">
                      <Mail className="w-3 h-3 text-zinc-600" />
                      {c.email}
                    </span>
                    {c.company && (
                      <span className="inline-flex items-center gap-1 truncate">
                        <Building2 className="w-3 h-3 text-zinc-600" />
                        {c.company}
                      </span>
                    )}
                  </div>
                  {c.notes && <p className="mt-1 text-xs text-zinc-500">{c.notes}</p>}
                  {c.tags && c.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {c.tags.map((tag) => (
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
                <div className="shrink-0 flex items-center gap-1.5">
                  <AskGerryButton
                    className="p-1.5 text-zinc-500 hover:text-amber-300 hover:bg-zinc-800"
                    build={() => ({
                      title: `Contact: ${c.name || c.email}`,
                      prompt:
                        `I'd like your help regarding this contact.\n\n` +
                        `Name: ${c.name || "(unknown)"}\n` +
                        `Email: ${c.email}` +
                        (c.company ? `\nCompany: ${c.company}` : "") +
                        (c.tags && c.tags.length ? `\nTags: ${c.tags.join(", ")}` : "") +
                        (c.notes ? `\n\nNotes:\n${c.notes}` : "") +
                        `\n\nWhat can you tell me about them, and can you help me draft an email or prepare for a conversation?`,
                    })}
                  />
                  <button
                    onClick={() => {
                      setEditing(c);
                      setShowForm(true);
                      setNotice(null);
                    }}
                    className="p-1.5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
                    aria-label={`Edit ${c.name || c.email}`}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Remove ${c.name || c.email} from contacts?`)) {
                        remove.mutate(c.email);
                      }
                    }}
                    className="p-1.5 rounded text-zinc-500 hover:text-red-400 hover:bg-zinc-800 transition-colors"
                    aria-label={`Delete ${c.name || c.email}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="p-5 text-sm text-zinc-500">
            No contacts yet. Use “Sync from inbox” to build them from your email.
          </p>
        )}
      </div>

      {showForm && (
        <ContactForm
          contact={editing}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["contacts"] });
            setShowForm(false);
          }}
        />
      )}
    </div>
  );
}

function ContactForm({
  contact,
  onClose,
  onSaved,
}: {
  contact: Contact | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!contact;
  const [email, setEmail] = useState(contact?.email ?? "");
  const [name, setName] = useState(contact?.name ?? "");
  const [company, setCompany] = useState(contact?.company ?? "");
  const [notes, setNotes] = useState(contact?.notes ?? "");
  const [err, setErr] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      if (isEdit) {
        const res = await apiClient.put(
          `${GOOGLE_PREFIX}/contacts/${encodeURIComponent(contact!.email)}`,
          { name, company, notes },
        );
        return res.data;
      }
      const res = await apiClient.post(`${GOOGLE_PREFIX}/contacts`, {
        email,
        name,
        company,
        notes,
      });
      return res.data;
    },
    onSuccess: onSaved,
    onError: (e) => setErr(getError(e)),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-900 p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-white flex items-center gap-2">
            <Users className="w-4 h-4" /> {isEdit ? "Edit contact" : "Add contact"}
          </h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
            <X className="w-4 h-4" />
          </button>
        </div>
        <label className="block text-xs text-zinc-500">
          Email
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isEdit}
            placeholder="name@company.com"
            className="mt-1 w-full text-sm px-2 py-1.5 rounded bg-zinc-950 border border-zinc-700 text-zinc-200 disabled:opacity-60 focus:outline-none focus:border-zinc-500"
          />
        </label>
        <label className="block text-xs text-zinc-500">
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full text-sm px-2 py-1.5 rounded bg-zinc-950 border border-zinc-700 text-zinc-200 focus:outline-none focus:border-zinc-500"
          />
        </label>
        <label className="block text-xs text-zinc-500">
          Company
          <input
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            className="mt-1 w-full text-sm px-2 py-1.5 rounded bg-zinc-950 border border-zinc-700 text-zinc-200 focus:outline-none focus:border-zinc-500"
          />
        </label>
        <label className="block text-xs text-zinc-500">
          Notes
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="mt-1 w-full text-sm px-2 py-1.5 rounded bg-zinc-950 border border-zinc-700 text-zinc-200 focus:outline-none focus:border-zinc-500"
          />
        </label>
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
            disabled={save.isPending || (!isEdit && !email.trim())}
            className="text-xs px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50"
          >
            {save.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
