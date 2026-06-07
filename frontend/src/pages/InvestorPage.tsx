import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { NavLink, useNavigate } from "react-router-dom";
import {
  TrendingUp,
  MessageSquare,
  FileText,
  FlaskConical,
  Plus,
  ChevronRight,
  Sparkles,
  Copy,
  Check,
  Loader2,
  ExternalLink,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { listRegDocs, draftRegDocContent, createRegDoc } from "@/api/regulatory";
import { listResearchReports, runResearch } from "@/api/research";
import { createConversation } from "@/api/chat";
import type { RegDoc, RegDocCreate } from "@/types/regulatory";

// ── Key metrics cards ─────────────────────────────────────────────────────────

const METRICS = [
  { label: "Stage", value: "Pre-Seed / Bootstrapped" },
  { label: "TAM", value: "~$2.4B (emergency suction market)" },
  { label: "Device", value: "VACTOR — compact battery-powered suction" },
  { label: "Regulatory Path", value: "FDA 510(k) — Class II" },
  { label: "Target Markets", value: "EMS, Military, Emergency Medicine" },
  { label: "IP Status", value: "Patent pending (design + utility)" },
];

function MetricsPanel() {
  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide">
        Company Snapshot
      </h2>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
        {METRICS.map(({ label, value }) => (
          <div key={label} className="flex flex-col">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-sm font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ── Quick actions ─────────────────────────────────────────────────────────────

function QuickActions() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  async function startIRChat() {
    setLoading(true);
    try {
      const conv = await createConversation({ title: "Investor Relations Session" });
      navigate(`/chat/${conv.id}`);
    } catch {
      navigate("/chat");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide">
        Quick Actions
      </h2>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={startIRChat}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border bg-primary text-primary-foreground px-4 py-2 text-sm font-medium shadow-sm hover:bg-primary/90 disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}
          Chat with IR Specialist
        </button>
        <NavLink
          to="/research"
          className="inline-flex items-center gap-2 rounded-lg border bg-background px-4 py-2 text-sm font-medium shadow-sm hover:bg-muted"
        >
          <FlaskConical className="h-4 w-4" />
          Market Research
        </NavLink>
        <NavLink
          to="/regulatory"
          className="inline-flex items-center gap-2 rounded-lg border bg-background px-4 py-2 text-sm font-medium shadow-sm hover:bg-muted"
        >
          <FileText className="h-4 w-4" />
          Regulatory Docs
        </NavLink>
      </div>
    </div>
  );
}

// ── Pitch document registry ───────────────────────────────────────────────────

const IR_DOC_TYPES = ["510K", "PMA", "DHF", "SPEC", "RISK_MANAGEMENT_FILE"];

function PitchDocCard({ doc }: { doc: RegDoc }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [copied, setCopied] = useState(false);

  async function generateDraft() {
    setLoadingDraft(true);
    try {
      const result = await draftRegDocContent(doc.id);
      setDraft(result.content);
    } finally {
      setLoadingDraft(false);
    }
  }

  function copyDraft() {
    if (!draft) return;
    navigator.clipboard.writeText(draft);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-2 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="inline-block rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 text-xs px-2 py-0.5 font-medium mr-2">
            {doc.doc_type}
          </span>
          <span className="text-xs text-muted-foreground">{doc.doc_number || "—"}</span>
        </div>
        <span
          className={cn(
            "text-xs rounded-full px-2 py-0.5 font-medium",
            doc.status === "effective"
              ? "bg-emerald-100 text-emerald-700"
              : doc.status === "approved"
              ? "bg-green-100 text-green-700"
              : "bg-yellow-100 text-yellow-800"
          )}
        >
          {doc.status}
        </span>
      </div>
      <p className="text-sm font-medium">{doc.title}</p>
      {doc.related_standards?.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {doc.related_standards.join(" · ")}
        </p>
      )}
      <div className="flex gap-2 pt-1">
        <button
          onClick={generateDraft}
          disabled={loadingDraft}
          className="inline-flex items-center gap-1.5 text-xs rounded-md border px-2.5 py-1 hover:bg-muted disabled:opacity-60"
        >
          {loadingDraft ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Sparkles className="h-3 w-3 text-primary" />
          )}
          AI Draft
        </button>
        {draft && (
          <button
            onClick={copyDraft}
            className="inline-flex items-center gap-1.5 text-xs rounded-md border px-2.5 py-1 hover:bg-muted"
          >
            {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
            Copy
          </button>
        )}
      </div>
      {draft && (
        <pre className="mt-2 max-h-48 overflow-y-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap font-sans">
          {draft}
        </pre>
      )}
    </div>
  );
}

function PitchDocRegistry() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newType, setNewType] = useState("510K");
  const [newDocNum, setNewDocNum] = useState("");

  const { data: allDocs = [], isLoading } = useQuery({
    queryKey: ["reg-docs"],
    queryFn: () => listRegDocs(),
  });

  const irDocs = allDocs.filter((d) => IR_DOC_TYPES.includes(d.doc_type));

  const createMutation = useMutation({
    mutationFn: (body: RegDocCreate) => createRegDoc(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reg-docs"] });
      setShowForm(false);
      setNewTitle("");
      setNewDocNum("");
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Investor-Relevant Regulatory Docs
        </h2>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-1 text-xs rounded-md border px-2.5 py-1 hover:bg-muted"
        >
          <Plus className="h-3 w-3" /> Add Doc
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!newTitle.trim()) return;
            createMutation.mutate({ doc_type: newType, title: newTitle.trim(), doc_number: newDocNum || undefined });
          }}
          className="rounded-lg border bg-card p-4 space-y-2 shadow-sm"
        >
          <div className="flex gap-2">
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value)}
              className="rounded-md border bg-background px-2 py-1.5 text-sm"
            >
              {IR_DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input
              value={newDocNum}
              onChange={(e) => setNewDocNum(e.target.value)}
              placeholder="Doc # (optional)"
              className="w-36 rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <input
            autoFocus
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Document title"
            required
            className="w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setShowForm(false)}
              className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted">Cancel</button>
            <button type="submit" disabled={createMutation.isPending}
              className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium hover:bg-primary/90 disabled:opacity-60">
              {createMutation.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading documents…
        </div>
      ) : irDocs.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">
          No investor-relevant regulatory docs yet. Add 510(k), DHF, or spec documents.
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {irDocs.map((doc) => <PitchDocCard key={doc.id} doc={doc} />)}
        </div>
      )}
    </div>
  );
}

