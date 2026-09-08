/**
 * One box for three jobs. A name jumps to the thing; a question goes to Gerry
 * in the side panel; a slash runs a command. Ctrl+K focuses it from anywhere.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Bot,
  FileText,
  FolderKanban,
  FolderOpen,
  Loader2,
  MessageSquare,
  Plus,
  Search,
  Slash,
  User,
} from "lucide-react";

import { apiClient } from "@/api/client";
import type { Source } from "@/api/tasks";
import { HubBadge } from "@/components/HubBadge";
import { useHubConnected } from "@/hooks/useAllWork";
import { RAIL } from "@/lib/workbench";
import { modLabel } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { useChatSidebarStore } from "@/stores/chatSidebarStore";
import { peekTask } from "@/stores/peekStore";

type HitKind = "project" | "task" | "document" | "conversation" | "contact";

interface Hit {
  kind: HitKind;
  id: string;
  title: string;
  subtitle?: string | null;
}

interface Row {
  key: string;
  group: string;
  icon: React.ReactNode;
  label: string;
  hint?: string;
  source?: Source;
  run: () => void;
}

const KIND_ICON: Record<HitKind, React.ReactNode> = {
  project: <FolderOpen className="h-4 w-4" />,
  task: <FolderKanban className="h-4 w-4" />,
  document: <FileText className="h-4 w-4" />,
  conversation: <MessageSquare className="h-4 w-4" />,
  contact: <User className="h-4 w-4" />,
};

const KIND_GROUP: Record<HitKind, string> = {
  project: "Projects",
  task: "Tasks",
  document: "Documents",
  conversation: "Conversations",
  contact: "People",
};

const COMMANDS: { cmd: string; label: string; to: string }[] = [
  { cmd: "task", label: "New task", to: "/tasks?new=1" },
  { cmd: "project", label: "New project", to: "/projects?new=1" },
  { cmd: "kb", label: "Add to the Knowledge Base", to: "/documents?upload=1" },
  { cmd: "routine", label: "New routine", to: "/tasks?tab=routines&new=1" },
  { cmd: "meeting", label: "New meeting note", to: "/meetings?new=1" },
  { cmd: "settings", label: "Settings", to: "/settings" },
];

const PAGES: { label: string; to: string }[] = RAIL.flatMap((item) =>
  item.pages.map((p) => ({ label: p.label === item.label ? p.label : `${item.label} · ${p.label}`, to: p.route })),
).concat([
  { label: "Settings", to: "/settings" },
  { label: "Users", to: "/users" },
  { label: "Notifications", to: "/notifications" },
  { label: "Little Gerry", to: "/chat" },
]);

function fuzzy(haystack: string, needle: string): boolean {
  const h = haystack.toLowerCase();
  let i = 0;
  for (const ch of needle.toLowerCase()) {
    const at = h.indexOf(ch, i);
    if (at === -1) return false;
    i = at + 1;
  }
  return true;
}

/** A question is a sentence, not a name. */
function looksLikeQuestion(q: string): boolean {
  const t = q.trim();
  return /[?]$/.test(t) || t.split(/\s+/).length >= 5 || /^(what|who|when|where|why|how|can|could|should|is|are|do|does|did|tell|show|find|list|summari[sz]e|draft|write|explain)\b/i.test(t);
}

async function fetchEverything(q: string, source: Source): Promise<Hit[]> {
  const path = source === "hub" ? "/hub/api/search/everything" : "/search/everything";
  const resp = await apiClient.get<{ hits?: Hit[] }>(path, { params: { q } });
  // A hub still on an older build answers this with something else entirely.
  return Array.isArray(resp.data?.hits) ? resp.data.hits : [];
}

