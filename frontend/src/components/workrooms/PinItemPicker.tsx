import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search, X } from "lucide-react";
import { DriveBrowser } from "@/components/google/DriveBrowser";
import { listDocuments } from "@/api/documents";
import { listGeneratedFiles } from "@/api/files";
import { listGmailThreads } from "@/api/google";
import { getOdooData, getOdooModels } from "@/api/odoo";
import { listRegDocs } from "@/api/regulatory";
import { listBudgets } from "@/api/budgets";
import { listTasks } from "@/api/tasks";
import { ITEM_KIND_LABELS, type WorkroomItemKind } from "@/api/workrooms";

export interface PickedItem {
  ref_id: string;
  label: string;
}

interface Option {
  ref_id: string;
  label: string;
  sub?: string;
}

interface Props {
  kind: WorkroomItemKind;
  onPick: (items: PickedItem[]) => void;
  onClose: () => void;
}

/** Browse-and-pin picker: one dialog per pinned-item kind. */
export function PinItemPicker({ kind, onPick, onClose }: Props) {
  if (kind === "drive_doc") {
    return (
      <DriveBrowser
        onSelect={(files) =>
          onPick(files.map((f) => ({ ref_id: f.id, label: f.name })))
        }
        onClose={onClose}
      />
    );
  }
  if (kind === "note") return <NotePicker onPick={onPick} onClose={onClose} />;
  if (kind === "odoo_record") return <OdooPicker onPick={onPick} onClose={onClose} />;
  return <ListPicker kind={kind} onPick={onPick} onClose={onClose} />;
}

function Shell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl border bg-background shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function OptionList({
  options,
  loading,
  empty,
  onPick,
}: {
  options: Option[];
  loading: boolean;
  empty: string;
  onPick: (o: Option) => void;
}) {
  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (options.length === 0) {
    return <p className="px-4 py-10 text-center text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <ul className="space-y-1 p-2">
      {options.map((o) => (
        <li key={o.ref_id + o.label}>
          <button
            onClick={() => onPick(o)}
            className="w-full rounded-md border px-3 py-2 text-left text-sm hover:bg-accent"
          >
            <span className="block truncate font-medium">{o.label}</span>
            {o.sub && (
              <span className="block truncate text-xs text-muted-foreground">{o.sub}</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

function ListPicker({ kind, onPick, onClose }: Props) {
  const [search, setSearch] = useState("");

  const query = useQuery({
    queryKey: ["pin-picker", kind],
    queryFn: async (): Promise<Option[]> => {
      switch (kind) {
        case "kb_doc": {
          const docs = await listDocuments();
          return docs.map((d) => ({
            ref_id: d.id,
            label: d.title,
            sub: d.file_name ?? undefined,
          }));
        }
        case "generated_file": {
          const files = await listGeneratedFiles();
          return files.map((f) => ({
            ref_id: f.name,
            label: f.name,
            sub: new Date(f.modified * 1000).toLocaleString(),
          }));
        }
        case "email_thread": {
          const threads = await listGmailThreads("", 50);
          return threads.map((t) => ({
            ref_id: t.thread_id,
            label: t.subject || "(no subject)",
            sub: `${t.from} · ${t.date}`,
          }));
        }
        case "task": {
          const tasks = await listTasks();
          return tasks.map((t) => ({ ref_id: t.id, label: t.title, sub: t.status }));
        }
        case "regulatory_doc": {
          const docs = await listRegDocs();
          return docs.map((d) => ({
            ref_id: d.id,
            label: d.title,
            sub: [d.doc_number, d.doc_type, `rev ${d.revision}`].filter(Boolean).join(" · "),
          }));
        }
        case "budget": {
          const budgets = await listBudgets();
          return budgets.map((b) => ({ ref_id: b.id, label: b.title, sub: b.currency }));
        }
        default:
          return [];
      }
    },
  });

  const options = useMemo(() => {
    const all = query.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (o) =>
        o.label.toLowerCase().includes(q) || (o.sub ?? "").toLowerCase().includes(q),
    );
  }, [query.data, search]);

  return (
    <Shell title={`Pin a ${ITEM_KIND_LABELS[kind].toLowerCase()}`} onClose={onClose}>
      <div className="border-b px-4 py-2">
        <div className="flex items-center gap-2 rounded-md border px-2 py-1.5">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by name…"
            className="w-full bg-transparent text-sm outline-none"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <OptionList
          options={options}
          loading={query.isLoading}
          empty={
            query.isError
              ? "Couldn't load that list."
              : `No ${ITEM_KIND_LABELS[kind].toLowerCase()}s found.`
          }
          onPick={(o) => onPick([{ ref_id: o.ref_id, label: o.label }])}
        />
      </div>
    </Shell>
  );
}

function NotePicker({ onPick, onClose }: { onPick: (i: PickedItem[]) => void; onClose: () => void }) {
  const [text, setText] = useState("");
  return (
    <Shell title="Pin a note" onClose={onClose}>
      <div className="space-y-3 p-4">
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder="Anything Gerry should keep in mind in this room…"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        />
        <div className="flex justify-end">
          <button
            onClick={() => onPick([{ ref_id: "", label: text.trim() }])}
            disabled={!text.trim()}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            Pin note
          </button>
        </div>
      </div>
    </Shell>
  );
}

function OdooPicker({ onPick, onClose }: { onPick: (i: PickedItem[]) => void; onClose: () => void }) {
  const [modelKey, setModelKey] = useState("");
  const [search, setSearch] = useState("");

  const models = useQuery({ queryKey: ["odoo-models"], queryFn: getOdooModels });
  const activeKey = modelKey || models.data?.[0]?.key || "";

  const rows = useQuery({
    queryKey: ["odoo-data", activeKey, search],
    queryFn: () => getOdooData(activeKey, { search: search.trim() || undefined, limit: 50 }),
    enabled: Boolean(activeKey),
  });

  const options: Option[] = useMemo(() => {
    const data = rows.data;
    if (!data) return [];
    // Odoo rows are model-specific, so the first two returned fields carry the
    // caption and the id is whatever the record exposes.
    const [first, second] = data.fields;
    return data.rows.map((r, i) => {
      const id = String(r.id ?? i);
      const label = String(r[first] ?? id);
      return {
        ref_id: `${data.key}:${id}`,
        label: `${data.label}: ${label}`,
        sub: second ? String(r[second] ?? "") : undefined,
      };
    });
  }, [rows.data]);

  return (
    <Shell title="Pin an Odoo record" onClose={onClose}>
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <select
          value={activeKey}
          onChange={(e) => setModelKey(e.target.value)}
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
        >
          {(models.data ?? []).map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
        <div className="flex min-w-[160px] flex-1 items-center gap-2 rounded-md border px-2 py-1.5">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search records…"
            className="w-full bg-transparent text-sm outline-none"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <OptionList
          options={options}
          loading={models.isLoading || rows.isLoading}
          empty={
            models.isError || rows.isError
              ? "Couldn't reach Odoo. Check the connection in Settings."
              : "No records found."
          }
          onPick={(o) => onPick([{ ref_id: o.ref_id, label: o.label }])}
        />
      </div>
    </Shell>
  );
}
