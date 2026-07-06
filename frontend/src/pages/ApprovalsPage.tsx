import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listPendingApprovals, resolveApproval, clearExpiredApprovals } from "@/api/chat";
import type { ApprovalIntent } from "@/types/chat";
import { ShieldCheck, Trash2, CheckCircle2, XCircle, AlertCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { ApprovalCard } from "@/components/approvals/ApprovalCard";

export function ApprovalsPage() {
  const queryClient = useQueryClient();
  const [outcome, setOutcome] = useState<
    { title: string; result: NonNullable<ApprovalIntent["execution_result"]> } | null
  >(null);

  const { data: pending = [], isLoading } = useQuery({
    queryKey: ["approvals", "pending"],
    queryFn: () => listPendingApprovals(),
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["approvals"] });
      // An approved/rejected email changes its draft status (sent, or returned
      // to "draft" on failure) — refresh the Email Drafts view to match.
      queryClient.invalidateQueries({ queryKey: ["email-drafts"] });
    },
  });

  const resolveWithResult = async (id: string, approved: boolean, reason?: string) => {
    const result = await resolveMutation.mutateAsync({ id, approved, reason });
    // The approval card unmounts once it leaves the pending list, so surface the
    // execution outcome here at the page level where it persists.
    if (result.execution_result) {
      setOutcome({ title: result.intent_title, result: result.execution_result });
    }
    return result;
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

      {outcome && (
        <div
          className={cn(
            "flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm",
            outcome.result.status === "executed"
              ? "border-green-300 bg-green-50 dark:border-green-700 dark:bg-green-950/30"
              : outcome.result.status === "error"
              ? "border-destructive/30 bg-destructive/10"
              : "border-muted bg-muted/50",
          )}
        >
          <div className="flex items-start gap-2">
            {outcome.result.status === "executed" ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
            ) : outcome.result.status === "error" ? (
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            ) : (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <div>
              <p className="font-medium">
                {outcome.result.status === "executed"
                  ? `Sent: ${outcome.title}`
                  : outcome.result.status === "error"
                  ? `Couldn't complete: ${outcome.title}`
                  : outcome.title}
              </p>
              {outcome.result.detail != null && (
                <p className="mt-0.5 text-muted-foreground">{String(outcome.result.detail)}</p>
              )}
            </div>
          </div>
          <button
            onClick={() => setOutcome(null)}
            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

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