// ── Recent research ───────────────────────────────────────────────────────────

function RecentResearch() {
  const { data: reports = [] } = useQuery({
    queryKey: ["research"],
    queryFn: listResearchReports,
  });

  const recent = reports.filter((r) => r.status === "completed").slice(0, 4);

  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Recent Research Reports
        </h2>
        <NavLink
          to="/research"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          View all <ChevronRight className="h-3 w-3" />
        </NavLink>
      </div>
      {recent.length === 0 ? (
        <p className="text-sm text-muted-foreground">No completed research reports yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {recent.map((r) => (
            <li key={r.id} className="py-2 flex items-center justify-between gap-2">
              <span className="text-sm truncate">{r.title || r.query}</span>
              <NavLink
                to="/research"
                className="flex-shrink-0 text-xs text-muted-foreground hover:text-foreground"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function InvestorPage() {
  return (
    <div className="flex flex-col gap-6 p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
          <TrendingUp className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Investor Relations</h1>
          <p className="text-sm text-muted-foreground">
            Pitch context, regulatory proof-points, and IR communications hub
          </p>
        </div>
      </div>

      {/* Top row: metrics + quick actions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MetricsPanel />
        <QuickActions />
      </div>

      {/* Pitch doc registry */}
      <PitchDocRegistry />

      {/* Recent research */}
      <RecentResearch />
    </div>
  );
}
