/**
 * The sales pipeline: every lead, the stage it is in, and its history.
 * Stages across the top, the leads in the chosen stage as a list, and the
 * lead you click opened beside it.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { Download, Loader2, Mail, Plus, Search, Send, X } from "lucide-react";

import {
  addLeadNote,
  checkWebsiteInquiries,
  createLead,
  getLead,
  importFromOdoo,
  listLeads,
  listStages,
  updateLead,
} from "@/api/pipeline";
import type { ImportReport, LeadChanges, LeadStatus, PipelineLead, PipelineLeadDetail } from "@/api/pipeline";
import { EmailLeadsDialog } from "@/components/pipeline/EmailLeadsDialog";
import { useHubStatus } from "@/hooks/useAllWork";
import { BRAND } from "@/lib/brand";
import { useAuthStore } from "@/stores/authStore";

const STATUS_LABEL: Record<LeadStatus | "", string> = { open: "Open", won: "Won", lost: "Lost", "": "All" };

function errorText(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const detail = err.response?.data?.detail;
    if (typeof detail === "string") return detail;
    if (!err.response) return "Could not reach the server.";
  }
  return fallback;
}

function day(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "";
}

export function PipelinePage() {
  const qc = useQueryClient();
  const hub = useHubStatus();
  const isAdmin = useAuthStore((s) => s.user?.role) === "admin";
  const reachable = hub.data?.here === true || hub.data?.connected === true;

  const [stageId, setStageId] = useState("");
  const [status, setStatus] = useState<LeadStatus | "">("open");
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [emailing, setEmailing] = useState<{ leads: PipelineLead[]; single: boolean } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(typed.trim()), 300);
    return () => clearTimeout(t);
  }, [typed]);

  const stages = useQuery({ queryKey: ["pipeline", "stages"], queryFn: listStages, enabled: reachable });
  const leads = useQuery({
    queryKey: ["pipeline", "leads", stageId, status, q],
    queryFn: () => listLeads({ stage_id: stageId || undefined, status, q: q || undefined }),
    enabled: reachable,
  });

  const refresh = () => void qc.invalidateQueries({ queryKey: ["pipeline"] });

  const [websiteNote, setWebsiteNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const checkWebsite = useMutation({
    mutationFn: checkWebsiteInquiries,
    onSuccess: (r) => {
      const parts: string[] = [];
      if (r.new_leads) {
        parts.push(`${r.new_leads} new lead${r.new_leads === 1 ? "" : "s"} from the website: ${r.titles.join(", ")}.`);
      }
      if (r.added_to_existing) {
        parts.push(
          `${r.added_to_existing} inquir${r.added_to_existing === 1 ? "y" : "ies"} added to the history of leads already here.`,
        );
      }
      if (!parts.length) parts.push("Nothing new from the website form.");
      if (r.more_to_read) parts.push("Older mail is still being read; that carries on by itself.");
      setWebsiteNote({ text: parts.join(" ") });
      if (r.new_leads || r.added_to_existing) refresh();
    },
    onError: (e) => setWebsiteNote({ text: errorText(e, "The inbox could not be checked."), bad: true }),
  });

  if (hub.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!reachable) {
    return (
      <div className="max-w-xl rounded-lg border p-5 text-sm">
        <p className="font-medium">The pipeline is kept on the hub.</p>
        <p className="mt-1 text-muted-foreground">
          Connect this computer to the hub under Settings → Connections, and the company&apos;s leads appear here.
        </p>
      </div>
    );
  }

  const totalOpen = (stages.data ?? []).reduce((n, s) => n + s.open, 0);
  const tab = (active: boolean) =>
    `whitespace-nowrap rounded-md border px-3 py-1.5 text-sm ${
      active ? "border-primary bg-primary/10 font-medium text-primary" : "hover:bg-accent"
    }`;

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold">Pipeline</h1>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Search leads"
            aria-label="Search leads"
            className="w-56 rounded-md border bg-background py-2 pl-8 pr-3 text-sm"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as LeadStatus | "")}
          aria-label="Status"
          className="rounded-md border bg-background px-2 py-2 text-sm"
        >
          {(["open", "won", "lost", ""] as const).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        {isAdmin && BRAND.erpDefault === "odoo" && (
          <button onClick={() => setImporting(true)} className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm hover:bg-accent">
            <Download className="h-4 w-4" /> Import from Odoo
          </button>
        )}
        {BRAND.websiteInquiries && (
          <button
            onClick={() => checkWebsite.mutate()}
            disabled={checkWebsite.isPending}
            title="New website form submissions in your inbox are added here every few minutes. This checks now."
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm hover:bg-accent disabled:opacity-60"
          >
            {checkWebsite.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
            {checkWebsite.isPending ? "Checking your inbox…" : "Check website inquiries"}
          </button>
        )}
        <button
          onClick={() => setEmailing({ leads: leads.data ?? [], single: false })}
          disabled={!leads.data?.length}
          title="Send an email to the leads shown here, or to the ones you tick. Each person gets their own copy."
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm hover:bg-accent disabled:opacity-60"
        >
          <Send className="h-4 w-4" /> Email leads
        </button>
        <button
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> New lead
        </button>
      </div>
      {websiteNote && (
        <p className={`text-sm ${websiteNote.bad ? "text-destructive" : "text-muted-foreground"}`} role="status">
          {websiteNote.text}
        </p>
      )}

      <div className="flex gap-2 overflow-x-auto pb-1">
        <button onClick={() => setStageId("")} className={tab(stageId === "")}>
          All stages <span className="text-muted-foreground">{totalOpen}</span>
        </button>
        {(stages.data ?? []).map((s) => (
          <button key={s.id} onClick={() => setStageId(s.id)} className={tab(stageId === s.id)}>
            {s.name} <span className="text-muted-foreground">{s.open}</span>
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        <div className={`min-w-0 flex-1 overflow-y-auto rounded-lg border ${openId ? "hidden lg:block" : ""}`}>
          {leads.isLoading ? (
            <p className="p-4 text-sm text-muted-foreground">Loading…</p>
          ) : leads.isError ? (
            <p className="p-4 text-sm text-destructive">{errorText(leads.error, "Could not load the pipeline.")}</p>
          ) : !leads.data?.length ? (
            <p className="p-4 text-sm text-muted-foreground">
              {q ? `Nothing matches "${q}".` : "No leads here yet."}
            </p>
          ) : (
            <ul className="divide-y">
              {leads.data.map((lead) => (
                <LeadRow key={lead.id} lead={lead} active={lead.id === openId} showStage={!stageId} onOpen={() => setOpenId(lead.id)} />
              ))}
            </ul>
          )}
        </div>
        {openId && (
          <LeadPanel
            key={openId}
            id={openId}
            stages={stages.data ?? []}
            onClose={() => setOpenId(null)}
            onChanged={refresh}
            onEmail={(lead) => setEmailing({ leads: [lead], single: true })}
          />
        )}
      </div>

      {emailing && (
        <EmailLeadsDialog
          leads={emailing.leads}
          single={emailing.single}
          onClose={() => setEmailing(null)}
          onSent={refresh}
        />
      )}
      {adding && (
        <NewLead
          stageId={stageId}
          onClose={() => setAdding(false)}
          onCreated={(lead) => {
            setAdding(false);
            refresh();
            setOpenId(lead.id);
          }}
        />
      )}
      {importing && <OdooImport onClose={() => setImporting(false)} onDone={refresh} />}
    </div>
  );
}

function LeadRow({ lead, active, showStage, onOpen }: { lead: PipelineLead; active: boolean; showStage: boolean; onOpen: () => void }) {
  const who = [lead.contact_name, lead.contact_title].filter(Boolean).join(", ");
  return (
    <li>
      <button onClick={onOpen} className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-accent ${active ? "bg-accent" : ""}`}>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{lead.title}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {[lead.company !== lead.title ? lead.company : "", who, lead.email].filter(Boolean).join(" · ")}
          </span>
          {lead.next_step && (
            <span className="mt-0.5 block truncate text-xs">
              Next: {lead.next_step}
              {lead.next_step_due ? ` (due ${day(lead.next_step_due)})` : ""}
            </span>
          )}
        </span>
        <span className="shrink-0 text-right text-xs text-muted-foreground">
          {showStage && <span className="block">{lead.stage}</span>}
          {lead.status !== "open" && <span className="block font-medium">{STATUS_LABEL[lead.status]}</span>}
          <span className="block">{day(lead.last_note_at ?? lead.updated_at)}</span>
        </span>
      </button>
    </li>
  );
}

const FIELDS: { key: keyof LeadChanges; label: string }[] = [
  { key: "title", label: "Title" },
  { key: "company", label: "Company" },
  { key: "contact_name", label: "Contact" },
  { key: "contact_title", label: "Role" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "address", label: "Address" },
];

function LeadPanel({
  id,
  stages,
  onClose,
  onChanged,
  onEmail,
}: {
  id: string;
  stages: { id: string; name: string }[];
  onClose: () => void;
  onChanged: () => void;
  onEmail: (lead: PipelineLead) => void;
}) {
  const qc = useQueryClient();
  const lead = useQuery({ queryKey: ["pipeline", "lead", id], queryFn: () => getLead(id) });
  const [draft, setDraft] = useState<LeadChanges>({});
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const done = (data: PipelineLeadDetail) => {
    qc.setQueryData(["pipeline", "lead", id], data);
    setDraft({});
    setError(null);
    onChanged();
  };
  const save = useMutation({
    mutationFn: (changes: LeadChanges) => updateLead(id, changes),
    onSuccess: done,
    onError: (e) => setError(errorText(e, "Could not save.")),
  });
  const post = useMutation({
    mutationFn: () => addLeadNote(id, note),
    onSuccess: (data) => {
      setNote("");
      done(data);
    },
    onError: (e) => setError(errorText(e, "Could not add the note.")),
  });

  const data = lead.data;
  const value = <K extends keyof LeadChanges>(key: K): string => {
    const v = key in draft ? draft[key] : data?.[key];
    return v === null || v === undefined ? "" : String(v);
  };
  const set = (key: keyof LeadChanges, v: string) =>
    setDraft((d) => ({ ...d, [key]: key === "value" ? (v === "" ? null : Number(v)) : key === "next_step_due" ? v || null : v }));
  const dirty = Object.keys(draft).length > 0;
  const input = "w-full rounded-md border bg-background px-2 py-1.5 text-sm";

  return (
    <aside className="flex w-full min-w-0 flex-col overflow-hidden rounded-lg border lg:w-[30rem] lg:shrink-0" aria-label="Lead">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{data?.title ?? "Lead"}</h2>
        {data?.email && (
          <button onClick={() => onEmail(data)} className="rounded-md p-1 hover:bg-accent" aria-label="Email this contact" title="Email this contact">
            <Mail className="h-4 w-4" />
          </button>
        )}
        <button onClick={onClose} className="rounded-md p-1 hover:bg-accent" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>
      {!data ? (
        <p className="p-4 text-sm text-muted-foreground">{lead.isError ? "Could not load this lead." : "Loading…"}</p>
      ) : (
        <div className="space-y-4 overflow-y-auto p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={data.stage_id}
              onChange={(e) => save.mutate({ stage_id: e.target.value })}
              aria-label="Stage"
              className="rounded-md border bg-background px-2 py-1.5 text-sm"
            >
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {(["open", "won", "lost"] as const).map((s) => (
              <button
                key={s}
                onClick={() => data.status !== s && save.mutate({ status: s })}
                className={`rounded-md border px-2.5 py-1.5 text-xs ${
                  data.status === s ? "border-primary bg-primary/10 font-medium text-primary" : "hover:bg-accent"
                }`}
              >
                {STATUS_LABEL[s]}
              </button>
            ))}
            {data.owner_name && <span className="ml-auto text-xs text-muted-foreground">Owner: {data.owner_name}</span>}
          </div>

          <div className="grid grid-cols-[5.5rem_1fr] items-center gap-x-2 gap-y-1.5">
            <label className="text-xs text-muted-foreground" htmlFor="lead-next">Next step</label>
            <input id="lead-next" className={input} value={value("next_step")} onChange={(e) => set("next_step", e.target.value)} />
            <label className="text-xs text-muted-foreground" htmlFor="lead-due">Due</label>
            <input id="lead-due" type="date" className={input} value={value("next_step_due")} onChange={(e) => set("next_step_due", e.target.value)} />
            <label className="text-xs text-muted-foreground" htmlFor="lead-value">Value</label>
            <input id="lead-value" type="number" min="0" className={input} value={value("value")} onChange={(e) => set("value", e.target.value)} />
            {FIELDS.map((f) => (
              <FieldRow key={f.key} id={`lead-${f.key}`} label={f.label} className={input} value={value(f.key)} onChange={(v) => set(f.key, v)} />
            ))}
            <label className="self-start pt-1.5 text-xs text-muted-foreground" htmlFor="lead-details">Details</label>
            <textarea id="lead-details" rows={4} className={input} value={value("details")} onChange={(e) => set("details", e.target.value)} />
          </div>
          {dirty && (
            <div className="flex gap-2">
              <button
                onClick={() => save.mutate(draft)}
                disabled={save.isPending}
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                Save changes
              </button>
              <button onClick={() => setDraft({})} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
                Discard
              </button>
            </div>
          )}
          {error && <p className="text-xs text-destructive" role="status">{error}</p>}

          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">History</p>
            <div className="flex gap-2">
              <textarea
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Add a note: a call, what was agreed, what comes next"
                aria-label="New note"
                className={input}
              />
              <button
                onClick={() => post.mutate()}
                disabled={!note.trim() || post.isPending}
                className="self-end rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-60"
              >
                Add
              </button>
            </div>
            <ul className="mt-3 space-y-3">
              {data.notes.map((n) => (
                <li key={n.id} className={n.kind === "event" ? "text-xs text-muted-foreground" : ""}>
                  <p className="text-xs text-muted-foreground">
                    {day(n.occurred_at)}
                    {n.author_name ? ` · ${n.author_name}` : ""}
                    {n.kind === "email" ? " · email" : ""}
                  </p>
                  <p className="whitespace-pre-wrap">{n.body}</p>
                </li>
              ))}
              <li className="text-xs text-muted-foreground">
                Added {day(data.created_at)}
                {data.source === "odoo" ? " · imported from Odoo" : ""}
              </li>
            </ul>
          </div>
        </div>
      )}
    </aside>
  );
}

function FieldRow({ id, label, value, className, onChange }: { id: string; label: string; value: string; className: string; onChange: (v: string) => void }) {
  return (
    <>
      <label className="text-xs text-muted-foreground" htmlFor={id}>{label}</label>
      <input id={id} className={className} value={value} onChange={(e) => onChange(e.target.value)} />
    </>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} data-state="open" className="w-full max-w-md rounded-xl border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-accent" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3 px-5 py-4 text-sm">{children}</div>
      </div>
    </div>
  );
}

function NewLead({ stageId, onClose, onCreated }: { stageId: string; onClose: () => void; onCreated: (lead: PipelineLeadDetail) => void }) {
  const [form, setForm] = useState({ title: "", company: "", contact_name: "", email: "" });
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => createLead({ ...form, ...(stageId ? { stage_id: stageId } : {}) }),
    onSuccess: onCreated,
    onError: (e) => setError(errorText(e, "Could not add the lead.")),
  });
  const input = "w-full rounded-md border bg-background px-3 py-2 text-sm";
  const field = (key: keyof typeof form, label: string, type = "text") => (
    <label className="block">
      <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
      <input type={type} className={input} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
    </label>
  );
  return (
    <Modal title="New lead" onClose={onClose}>
      {field("title", "Title (the customer or the opportunity)")}
      {field("company", "Company")}
      {field("contact_name", "Contact")}
      {field("email", "Email", "email")}
      {error && <p className="text-xs text-destructive" role="status">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onClose} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">Cancel</button>
        <button
          onClick={() => create.mutate()}
          disabled={!form.title.trim() || create.isPending}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          Add lead
        </button>
      </div>
    </Modal>
  );
}

function OdooImport({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: (dryRun: boolean) => importFromOdoo(dryRun),
    onSuccess: (r) => {
      setReport(r);
      setError(null);
      if (!r.dry_run) onDone();
    },
    onError: (e) => setError(errorText(e, "The import did not run.")),
  });
  // Look first: the count of what would come across, before anything is written.
  useEffect(() => {
    run.mutate(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nothing = report && report.leads.new === 0 && report.notes.new === 0 && report.stages.new.length === 0;
  return (
    <Modal title="Import from Odoo" onClose={onClose}>
      {run.isPending && (
        <p className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {report ? "Importing…" : "Reading Odoo…"}
        </p>
      )}
      {error && <p className="text-destructive" role="status">{error}</p>}
      {report && !run.isPending && (
        <>
          <p className="font-medium">
            {report.dry_run ? (nothing ? "Everything in Odoo is already here." : "This would bring across:") : "Imported:"}
          </p>
          {!nothing && (
            <ul className="space-y-1">
              <li>
                {report.leads.new} lead{report.leads.new === 1 ? "" : "s"}
                {report.leads.existing ? ` (${report.leads.existing} already here, left as they are)` : ""}
              </li>
              {Object.entries(report.leads.by_stage).map(([name, n]) => (
                <li key={name} className="pl-4 text-xs text-muted-foreground">
                  {name}: {n}
                </li>
              ))}
              <li>
                {report.notes.new} note{report.notes.new === 1 ? "" : "s"} of history
              </li>
              {report.stages.new.length > 0 && <li>New stages: {report.stages.new.join(", ")}</li>}
              {report.owners_without_account.length > 0 && (
                <li className="text-xs text-muted-foreground">
                  Owner kept as a name only (no account here): {report.owners_without_account.join(", ")}
                </li>
              )}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            Odoo is only read. Running this again later brings anything new and changes nothing that is already here.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
              {report.dry_run && !nothing ? "Cancel" : "Close"}
            </button>
            {report.dry_run && !nothing && (
              <button
                onClick={() => run.mutate(false)}
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Import
              </button>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
