import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listPendingApprovals, resolveApproval, clearExpiredApprovals } from "@/api/chat";
import type { ApprovalIntent } from "@/types/chat";
import { ShieldCheck, ShieldX, Clock, Trash2, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

const RISK_STYLES: Record<string, string> = {
  low: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  critical: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

function ApprovalCard({ intent, onResolve }: {
  intent: ApprovalIntent;
  onResolve: (approved: boolean, reason?: string) => Promise<ApprovalIntent>;
}) {
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectBox, setShowRejectBox] = useState(false);
  const [executionResult, setExecutionResult] = useState<Record<string, unknown> | null>(null);
  const [resolving, setResolving] = useState(false);

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
    <div className="rounded-xl border bg-card p-5 shadow-sm">
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

      {/* Payload preview */}
      {Object.keys(intent.intent_payload).length > 0 && (
        <pre className="mb-3 overflow-x-auto rounded-lg bg-muted p-3 text-xs">
          {JSON.stringify(intent.intent_payload, null, 2)}
        </pre>
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
          {executionResult.status === "error" && executionResult.detail && (
            <p className="text-destructive/80 text-xs">{String(executionResult.detail)}</p>
          )}
          {executionResult.status === "executed" && executionResult.message_id && (
            <p className="text-green-600/80">Message ID: {String(executionResult.message_id)}</p>
          )}
          {executionResult.status === "executed" && executionResult.url && (
            <a href={String(executionResult.url)} target="_blank" rel="noopener noreferrer"
               className="text-primary underline">Open in Google ↗</a>
          )}
        </div>
      )}

      {/* Actions */}}
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

export function ApprovalsPage() {
  const queryClient = useQueryClient();

  const { data: pending = [], isLoading } = useQuery({
    queryKey: ["approvals", "pending"],
    queryFn: listPendingApprovals,
    refetchInterval: 15_000,
  });

  const resolveMutation = useMutation({
    mutationFn: ({
      id,
      approved,
      reason,
    }: {
      id: string;
      approved: boolean;
      reason?: string;
    }) => resolveApproval(id, { approved, rejection_reason: reason }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["approvals"] }),
  });

  const resolveWithResult = async (id: string, approved: boolean, reason?: string) => {
    return resolveMutation.mutateAsync({ id, approved, reason });
  };

  const clearExpiredMutation = useMutation({
    mutationFn: clearExpiredApprovals,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["approvals"] }),
  });

  const expiredCount = pending.filter(
    (a) => a.expires_at && new Date(a.expires_at) < new Date()
  ).length;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Pending Approvals</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Actions requested by the AI that require your explicit sign-off.
          </p>
        </div>
        {expiredCount > 0 && (
          <button
            onClick={() => clearExpiredMutation.mutate()}
            disabled={clearExpiredMutation.isPending}
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-destructive/40 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
            {clearExpiredMutation.isPending
              ? "Clearing…"
              : `Clear ${expiredCount} expired`}
          </button>
        )}
      </div>

      {isLoading && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}

      {!isLoading && pending.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
          <ShieldCheck className="h-8 w-8 opacity-40" />
          <p className="text-sm">No pending approvals.</p>
        </div>
      )}

      {pending.map((intent) => (
        <ApprovalCard
          key={intent.id}
          intent={intent}
          onResolve={(approved, reason) =>
            resolveWithResult(intent.id, approved, reason)
          }
        />
      ))}
    </div>
  );
}
