/**
 * Shared approval UI — used by the Approvals page, the global approvals
 * drawer, inline cards in Inbox threads, and inline cards in Chat.
 * One implementation so approve/edit/reject behaves identically everywhere.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listPendingApprovals,
  getPendingApprovalCount,
  resolveApproval,
  editApproval,
} from "@/api/chat";
import type { ApprovalIntent } from "@/types/chat";
import {
  ShieldCheck,
  ShieldX,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Pencil,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

export const RISK_STYLES: Record<string, string> = {
  low: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  critical: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

export function pick(payload: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = payload[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

/** Poll the pending-approval count for badges (header drawer trigger, etc.). */
export function usePendingApprovalCount(): number {
  const { data: count = 0 } = useQuery({
    queryKey: ["approvals", "count"],
    queryFn: getPendingApprovalCount,
    refetchInterval: 30_000,
  });
  return count;
}

/** Query pending approvals, optionally scoped to a conversation or Gmail thread. */
export function usePendingApprovals(params?: {
  conversation_id?: string;
  thread_id?: string;
  enabled?: boolean;
  refetchInterval?: number;
}) {
  const { enabled = true, refetchInterval = 30_000, ...filters } = params ?? {};
  return useQuery({
    queryKey: ["approvals", "pending", filters.conversation_id ?? null, filters.thread_id ?? null],
    queryFn: () => listPendingApprovals(filters),
    enabled,
    refetchInterval,
  });
}