export function Omnibar() {
  const navigate = useNavigate();
  const hubConnected = useHubConnected();
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [debounced, setDebounced] = useState("");

  const setPending = useChatSidebarStore((s) => s.setPendingMessage);
  const openPanel = useChatSidebarStore((s) => s.setOpen);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value.trim()), 180);
    return () => window.clearTimeout(t);
  }, [value]);

  // Ctrl+K focuses; Esc blurs.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", away);
    return () => window.removeEventListener("pointerdown", away);
  }, [open]);

  const isCommand = value.startsWith("/");
  const searchable = !isCommand && debounced.length >= 2 && !looksLikeQuestion(debounced);

  const local = useQuery({
    queryKey: ["everything", "local", debounced],
    queryFn: () => fetchEverything(debounced, "local"),
    enabled: searchable,
    staleTime: 15_000,
  });
  const hub = useQuery({
    queryKey: ["everything", "hub", debounced],
    queryFn: () => fetchEverything(debounced, "hub"),
    enabled: searchable && hubConnected,
    staleTime: 15_000,
    retry: false,
  });

  const ask = useCallback(
    (text: string) => {
      setPending(text);
      openPanel(true);
      setValue("");
      setOpen(false);
    },
    [setPending, openPanel],
  );

  const go = useCallback(
    (to: string) => {
      navigate(to);
      setValue("");
      setOpen(false);
    },
    [navigate],
  );

  const rows = useMemo<Row[]>(() => {
    const q = value.trim();
    if (!q) return [];

    if (isCommand) {
      const needle = q.slice(1).toLowerCase();
      return COMMANDS.filter((c) => c.cmd.startsWith(needle) || fuzzy(c.label, needle)).map((c) => ({
        key: `cmd-${c.cmd}`,
        group: "Commands",
        icon: <Plus className="h-4 w-4 text-primary" />,
        label: c.label,
        hint: `/${c.cmd}`,
        run: () => go(c.to),
      }));
    }

    const out: Row[] = [];
    const question = looksLikeQuestion(q);

    if (question) {
      out.push({
        key: "ask",
        group: "Gerry",
        icon: <Bot className="h-4 w-4 text-primary" />,
        label: `Ask Gerry: ${q}`,
        hint: "Enter",
        run: () => ask(q),
      });
    }

    for (const p of PAGES.filter((p) => fuzzy(p.label, q)).slice(0, 4)) {
      out.push({
        key: `page-${p.to}`,
        group: "Pages",
        icon: <ArrowRight className="h-4 w-4" />,
        label: p.label,
        run: () => go(p.to),
      });
    }

    const hits: { hit: Hit; source: Source }[] = [
      ...(local.data ?? []).map((hit) => ({ hit, source: "local" as Source })),
      ...(hub.data ?? []).map((hit) => ({ hit, source: "hub" as Source })),
    ];
    for (const { hit, source } of hits) {
      const run = () => {
        switch (hit.kind) {
          case "project":
            return go(source === "hub" ? `/hub/projects/${hit.id}/space` : `/projects/${hit.id}/space`);
          case "task":
            setValue("");
            setOpen(false);
            return peekTask(hit.id, source);
          case "document":
            return go(`/documents?doc=${hit.id}`);
          case "conversation":
            return go(source === "hub" ? `/hub/chat/${hit.id}` : `/chat/${hit.id}`);
          case "contact":
            return go(`/contacts?q=${encodeURIComponent(hit.id)}`);
        }
      };
      out.push({
        key: `${source}-${hit.kind}-${hit.id}`,
        group: KIND_GROUP[hit.kind],
        icon: KIND_ICON[hit.kind],
        label: hit.title,
        hint: hit.subtitle ?? undefined,
        source,
        run,
      });
    }

    if (!question) {
      out.push({
        key: "ask",
        group: "Gerry",
        icon: <Bot className="h-4 w-4 text-primary" />,
        label: `Ask Gerry: ${q}`,
        run: () => ask(q),
      });
    }
    return out;
  }, [value, isCommand, local.data, hub.data, ask, go]);

  useEffect(() => setActive(0), [rows.length, value]);

  const grouped = useMemo(() => {
    const order: string[] = [];
    const by = new Map<string, Row[]>();
    for (const r of rows) {
      if (!by.has(r.group)) {
        by.set(r.group, []);
        order.push(r.group);
      }
      by.get(r.group)!.push(r);
    }
    return order.map((g) => ({ group: g, rows: by.get(g)! }));
  }, [rows]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[active];
      if (row) row.run();
      else if (value.trim()) ask(value.trim());
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  const busy = searchable && (local.isFetching || hub.isFetching);

  return (
    <div ref={boxRef} className="relative w-full max-w-2xl">
      <div className="flex items-center gap-2 rounded-lg border bg-muted/50 px-3 py-1.5 focus-within:border-primary/60 focus-within:bg-background">
        {isCommand ? (
          <Slash className="h-4 w-4 shrink-0 text-primary" />
        ) : busy ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search, jump, or ask Gerry…  ( / for commands )"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        <kbd className="hidden h-5 items-center rounded border bg-background px-1.5 text-[10px] font-medium text-muted-foreground sm:flex">
          {modLabel("K")}
        </kbd>
      </div>

      {open && rows.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[60vh] overflow-y-auto rounded-lg border bg-popover p-1 shadow-xl">
          {grouped.map(({ group, rows: items }) => (
            <div key={group}>
              <p className="px-2 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {group}
              </p>
              {items.map((r) => {
                const idx = rows.indexOf(r);
                return (
                  <button
                    key={r.key}
                    type="button"
                    onMouseEnter={() => setActive(idx)}
                    onClick={r.run}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm",
                      idx === active ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
                    )}
                  >
                    <span className="shrink-0 text-muted-foreground">{r.icon}</span>
                    <span className="min-w-0 flex-1 truncate">{r.label}</span>
                    {r.source && <HubBadge source={r.source} />}
                    {r.hint && (
                      <span className="shrink-0 truncate text-[11px] text-muted-foreground">{r.hint}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
