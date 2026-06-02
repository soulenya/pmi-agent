import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listPendingApprovals, resolveApproval } from "@/api/chat";
import type { ApprovalIntent } from "@/types/chat";
import { ShieldCheck, ShieldX, Clock } from "lucide-react";
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
  onResolve: (approved: boolean, reason?: string) => void;
}) {
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectBox, setShowRejectBox] = useState(false);

  const expiresAt = intent.expires_at ? new Date(intent.expires_at) : null;
  const isExpired = expiresAt !== null && expiresAt < new Date();

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
                  onClick={() => {
                    onResolve(false, rejectReason || undefined);
                    setShowRejectBox(false);
                  }}
                  className="flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground"
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
                onClick={() => onResolve(true)}
                className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                <ShieldCheck className="h-4 w-4" />
                Approve
              </button>
              <button
                onClick={() => setShowRejectBox(true)}
                className="flex items-center gap-1.5 rounded-md border px-4 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/10"
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

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Pending Approvals</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Actions requested by the AI that require your explicit sign-off.
        </p>
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
            resolveMutation.mutate({ id: intent.id, approved, reason })
          }
        />
      ))}
    </div>
  );
}
