import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, FileText, ShieldAlert, Trash2, Pencil, X,
  AlertTriangle, TrendingDown, CheckCircle2, Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  listRegDocs, createRegDoc, updateRegDoc,
  listCapas, createCapa, updateCapa,
  listRiskItems, createRiskItem, updateRiskItem, deleteRiskItem,
} from "@/api/regulatory";
import type {
  RegDoc, RegDocCreate,
  CAPA, CAPACreate,
  RiskItem, RiskItemCreate,
} from "@/types/regulatory";

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

// ── Risk helpers ─────────────────────────────────────────────────────────────

function riskColor(score: number | null | undefined): string {
  if (score == null) return "bg-muted text-muted-foreground";
  if (score >= 10) return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
  if (score >= 5) return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300";
  return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
}

function matrixCellColor(prob: number, sev: number): string {
  const score = prob * sev;
  if (score >= 10) return "bg-red-200 dark:bg-red-900/50";
  if (score >= 5) return "bg-yellow-200 dark:bg-yellow-900/50";
  return "bg-green-200 dark:bg-green-900/50";
}

// ── Risk Matrix ────────────────────────────────────────────────────────────────

function RiskMatrix({ items }: { items: RiskItem[] }) {
  const cellCounts: Record<string, number> = {};
  for (const item of items) {
    const p = item.probability_after ?? item.probability_before;
    const s = item.severity_after ?? item.severity_before;
    if (p && s) {
      const key = `${p}-${s}`;
      cellCounts[key] = (cellCounts[key] ?? 0) + 1;
    }
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
        Risk Matrix (after mitigation)
      </p>
      <div className="flex gap-4">
        <div className="flex flex-col gap-0">
          {[5, 4, 3, 2, 1].map((prob) => (
            <div key={prob} className="flex items-center gap-0">
              <span className="w-6 text-center text-xs text-muted-foreground shrink-0">{prob}</span>
              {[1, 2, 3, 4, 5].map((sev) => {
                const count = cellCounts[`${prob}-${sev}`] ?? 0;
                return (
                  <div
                    key={sev}
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-sm border border-background text-xs font-medium",
                      matrixCellColor(prob, sev),
                    )}
                    title={`P${prob}×S${sev}=${prob * sev}`}
                  >
                    {count > 0 && <span>{count}</span>}
                  </div>
                );
              })}
            </div>
          ))}
          <div className="flex ml-6">
            {[1, 2, 3, 4, 5].map((s) => (
              <div key={s} className="flex h-5 w-10 items-center justify-center text-xs text-muted-foreground">{s}</div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2 justify-center text-xs">
          <p className="text-muted-foreground font-medium">Legend</p>
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-sm bg-green-200 dark:bg-green-900/50" />
            <span className="text-muted-foreground">Acceptable (&lt;5)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-sm bg-yellow-200 dark:bg-yellow-900/50" />
            <span className="text-muted-foreground">ALARP (5–9)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-sm bg-red-200 dark:bg-red-900/50" />
            <span className="text-muted-foreground">Unacceptable (≥10)</span>
          </div>
          <p className="text-muted-foreground mt-1">Y=Probability, X=Severity</p>
        </div>
      </div>
    </div>
  );
}

// ── Risk Form ─────────────────────────────────────────────────────────────────

function ScoreSelect({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border bg-background px-2 py-1.5 text-sm w-20"
      >
        <option value="">–</option>
        {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    </div>
  );
}

function RiskForm({
  docs,
  initial,
  onSave,
  onClose,
  saving,
}: {
  docs: RegDoc[];
  initial?: Partial<RiskItemCreate & { doc_id?: string }>;
  onSave: (docId: string, body: RiskItemCreate) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const [docId, setDocId] = useState(initial?.doc_id ?? docs[0]?.id ?? "");
  const [hazard, setHazard] = useState(initial?.hazard ?? "");
  const [situation, setSituation] = useState(initial?.hazardous_situation ?? "");
  const [harm, setHarm] = useState(initial?.harm ?? "");
  const [probBefore, setProbBefore] = useState(String(initial?.probability_before ?? ""));
  const [sevBefore, setSevBefore] = useState(String(initial?.severity_before ?? ""));
  const [mitigation, setMitigation] = useState(initial?.mitigation_measures ?? "");
  const [probAfter, setProbAfter] = useState(String(initial?.probability_after ?? ""));
  const [sevAfter, setSevAfter] = useState(String(initial?.severity_after ?? ""));
  const [acceptability, setAcceptability] = useState(initial?.risk_acceptability ?? "");

  const canSave = hazard.trim() && situation.trim() && harm.trim() && docId;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    onSave(docId, {
      hazard: hazard.trim(),
      hazardous_situation: situation.trim(),
      harm: harm.trim(),
      probability_before: probBefore ? Number(probBefore) : null,
      severity_before: sevBefore ? Number(sevBefore) : null,
      mitigation_measures: mitigation.trim() || null,
      probability_after: probAfter ? Number(probAfter) : null,
      severity_after: sevAfter ? Number(sevAfter) : null,
      risk_acceptability: acceptability || null,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border bg-card p-4 space-y-3 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{initial ? "Edit Risk Item" : "New Risk Item"}</p>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div>
        <label className="text-xs text-muted-foreground block mb-1">Regulatory Document *</label>
        <select
          value={docId}
          onChange={(e) => setDocId(e.target.value)}
          required
          className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
        >
          <option value="">Select document…</option>
          {docs.map((d) => (
            <option key={d.id} value={d.id}>
              {d.doc_number ? `${d.doc_number} – ` : ""}{d.title}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Hazard *</label>
          <input value={hazard} onChange={(e) => setHazard(e.target.value)} required placeholder="e.g. Electrical fault"
            className="w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Hazardous Situation *</label>
          <input value={situation} onChange={(e) => setSituation(e.target.value)} required placeholder="e.g. Patient contact during fault"
            className="w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Harm *</label>
          <input value={harm} onChange={(e) => setHarm(e.target.value)} required placeholder="e.g. Electric shock"
            className="w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring" />
        </div>
      </div>

      <div className="flex flex-wrap gap-4 items-end">
        <ScoreSelect value={probBefore} onChange={setProbBefore} label="Prob. Before" />
        <ScoreSelect value={sevBefore} onChange={setSevBefore} label="Sev. Before" />
        {probBefore && sevBefore && (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Score Before</span>
            <span className={cn("rounded-full px-2 py-0.5 text-sm font-bold text-center w-20", riskColor(Number(probBefore) * Number(sevBefore)))}>
              {Number(probBefore) * Number(sevBefore)}
            </span>
          </div>
        )}
      </div>

      <div>
        <label className="text-xs text-muted-foreground block mb-1">Mitigation Measures</label>
        <textarea value={mitigation} onChange={(e) => setMitigation(e.target.value)} rows={2}
          placeholder="Control measures, design changes, warnings…"
          className="w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring resize-none" />
      </div>

      <div className="flex flex-wrap gap-4 items-end">
        <ScoreSelect value={probAfter} onChange={setProbAfter} label="Prob. After" />
        <ScoreSelect value={sevAfter} onChange={setSevAfter} label="Sev. After" />
        {probAfter && sevAfter && (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Score After</span>
            <span className={cn("rounded-full px-2 py-0.5 text-sm font-bold text-center w-20", riskColor(Number(probAfter) * Number(sevAfter)))}>
              {Number(probAfter) * Number(sevAfter)}
            </span>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Acceptability</label>
          <select value={acceptability} onChange={(e) => setAcceptability(e.target.value)}
            className="rounded-md border bg-background px-2 py-1.5 text-sm w-36">
            <option value="">–</option>
            <option value="acceptable">Acceptable</option>
            <option value="alarp">ALARP</option>
            <option value="unacceptable">Unacceptable</option>
          </select>
        </div>
      </div>

      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent">Cancel</button>
        <button type="submit" disabled={saving || !canSave} className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50">
          {saving ? "Saving…" : initial ? "Update" : "Create"}
        </button>
      </div>
    </form>
  );
}

// ── Risk Item Row ──────────────────────────────────────────────────────────────

function RiskItemRow({
  item, docTitle, onEdit, onDelete,
}: {
  item: RiskItem;
  docTitle: string | undefined;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const scoreBefore = item.probability_before != null && item.severity_before != null
    ? item.probability_before * item.severity_before : null;
  const scoreAfter = item.probability_after != null && item.severity_after != null
    ? item.probability_after * item.severity_after : null;

  return (
    <div className="rounded-lg border bg-card px-4 py-3 hover:bg-accent/30 transition-colors">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium">{item.hazard}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{item.hazardous_situation}</p>
              <p className="text-xs text-muted-foreground">Harm: {item.harm}</p>
              {docTitle && (
                <p className="text-xs text-muted-foreground mt-0.5 truncate">Doc: {docTitle}</p>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={onEdit} className="rounded p-1.5 text-muted-foreground hover:text-foreground" title="Edit">
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button onClick={onDelete} className="rounded p-1.5 text-muted-foreground hover:text-destructive" title="Delete">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 mt-2">
            {scoreBefore != null && (
              <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", riskColor(scoreBefore))}>
                Before: {scoreBefore}
              </span>
            )}
            {item.mitigation_measures && (
              <span className="text-xs text-muted-foreground flex items-center gap-1 max-w-xs truncate">
                <TrendingDown className="h-3 w-3 shrink-0" />
                {item.mitigation_measures}
              </span>
            )}
            {scoreAfter != null && (
              <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", riskColor(scoreAfter))}>
                After: {scoreAfter}
              </span>
            )}
            {item.risk_acceptability && (
              <span className={cn(
                "rounded-full px-2 py-0.5 text-xs font-semibold",
                item.risk_acceptability === "unacceptable"
                  ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
                  : item.risk_acceptability === "alarp"
                    ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300"
                    : "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
              )}>
                {item.risk_acceptability.toUpperCase()}
              </span>
            )}
          </div>
        </div>
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
  const qc = useQueryClient();
  const [tab, setTab] = useState<"docs" | "capa" | "risks">("docs");
  const [showNewDoc, setShowNewDoc] = useState(false);
  const [showNewCapa, setShowNewCapa] = useState(false);
  const [showNewRisk, setShowNewRisk] = useState(false);
  const [editRisk, setEditRisk] = useState<RiskItem | null>(null);
  const [confirmDeleteRisk, setConfirmDeleteRisk] = useState<string | null>(null);

  const { data: docs = [], isLoading: docsLoading } = useQuery({
    queryKey: ["reg-docs"],
    queryFn: () => listRegDocs(),
  });

  const { data: capas = [], isLoading: capaLoading } = useQuery({
    queryKey: ["capas"],
    queryFn: () => listCapas(),
  });

  const { data: risks = [], isLoading: risksLoading } = useQuery({
    queryKey: ["risk-items"],
    queryFn: () => listRiskItems(),
    enabled: tab === "risks",
  });

  const docById = Object.fromEntries(docs.map((d) => [d.id, d]));

  const createRiskMutation = useMutation({
    mutationFn: ({ docId, body }: { docId: string; body: RiskItemCreate }) =>
      createRiskItem(docId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["risk-items"] });
      setShowNewRisk(false);
    },
  });

  const updateRiskMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<RiskItemCreate> }) =>
      updateRiskItem(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["risk-items"] });
      setEditRisk(null);
    },
  });

  const deleteRiskMutation = useMutation({
    mutationFn: (id: string) => deleteRiskItem(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["risk-items"] });
      setConfirmDeleteRisk(null);
    },
  });

  const openCapas = capas.filter((c) => c.status === "open" || c.status === "in_progress").length;
  const draftDocs = docs.filter((d) => d.status === "draft").length;
  const unacceptableRisks = risks.filter((r) => r.risk_acceptability === "unacceptable").length;
  const alarpRisks = risks.filter((r) => r.risk_acceptability === "alarp").length;

  return (
    <div className="flex flex-col gap-6 p-6 max-w-4xl mx-auto">
      {confirmDeleteRisk && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-xl">
            <h2 className="mb-2 text-lg font-bold">Delete risk item?</h2>
            <p className="mb-5 text-sm text-muted-foreground">This action cannot be undone.</p>
            <div className="flex gap-2">
              <button
                onClick={() => deleteRiskMutation.mutate(confirmDeleteRisk)}
                disabled={deleteRiskMutation.isPending}
                className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground disabled:opacity-50"
              >
                {deleteRiskMutation.isPending ? "Deleting…" : "Delete"}
              </button>
              <button onClick={() => setConfirmDeleteRisk(null)} className="rounded-md border px-4 py-2 text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Regulatory</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {docs.length} documents · {draftDocs} draft
            {openCapas > 0 && <span className="text-destructive ml-2">· {openCapas} open CAPAs</span>}
            {unacceptableRisks > 0 && <span className="text-destructive ml-2">· {unacceptableRisks} unacceptable risks</span>}
          </p>
        </div>
        <button
          onClick={() => {
            if (tab === "docs") setShowNewDoc(true);
            else if (tab === "capa") setShowNewCapa(true);
            else { setEditRisk(null); setShowNewRisk(true); }
          }}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          {tab === "docs" ? "New Document" : tab === "capa" ? "New CAPA" : "New Risk"}
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
        <button
          onClick={() => setTab("risks")}
          className={cn(
            "rounded-md px-4 py-1.5 text-sm font-medium transition-colors flex items-center gap-1.5",
            tab === "risks" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}
        >
          Risk Register
          {unacceptableRisks > 0 && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-xs font-bold text-destructive-foreground">
              {unacceptableRisks}
            </span>
          )}
        </button>
      </div>

      {/* Forms */}
      {showNewDoc && <NewRegDocForm onClose={() => setShowNewDoc(false)} />}
      {showNewCapa && <NewCAPAForm onClose={() => setShowNewCapa(false)} />}
      {showNewRisk && docs.length === 0 && (
        <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
          Create a regulatory document first to attach risk items to it.
        </div>
      )}
      {showNewRisk && docs.length > 0 && (
        <RiskForm
          docs={docs}
          onSave={(docId, body) => createRiskMutation.mutate({ docId, body })}
          onClose={() => setShowNewRisk(false)}
          saving={createRiskMutation.isPending}
        />
      )}
      {editRisk && (
        <RiskForm
          docs={docs}
          initial={{
            doc_id: editRisk.regulatory_doc_id ?? undefined,
            hazard: editRisk.hazard,
            hazardous_situation: editRisk.hazardous_situation,
            harm: editRisk.harm,
            probability_before: editRisk.probability_before,
            severity_before: editRisk.severity_before,
            mitigation_measures: editRisk.mitigation_measures,
            probability_after: editRisk.probability_after,
            severity_after: editRisk.severity_after,
            risk_acceptability: editRisk.risk_acceptability,
          }}
          onSave={(_docId, body) => updateRiskMutation.mutate({ id: editRisk.id, body })}
          onClose={() => setEditRisk(null)}
          saving={updateRiskMutation.isPending}
        />
      )}

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

      {tab === "risks" && (
        <div className="space-y-4">
          {risksLoading ? (
            <div className="text-center text-muted-foreground py-12">Loading risk register…</div>
          ) : risks.length === 0 ? (
            <div className="rounded-lg border border-dashed py-16 text-center text-muted-foreground">
              <p className="font-medium">No risk items recorded</p>
              <p className="text-sm mt-1">Start your ISO 14971 risk register by adding risk items above.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Total Risks", value: risks.length, icon: Activity, color: "" },
                  { label: "ALARP", value: alarpRisks, icon: CheckCircle2, color: alarpRisks > 0 ? "text-yellow-600" : "" },
                  { label: "Unacceptable", value: unacceptableRisks, icon: AlertTriangle, color: unacceptableRisks > 0 ? "text-destructive" : "" },
                ].map(({ label, value, icon: Icon, color }) => (
                  <div key={label} className="rounded-lg border bg-card px-4 py-3 flex items-center gap-3">
                    <Icon className={cn("h-5 w-5 shrink-0 text-muted-foreground", color)} />
                    <div>
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className={cn("text-2xl font-bold", color)}>{value}</p>
                    </div>
                  </div>
                ))}
              </div>
              <RiskMatrix items={risks} />
              <div className="space-y-2">
                {risks.map((item) => (
                  <RiskItemRow
                    key={item.id}
                    item={item}
                    docTitle={item.regulatory_doc_id ? docById[item.regulatory_doc_id]?.title : undefined}
                    onEdit={() => { setShowNewRisk(false); setEditRisk(item); }}
                    onDelete={() => setConfirmDeleteRisk(item.id)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
