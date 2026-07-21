import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Mail,
  Plus,
  Sparkles,
  Trash2,
  Send,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Loader2,
  Clock,
  CheckCircle,
  XCircle,
  Edit3,
  Paperclip,
  ShieldCheck,
  ShieldX,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  listEmailDrafts,
  createEmailDraft,
  updateEmailDraft,
  regenerateEmailDraft,
  submitEmailForApproval,
  deleteEmailDraft,
} from "@/api/meetings";
import { resolveApproval } from "@/api/chat";
import { pushApprovalOutcomeToast } from "@/stores/toastStore";
import type { EmailDraft, EmailDraftCreate, EmailDraftUpdate } from "@/types/meetings";
import { EMAIL_TONES } from "@/types/meetings";
import { AskGerryButton } from "@/components/AskGerryButton";

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: EmailDraft["status"] }) {
  const configs: Record<string, { label: string; classes: string; Icon: React.ElementType }> = {
    draft: { label: "Draft", classes: "bg-muted text-muted-foreground", Icon: Edit3 },
    pending_approval: { label: "Pending Approval", classes: "bg-yellow-100 text-yellow-700", Icon: Clock },
    approved: { label: "Approved", classes: "bg-green-100 text-green-700", Icon: CheckCircle },
    rejected: { label: "Rejected", classes: "bg-red-100 text-red-700", Icon: XCircle },
  };
  const { label, classes, Icon } = configs[status] ?? configs.draft;
  return (
    <span className={cn("flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", classes)}>
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

// ── New Draft Form ────────────────────────────────────────────────────────────

function NewDraftForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<EmailDraftCreate>({
    subject: "",
    purpose: "",
    tone: "professional",
    recipient_name: "",
    recipient_email: "",
    cc: "",
    bcc: "",
    key_points: "",
  });

  const set = (field: keyof EmailDraftCreate, value: string) =>
    setForm((p) => ({ ...p, [field]: value }));

  const mutation = useMutation({
    mutationFn: () => createEmailDraft(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["email-drafts"] });
      onClose();
    },
    onError: (err: Error) => {
      // error shown below the submit button
      console.error("Email draft creation failed:", err);
    },
  });

  return (
    <div className="rounded-xl border bg-card shadow-sm p-5 space-y-4">
      <h2 className="font-semibold text-base flex items-center gap-2">
        <Mail className="h-4 w-4 text-primary" />
        New Email Draft
      </h2>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Subject *</label>
        <input
          value={form.subject}
          onChange={(e) => set("subject", e.target.value)}
          placeholder="e.g. Follow-up on 510(k) submission timeline"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Recipient Name</label>
          <input
            value={form.recipient_name}
            onChange={(e) => set("recipient_name", e.target.value)}
            placeholder="Dr. Jane Smith"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Recipient Email</label>
          <input
            type="email"
            value={form.recipient_email}
            onChange={(e) => set("recipient_email", e.target.value)}
            placeholder="jane@example.com"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">CC (comma-separated)</label>
          <input
            value={form.cc}
            onChange={(e) => set("cc", e.target.value)}
            placeholder="matthew@example.com, lindsey@example.com"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">BCC (comma-separated)</label>
          <input
            value={form.bcc}
            onChange={(e) => set("bcc", e.target.value)}
            placeholder=""
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Tone</label>
        <select
          value={form.tone}
          onChange={(e) => set("tone", e.target.value)}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          {EMAIL_TONES.map((t) => (
            <option key={t} value={t}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          Purpose *{" "}
          <span className="font-normal">(what should this email accomplish?)</span>
        </label>
        <textarea
          value={form.purpose}
          onChange={(e) => set("purpose", e.target.value)}
          rows={3}
          placeholder="e.g. Request an update on the FDA feedback timeline, ask if they need any additional documentation, and propose a call next week."
          className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring resize-none"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          Key Points <span className="font-normal">(optional bullet notes)</span>
        </label>
        <textarea
          value={form.key_points}
          onChange={(e) => set("key_points", e.target.value)}
          rows={3}
          placeholder="- Mention the Q3 deadline&#10;- Reference our last call on May 15&#10;- Keep it under 200 words"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring resize-none"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => mutation.mutate()}
          disabled={!form.subject || !form.purpose || mutation.isPending}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {mutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {mutation.isPending ? "Generating draft…" : "Generate Draft"}
        </button>
        <button
          onClick={onClose}
          className="rounded-md px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent"
        >
          Cancel
        </button>
      </div>

      {mutation.isError && (
        <p className="text-xs text-destructive">
          Failed to generate draft: {(mutation.error as Error)?.message ?? "Unknown error"}
        </p>
      )}
    </div>
  );
}

// ── Draft Card ────────────────────────────────────────────────────────────────

function DraftCard({ draft }: { draft: EmailDraft }) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [editingBody, setEditingBody] = useState(false);
  const [editedBody, setEditedBody] = useState(draft.draft_body ?? "");
  const [sendOutcome, setSendOutcome] = useState<{ kind: "ok" | "error"; text: string } | null>(
    null,
  );

  const regenMutation = useMutation({
    mutationFn: () => regenerateEmailDraft(draft.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["email-drafts"] }),
  });

  const saveMutation = useMutation({
    mutationFn: (body: EmailDraftUpdate) => updateEmailDraft(draft.id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["email-drafts"] });
      setEditingBody(false);
    },
  });

  const submitMutation = useMutation({
    mutationFn: () => submitEmailForApproval(draft.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["email-drafts"] }),
  });

  // Approve (and send) or reject the linked approval right from this card.
  const resolveMutation = useMutation({
    mutationFn: (approved: boolean) =>
      resolveApproval(draft.approval_intent_id!, { approved }),
    onSuccess: (result, approved) => {
      pushApprovalOutcomeToast(result, approved);
      const exec = result.execution_result;
      if (!approved) {
        setSendOutcome({ kind: "ok", text: "Rejected — returned to Drafts for editing." });
      } else if (exec?.status === "executed") {
        setSendOutcome({ kind: "ok", text: "Approved and sent." });
      } else if (exec?.status === "error") {
        setSendOutcome({
          kind: "error",
          text: String(exec.detail ?? "Sending failed — the draft was returned to Drafts."),
        });
      } else {
        setSendOutcome({ kind: "ok", text: "Approved." });
      }
      qc.invalidateQueries({ queryKey: ["email-drafts"] });
      qc.invalidateQueries({ queryKey: ["approvals"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (e: unknown) => {
      const status = (e as { response?: { status?: number } })?.response?.status;
      setSendOutcome({
        kind: "error",
        text:
          status === 409 || status === 404
            ? "This approval was already handled elsewhere."
            : "Couldn't resolve the approval. Please try again.",
      });
      qc.invalidateQueries({ queryKey: ["email-drafts"] });
      qc.invalidateQueries({ queryKey: ["approvals"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteEmailDraft(draft.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["email-drafts"] }),
  });

  const canEdit = draft.status === "draft";
  const canResolve = draft.status === "pending_approval" && !!draft.approval_intent_id;

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between px-5 pt-4 pb-3">
        <div className="flex-1 min-w-0 pr-4">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-sm">{draft.subject}</h3>
            <StatusBadge status={draft.status} />
          </div>
          <div className="mt-1 text-xs text-muted-foreground flex flex-wrap gap-3">
            {draft.recipient_name && (
              <span>To: {draft.recipient_name}{draft.recipient_email ? ` <${draft.recipient_email}>` : ""}</span>
            )}
            {draft.cc && <span>CC: {draft.cc}</span>}
            {draft.bcc && <span>BCC: {draft.bcc}</span>}
            <span className="capitalize">Tone: {draft.tone}</span>
            <span>{new Date(draft.created_at).toLocaleDateString()}</span>
          </div>
          {(draft.attachments?.length ?? 0) > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {draft.attachments.map((a) => (
                <a
                  key={a.filename}
                  href={`/api/files/${encodeURIComponent(a.filename)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent"
                  title="Attached on send — click to preview the file"
                >
                  <Paperclip className="h-3 w-3" /> {a.display_name}
                </a>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <AskGerryButton
            className="p-1.5 hover:bg-accent"
            build={() => ({
              title: `Email: ${draft.subject}`,
              prompt:
                `I'd like your help with this email draft.\n\n` +
                `Subject: ${draft.subject}\n` +
                (draft.recipient_name || draft.recipient_email
                  ? `To: ${draft.recipient_name ?? ""}${draft.recipient_email ? ` <${draft.recipient_email}>` : ""}\n`
                  : "") +
                `Tone: ${draft.tone}\n` +
                (draft.purpose ? `Purpose: ${draft.purpose}\n` : "") +
                (draft.draft_body ? `\n---\n${draft.draft_body}\n---\n` : "") +
                `\nCan you review it and suggest improvements?`,
            })}
          />
          {canEdit && draft.draft_body && (
            <button
              onClick={() => submitMutation.mutate()}
              disabled={submitMutation.isPending}
              title="Submit for approval (human review required before send)"
              className="flex items-center gap-1.5 rounded-md bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
            >
              {submitMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Send className="h-3 w-3" />
              )}
              Submit for Approval
            </button>
          )}
          {canResolve && (
            <>
              <button
                onClick={() => resolveMutation.mutate(true)}
                disabled={resolveMutation.isPending}
                title="Approve this draft and send it now"
                className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {resolveMutation.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <ShieldCheck className="h-3 w-3" />
                )}
                Approve &amp; Send
              </button>
              <button
                onClick={() => resolveMutation.mutate(false)}
                disabled={resolveMutation.isPending}
                title="Reject — returns the draft to an editable state"
                className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
              >
                <ShieldX className="h-3 w-3" />
                Reject
              </button>
            </>
          )}
          <button
            onClick={() => setExpanded((p) => !p)}
            className="rounded-md p-1.5 hover:bg-accent text-muted-foreground"
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          <button
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
            className="rounded-md p-1.5 hover:bg-destructive/10 text-muted-foreground hover:text-destructive disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Purpose preview */}
      <div className="px-5 pb-3">
        <p className="text-xs text-muted-foreground line-clamp-2">{draft.purpose}</p>
        {sendOutcome && (
          <p
            className={cn(
              "mt-1.5 flex items-center gap-1.5 text-xs font-medium",
              sendOutcome.kind === "ok" ? "text-green-600 dark:text-green-400" : "text-destructive",
            )}
          >
            {sendOutcome.kind === "ok" ? (
              <CheckCircle className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <XCircle className="h-3.5 w-3.5 shrink-0" />
            )}
            {sendOutcome.text}
          </p>
        )}
      </div>

      {/* Expanded */}
      {expanded && (
        <div className="border-t px-5 py-4 space-y-4 bg-muted/30">
          {/* Draft body */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Draft Email Body
              </p>
              <div className="flex items-center gap-2">
                {canEdit && !editingBody && (
                  <button
                    onClick={() => {
                      setEditedBody(draft.draft_body ?? "");
                      setEditingBody(true);
                    }}
                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                  >
                    <Edit3 className="h-3 w-3" /> Edit
                  </button>
                )}
                {canEdit && (
                  <button
                    onClick={() => regenMutation.mutate()}
                    disabled={regenMutation.isPending}
                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                  >
                    {regenMutation.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3 w-3" />
                    )}
                    Regenerate
                  </button>
                )}
              </div>
            </div>
            {editingBody ? (
              <div className="space-y-2">
                <textarea
                  value={editedBody}
                  onChange={(e) => setEditedBody(e.target.value)}
                  rows={10}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-ring resize-y"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => saveMutation.mutate({ draft_body: editedBody })}
                    disabled={saveMutation.isPending}
                    className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {saveMutation.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                    Save
                  </button>
                  <button
                    onClick={() => setEditingBody(false)}
                    className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <pre className="whitespace-pre-wrap text-sm font-sans bg-background border rounded-md p-4 leading-relaxed">
                {draft.draft_body ?? "No body generated yet."}
              </pre>
            )}
          </div>

          {/* Key points */}
          {draft.key_points && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                Key Points Provided
              </p>
              <pre className="whitespace-pre-wrap text-xs font-sans">{draft.key_points}</pre>
            </div>
          )}

          {/* Approval note */}
          {draft.status === "pending_approval" && (
            <div className="rounded-md bg-yellow-50 border border-yellow-200 px-4 py-3 text-xs text-yellow-800">
              <strong>Awaiting human approval.</strong> This email will NOT be sent until a team member
              approves it in the Approvals section. The AI never sends emails automatically.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function EmailsPage() {
  const [showForm, setShowForm] = useState(false);
  const { data: drafts = [], isLoading } = useQuery({
    queryKey: ["email-drafts"],
    queryFn: listEmailDrafts,
  });

  const pendingCount = drafts.filter((d) => d.status === "pending_approval").length;

  return (
    <div className="flex flex-col gap-6 p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Email Drafts</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            AI-assisted drafting — all sends require human approval
          </p>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            New Draft
          </button>
        )}
      </div>

      {/* Stats */}
      {drafts.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Total Drafts", value: drafts.length },
            { label: "Pending Approval", value: pendingCount },
            {
              label: "Approved",
              value: drafts.filter((d) => d.status === "approved").length,
            },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-xl border bg-card px-4 py-3 text-center">
              <p className="text-2xl font-bold">{value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Human-in-the-loop notice */}
      <div className="rounded-md bg-blue-50 border border-blue-200 px-4 py-3 text-xs text-blue-800 flex items-start gap-2">
        <Send className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>
          <strong>Human-in-the-loop enforced.</strong> Drafts must be submitted for approval and reviewed
          by a team member before any email is sent. The AI never sends emails automatically.
        </span>
      </div>

      {/* New draft form */}
      {showForm && <NewDraftForm onClose={() => setShowForm(false)} />}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading drafts…
        </div>
      )}

      {/* Empty state */}
      {!isLoading && drafts.length === 0 && !showForm && (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-3">
          <Mail className="h-10 w-10 opacity-30" />
          <p className="text-sm font-medium">No email drafts yet</p>
          <p className="text-xs max-w-sm">
            Describe who you're writing to and what you need — the AI will draft the email body for
            your review.
          </p>
        </div>
      )}

      {/* Drafts list */}
      <div className="space-y-4">
        {drafts.map((d) => (
          <DraftCard key={d.id} draft={d} />
        ))}
      </div>
    </div>
  );
}
