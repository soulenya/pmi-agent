import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, FileText, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  listRegDocs,
  createRegDoc,
  updateRegDoc,
  listCapas,
  createCapa,
  updateCapa,
} from "@/api/regulatory";
import type { RegDoc, RegDocCreate, CAPA, CAPACreate } from "@/types/regulatory";

const DOC_STATUS_COLORS: Record<string, string> = {
  draft: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  in_review: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  approved: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  effective: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  superseded: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

const CAPA_STATUS_COLORS: Record<string, string> = {
  open: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  in_progress: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  closed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  cancelled: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

// ── Reg Doc Form ──────────────────────────────────────────────────────────────

function NewRegDocForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [docType, setDocType] = useState("SOP");
  const [title, setTitle] = useState("");
  const [docNumber, setDocNumber] = useState("");

  const mutation = useMutation({
    mutationFn: (body: RegDocCreate) => createRegDoc(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reg-docs"] });
      onClose();
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        mutation.mutate({ doc_type: docType, title: title.trim(), doc_number: docNumber || undefined });
      }}
      className="rounded-lg border bg-card p-4 space-y-3 shadow-sm"
    >
      <div className="flex gap-3">
        <select
          value={docType}
          onChange={(e) => setDocType(e.target.value)}
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
        >
          {["SOP", "WI", "FORM", "SPEC", "RISK_MANAGEMENT_FILE", "510K", "PMA", "DHF", "DMR", "DHR"].map(
            (t) => <option key={t} value={t}>{t}</option>
          )}
        </select>
        <input
          value={docNumber}
          onChange={(e) => setDocNumber(e.target.value)}
          placeholder="Doc # (e.g. SOP-001)"
          className="w-32 rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Document title…"
        className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
      />
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent">Cancel</button>
        <button type="submit" disabled={mutation.isPending || !title.trim()} className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50">
          {mutation.isPending ? "Creating…" : "Create"}
        </button>
      </div>
    </form>
  );
}

// ── CAPA Form ─────────────────────────────────────────────────────────────────

function NewCAPAForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [capaNumber, setCapaNumber] = useState("");
  const [capaType, setCapaType] = useState("capa");

  const mutation = useMutation({
    mutationFn: (body: CAPACreate) => createCapa(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["capas"] });
      onClose();
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim() || !capaNumber.trim()) return;
        mutation.mutate({ title: title.trim(), capa_number: capaNumber.trim(), capa_type: capaType });
      }}
      className="rounded-lg border bg-card p-4 space-y-3 shadow-sm"
    >
      <div className="flex gap-3">
        <input
          value={capaNumber}
          onChange={(e) => setCapaNumber(e.target.value)}
          placeholder="CAPA # (e.g. CAPA-001)"
          className="w-40 rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <select
          value={capaType}
          onChange={(e) => setCapaType(e.target.value)}
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
        >
          <option value="ca">Corrective Action</option>
          <option value="pa">Preventive Action</option>
          <option value="capa">CAPA</option>
        </select>
      </div>
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="CAPA title…"
        className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
      />
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent">Cancel</button>
        <button type="submit" disabled={mutation.isPending || !title.trim() || !capaNumber.trim()} className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50">
          {mutation.isPending ? "Creating…" : "Create"}
        </button>
      </div>
    </form>
  );
}

// ── Reg Doc Row ────────────────────────────────────────────────────────────────