/** Shared resolve mutation — invalidates every surface that shows approvals. */
export function useResolveApproval() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ id, approved, reason }: { id: string; approved: boolean; reason?: string }) =>
      resolveApproval(id, { approved, rejection_reason: reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["approvals"] });
      queryClient.invalidateQueries({ queryKey: ["email-drafts"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
  return (id: string, approved: boolean, reason?: string) =>
    mutation.mutateAsync({ id, approved, reason });
}

/** Friendly preview for an approval payload. Renders email intents as a
 *  readable To/Subject/Body card (preserving line breaks); falls back to
 *  formatted JSON for everything else. */
export function PayloadPreview({ intentType, payload }: {
  intentType: string;
  payload: Record<string, unknown>;
}) {
  if (intentType === "send_email" || intentType === "send_message") {
    const to = pick(payload, ["recipient_email", "recipient", "to", "recipient_name"]);
    const subject = pick(payload, ["subject", "title"]);
    const body = pick(payload, ["body", "draft_body", "message", "content"]);
    if (body || subject || to) {
      return (
        <div className="mb-3 rounded-lg border bg-muted/40 text-sm">
          {to && (
            <div className="flex gap-2 border-b px-3 py-2">
              <span className="w-16 shrink-0 font-medium text-muted-foreground">To</span>
              <span className="break-all">{to}</span>
            </div>
          )}
          {subject && (
            <div className="flex gap-2 border-b px-3 py-2">
              <span className="w-16 shrink-0 font-medium text-muted-foreground">Subject</span>
              <span className="font-medium">{subject}</span>
            </div>
          )}
          {body && (
            <div className="whitespace-pre-wrap px-3 py-2.5 leading-relaxed">{body}</div>
          )}
        </div>
      );
    }
  }
  return (
    <pre className="mb-3 overflow-x-auto rounded-lg bg-muted p-3 text-xs">
      {JSON.stringify(payload, null, 2)}
    </pre>
  );
}

export function ApprovalCard({ intent, onResolve, compact = false }: {
  intent: ApprovalIntent;
  onResolve: (approved: boolean, reason?: string) => Promise<ApprovalIntent>;
  /** Tighter paddings/body clamp for drawer + inline placements. */
  compact?: boolean;
}) {
  const queryClient = useQueryClient();
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectBox, setShowRejectBox] = useState(false);
  const [executionResult, setExecutionResult] = useState<Record<string, unknown> | null>(null);
  const [resolving, setResolving] = useState(false);

  const isEmail = intent.intent_type === "send_email" || intent.intent_type === "send_message";
  const [editing, setEditing] = useState(false);
  const [editTo, setEditTo] = useState("");
  const [editCc, setEditCc] = useState("");
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");

  function startEdit() {
    const p = intent.intent_payload;
    setEditTo(pick(p, ["to", "recipient_email", "recipient"]) ?? "");
    setEditCc(pick(p, ["cc"]) ?? "");
    setEditSubject(pick(p, ["subject", "title"]) ?? "");
    setEditBody(pick(p, ["body", "draft_body", "message", "content"]) ?? "");
    setEditing(true);
  }

  const editMutation = useMutation({
    mutationFn: () =>
      editApproval(intent.id, {
        to: editTo.trim(),
        cc: editCc.trim(),
        subject: editSubject.trim(),
        body: editBody,
      }),
    onSuccess: () => {
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ["approvals"] });
    },
  });

  const expiresAt = intent.expires_at ? new Date(intent.expires_at) : null;
  const isExpired = expiresAt !== null && expiresAt < new Date();

  const handleResolve = async (approved: boolean, reason?: string) => {
    setResolving(true);
    try {
      const result = await onResolve(approved, reason);
      if (result.execution_result) {
        setExecutionResult(result.execution_result);
      }
    } finally {
      setResolving(false);
      setShowRejectBox(false);
    }
  };

  return (
    <div className={cn("rounded-xl border bg-card shadow-sm", compact ? "p-4" : "p-5")}>
      {/* Header */}
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {intent.intent_type.replace(/_/g, " ")}
          </span>
          <p className="mt-0.5 font-medium">{intent.intent_title}</p>
          {intent.intent_description && (
            <p className="mt-0.5 text-sm text-muted-foreground">{intent.intent_description}</p>
          )}
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium",
            RISK_STYLES[intent.risk_level] ?? RISK_STYLES.medium,
          )}
        >
          {intent.risk_level} risk
        </span>
      </div>

      {/* Payload preview / editor */}
      {editing ? (
        <div className="mb-3 space-y-2 rounded-lg border bg-muted/40 p-3">
          <label className="block text-xs font-medium text-muted-foreground">
            To
            <input
              value={editTo}
              onChange={(e) => setEditTo(e.target.value)}
              className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <label className="block text-xs font-medium text-muted-foreground">
            Cc
            <input
              value={editCc}
              onChange={(e) => setEditCc(e.target.value)}
              placeholder="Comma-separated (optional)"
              className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <label className="block text-xs font-medium text-muted-foreground">
            Subject
            <input
              value={editSubject}
              onChange={(e) => setEditSubject(e.target.value)}
              className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <label className="block text-xs font-medium text-muted-foreground">
            Body
            <textarea
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              rows={compact ? 6 : 8}
              className="mt-1 w-full resize-y rounded-md border bg-background px-2 py-1.5 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          {editMutation.isError && (
            <p className="text-xs text-destructive">Couldn’t save changes. Please try again.</p>
          )}
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => editMutation.mutate()}
              disabled={editMutation.isPending || !editTo.trim() || !editSubject.trim()}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {editMutation.isPending ? "Saving…" : "Save changes"}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="rounded-md border px-3 py-1.5 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        Object.keys(intent.intent_payload).length > 0 && (
          <PayloadPreview intentType={intent.intent_type} payload={intent.intent_payload} />
        )
      )}

      {/* Expiry */}
      {expiresAt && (
        <div className="mb-4 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          {isExpired ? (
            <span className="text-destructive">Expired</span>
          ) : (
            <span>Expires {expiresAt.toLocaleString()}</span>
          )}
        </div>
      )}

      {/* Execution result (shown after approval) */}
      {executionResult && (
        <div className={cn(
          "mb-4 rounded-md border px-3 py-2.5 text-xs space-y-1",
          executionResult.status === "executed"
            ? "border-green-300 bg-green-50 dark:bg-green-950/30 dark:border-green-700"
            : executionResult.status === "error"
            ? "border-destructive/30 bg-destructive/10"
            : "border-muted bg-muted/50"
        )}>
          <p className={cn(
            "flex items-center gap-1.5 font-semibold",
            executionResult.status === "executed" ? "text-green-700 dark:text-green-400"
              : executionResult.status === "error" ? "text-destructive"
              : "text-muted-foreground"
          )}>
            {executionResult.status === "executed"
              ? <><CheckCircle2 className="h-3.5 w-3.5" /> Action executed successfully</>
              : executionResult.status === "error"
              ? <><XCircle className="h-3.5 w-3.5" /> Execution failed—action was still approved</>
              : <><AlertCircle className="h-3.5 w-3.5" /> {String(executionResult.detail ?? "No automated action")}</>}
          </p>
          {executionResult.status === "error" && executionResult.detail != null && (
            <p className="text-destructive/80 text-xs">{String(executionResult.detail)}</p>
          )}
          {executionResult.status === "executed" && executionResult.detail != null && (
            <p className="text-green-600/80">{String(executionResult.detail)}</p>
          )}
          {executionResult.status === "executed" && executionResult.message_id != null && (
            <p className="text-green-600/80">Message ID: {String(executionResult.message_id)}</p>
          )}
          {executionResult.status === "executed" && executionResult.url != null && (
            <a href={String(executionResult.url)} target="_blank" rel="noopener noreferrer"
               className="text-primary underline">
              {String(executionResult.action ?? "").startsWith("odoo:") ? "Open in Odoo ↗" : "Open in Google ↗"}
            </a>
          )}
        </div>
      )}

      {/* Actions */}
      {!isExpired && intent.status === "pending" && (
        <>
          {showRejectBox ? (
            <div className="space-y-2">
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Reason for rejection (optional)"
                rows={2}
                className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <div className="flex gap-2">
                <button
                  disabled={resolving}
                  onClick={() => handleResolve(false, rejectReason || undefined)}
                  className="flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground disabled:opacity-50"
                >
                  <ShieldX className="h-4 w-4" />
                  Confirm reject
                </button>
                <button
                  onClick={() => setShowRejectBox(false)}
                  className="rounded-md border px-3 py-1.5 text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                disabled={resolving}
                onClick={() => handleResolve(true)}
                className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                <ShieldCheck className="h-4 w-4" />
                {resolving ? "Approving…" : "Approve"}
              </button>
              {isEmail && !editing && (
                <button
                  disabled={resolving}
                  onClick={startEdit}
                  className="flex items-center gap-1.5 rounded-md border px-4 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
                >
                  <Pencil className="h-4 w-4" />
                  Edit
                </button>
              )}
              <button
                disabled={resolving}
                onClick={() => setShowRejectBox(true)}
                className="flex items-center gap-1.5 rounded-md border px-4 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
              >
                <ShieldX className="h-4 w-4" />
                Reject
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