function RegDocRow({ doc }: { doc: RegDoc }) {
  const qc = useQueryClient();

  const statusMutation = useMutation({
    mutationFn: (newStatus: string) => updateRegDoc(doc.id, { status: newStatus }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reg-docs"] }),
  });

  return (
    <div className="group flex items-center gap-4 rounded-md border bg-card px-4 py-3 hover:bg-accent/30 transition-colors">
      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {doc.doc_number && (
            <span className="text-xs font-mono text-muted-foreground">{doc.doc_number}</span>
          )}
          <span className="text-sm font-medium truncate">{doc.title}</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-muted-foreground">{doc.doc_type}</span>
          <span className="text-xs text-muted-foreground">Rev {doc.revision}</span>
          {doc.related_standards.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {doc.related_standards.slice(0, 2).join(", ")}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <select
          value={doc.status}
          onChange={(e) => statusMutation.mutate(e.target.value)}
          className={cn(
            "text-xs rounded-full px-2.5 py-0.5 border-0 font-medium cursor-pointer",
            DOC_STATUS_COLORS[doc.status] ?? "bg-gray-100 text-gray-600"
          )}
        >
          {["draft", "in_review", "approved", "effective", "superseded"].map((s) => (
            <option key={s} value={s}>{s.replace("_", " ")}</option>
          ))}
        </select>
        {doc.effective_date && (
          <span className="text-xs text-muted-foreground hidden group-hover:inline">
            Effective: {new Date(doc.effective_date).toLocaleDateString()}
          </span>
        )}
      </div>
    </div>
  );
}

// ── CAPA Row ──────────────────────────────────────────────────────────────────

function CAPARow({ capa }: { capa: CAPA }) {
  const qc = useQueryClient();

  const statusMutation = useMutation({
    mutationFn: (newStatus: string) => updateCapa(capa.id, { status: newStatus }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["capas"] }),
  });

  const isOverdue =
    capa.due_date &&
    capa.status !== "closed" &&
    capa.status !== "cancelled" &&
    new Date(capa.due_date) < new Date();

  return (
    <div className="group flex items-center gap-4 rounded-md border bg-card px-4 py-3 hover:bg-accent/30 transition-colors">
      <ShieldAlert className={cn("h-4 w-4 shrink-0", isOverdue ? "text-destructive" : "text-muted-foreground")} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-muted-foreground">{capa.capa_number}</span>
          <span className="text-sm font-medium truncate">{capa.title}</span>
        </div>
        <span className="text-xs text-muted-foreground capitalize">{capa.capa_type}</span>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {capa.due_date && (
          <span className={cn("text-xs", isOverdue ? "text-destructive font-medium" : "text-muted-foreground")}>
            {new Date(capa.due_date).toLocaleDateString()}
          </span>
        )}
        <select
          value={capa.status}
          onChange={(e) => statusMutation.mutate(e.target.value)}
          className={cn(
            "text-xs rounded-full px-2.5 py-0.5 border-0 font-medium cursor-pointer",
            CAPA_STATUS_COLORS[capa.status] ?? "bg-gray-100 text-gray-600"
          )}
        >
          {["open", "in_progress", "closed", "cancelled"].map((s) => (
            <option key={s} value={s}>{s.replace("_", " ")}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function RegulatoryPage() {
  const [tab, setTab] = useState<"docs" | "capa">("docs");
  const [showNewDoc, setShowNewDoc] = useState(false);
  const [showNewCapa, setShowNewCapa] = useState(false);

  const { data: docs = [], isLoading: docsLoading } = useQuery({
    queryKey: ["reg-docs"],
    queryFn: () => listRegDocs(),
  });

  const { data: capas = [], isLoading: capaLoading } = useQuery({
    queryKey: ["capas"],
    queryFn: () => listCapas(),
  });

  const openCapas = capas.filter((c) => c.status === "open" || c.status === "in_progress").length;
  const draftDocs = docs.filter((d) => d.status === "draft").length;

  return (
    <div className="flex flex-col gap-6 p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Regulatory</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {docs.length} documents · {draftDocs} draft
            {openCapas > 0 && (
              <span className="text-destructive ml-2">· {openCapas} open CAPAs</span>
            )}
          </p>
        </div>
        <button
          onClick={() => tab === "docs" ? setShowNewDoc(true) : setShowNewCapa(true)}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          {tab === "docs" ? "New Document" : "New CAPA"}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg border bg-muted p-1 w-fit">
        <button
          onClick={() => setTab("docs")}
          className={cn(
            "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
            tab === "docs" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}
        >
          Documents ({docs.length})
        </button>
        <button
          onClick={() => setTab("capa")}
          className={cn(
            "rounded-md px-4 py-1.5 text-sm font-medium transition-colors flex items-center gap-1.5",
            tab === "capa" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}
        >
          CAPAs
          {openCapas > 0 && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-xs font-bold text-destructive-foreground">
              {openCapas}
            </span>
          )}
        </button>
      </div>

      {/* Forms */}
      {showNewDoc && <NewRegDocForm onClose={() => setShowNewDoc(false)} />}
      {showNewCapa && <NewCAPAForm onClose={() => setShowNewCapa(false)} />}

      {/* Content */}
      {tab === "docs" && (
        <div className="space-y-2">
          {docsLoading ? (
            <div className="text-center text-muted-foreground py-12">Loading documents…</div>
          ) : docs.length === 0 ? (
            <div className="rounded-lg border border-dashed py-16 text-center text-muted-foreground">
              <p className="font-medium">No regulatory documents yet</p>
              <p className="text-sm mt-1">Add SOPs, work instructions, design history files, and more.</p>
            </div>
          ) : (
            docs.map((doc) => <RegDocRow key={doc.id} doc={doc} />)
          )}
        </div>
      )}

      {tab === "capa" && (
        <div className="space-y-2">
          {capaLoading ? (
            <div className="text-center text-muted-foreground py-12">Loading CAPAs…</div>
          ) : capas.length === 0 ? (
            <div className="rounded-lg border border-dashed py-16 text-center text-muted-foreground">
              <p className="font-medium">No CAPAs recorded</p>
              <p className="text-sm mt-1">Track corrective and preventive actions here.</p>
            </div>
          ) : (
            capas.map((capa) => <CAPARow key={capa.id} capa={capa} />)
          )}
        </div>
      )}
    </div>
  );
}
