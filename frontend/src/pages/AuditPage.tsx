import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ShieldCheck,
  ShieldX,
  ShieldAlert,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Search,
  Loader2,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { listAuditEvents, verifyAuditChain } from "@/api/audit";
import type { AuditEvent } from "@/types/audit";

// ── Event type colours ─────────────────────────────────────────────────────────

const EVENT_COLORS: Record<string, string> = {
  auth: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  document: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  task: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  approval: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  regulatory: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  risk: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  settings: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300",
  user: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300",
};

function eventTypeColor(eventType: string): string {
  const prefix = eventType.split(".")[0].toLowerCase();
  return EVENT_COLORS[prefix] ?? "bg-muted text-muted-foreground";
}

// ── Payload viewer ─────────────────────────────────────────────────────────────

function PayloadViewer({ payload }: { payload: Record<string, unknown> | null }) {
  const [open, setOpen] = useState(false);
  if (!payload || Object.keys(payload).length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {open ? "Hide" : "Show"} payload
      </button>
      {open && (
        <pre className="mt-1.5 rounded bg-muted/60 p-2 text-xs font-mono whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
          {JSON.stringify(payload, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ── Event row ──────────────────────────────────────────────────────────────────

function EventRow({ event }: { event: AuditEvent }) {
  const ts = new Date(event.created_at);
  const formattedDate = ts.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const formattedTime = ts.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  return (
    <tr className="border-b last:border-0 hover:bg-muted/30 transition-colors">
      <td className="py-3 pl-4 pr-2 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
        <div>{formattedDate}</div>
        <div className="opacity-70">{formattedTime}</div>
      </td>
      <td className="py-3 px-2 text-xs font-mono text-muted-foreground">
        #{event.sequence_number}
      </td>
      <td className="py-3 px-2">
        <span
          className={cn(
            "inline-block rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
            eventTypeColor(event.event_type),
          )}
        >
          {event.event_type}
        </span>
      </td>
      <td className="py-3 px-2 text-xs text-muted-foreground">
        {event.entity_type ?? "—"}
        {event.entity_id && (
          <span className="ml-1 font-mono opacity-60">{event.entity_id.slice(0, 8)}…</span>
        )}
      </td>
      <td className="py-3 px-2 text-xs font-mono text-muted-foreground">
        {event.actor_id ? event.actor_id.slice(0, 8) + "…" : "system"}
      </td>
      <td className="py-3 px-2">
        <PayloadViewer payload={event.payload} />
      </td>
      <td className="py-3 pr-4 pl-2 text-xs font-mono text-muted-foreground/50 whitespace-nowrap">
        {event.record_hash.slice(0, 12)}…
      </td>
    </tr>
  );
}

// ── Verify banner ──────────────────────────────────────────────────────────────

function VerifyBanner({
  result,
}: {
  result: { verified: number; broken_sequences: number[]; chain_intact: boolean } | null;
}) {
  if (!result) return null;

  if (result.chain_intact) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-700/50 dark:bg-green-900/20 dark:text-green-300">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        <span>
          <strong>Chain intact.</strong> {result.verified} events verified — no tampering detected.
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-700/50 dark:bg-red-900/20 dark:text-red-300">
      <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
      <div>
        <strong>Chain integrity violation detected!</strong>
        <p className="mt-0.5 opacity-90">
          {result.broken_sequences.length} broken sequence(s):{" "}
          {result.broken_sequences.slice(0, 10).join(", ")}
          {result.broken_sequences.length > 10 && ` …and ${result.broken_sequences.length - 10} more`}
        </p>
      </div>
    </div>
  );
}

// ── Known event types for filter dropdown ─────────────────────────────────────

const KNOWN_EVENT_TYPES = [
  "auth.login",
  "auth.logout",
  "auth.register",
  "document.upload",
  "document.delete",
  "document.reembed",
  "task.create",
  "task.update",
  "task.delete",
  "approval.create",
  "approval.resolve",
  "regulatory.create",
  "regulatory.update",
  "risk.create",
  "risk.update",
  "risk.delete",
  "settings.update",
  "user.update",
];

const PAGE_SIZE = 50;

// ── Main page ──────────────────────────────────────────────────────────────────

export function AuditPage() {
  const [page, setPage] = useState(1);
  const [eventTypeFilter, setEventTypeFilter] = useState("");
  const [verifyResult, setVerifyResult] = useState<{
    verified: number;
    broken_sequences: number[];
    chain_intact: boolean;
  } | null>(null);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["audit-events", page, eventTypeFilter],
    queryFn: () =>
      listAuditEvents({
        page,
        page_size: PAGE_SIZE,
        event_type: eventTypeFilter || undefined,
      }),
    staleTime: 30_000,
  });

  const verifyMutation = useMutation({
    mutationFn: () => verifyAuditChain(2000),
    onSuccess: (resp) => setVerifyResult(resp.data),
  });

  const events = data?.data ?? [];
  const meta = data?.meta;
  const totalPages = meta?.total_pages ?? 1;

  return (
    <div className="flex flex-col gap-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldAlert className="h-6 w-6 text-primary" />
            Audit Trail
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Append-only cryptographic event log · FDA 21 CFR Part 11 / MDR Article 10
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
            Refresh
          </button>
          <button
            onClick={() => verifyMutation.mutate()}
            disabled={verifyMutation.isPending}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60 transition-colors"
          >
            {verifyMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5" />
            )}
            Verify Chain Integrity
          </button>
        </div>
      </div>

      {/* Verify result banner */}
      <VerifyBanner result={verifyResult} />

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <select
            value={eventTypeFilter}
            onChange={(e) => { setEventTypeFilter(e.target.value); setPage(1); }}
            className="w-full rounded-md border bg-background pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring appearance-none"
          >
            <option value="">All event types</option>
            {KNOWN_EVENT_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        {meta && (
          <p className="text-xs text-muted-foreground">
            {meta.total.toLocaleString()} event{meta.total !== 1 ? "s" : ""}
            {eventTypeFilter ? ` matching "${eventTypeFilter}"` : ""}
          </p>
        )}
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading events…
          </div>
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-2">
            <ShieldX className="h-8 w-8 opacity-30" />
            <p className="text-sm">No audit events found.</p>
            {eventTypeFilter && (
              <button onClick={() => setEventTypeFilter("")} className="text-xs underline">
                Clear filter
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                  <th className="py-2.5 pl-4 pr-2 text-left font-medium">Timestamp</th>
                  <th className="py-2.5 px-2 text-left font-medium">#</th>
                  <th className="py-2.5 px-2 text-left font-medium">Event Type</th>
                  <th className="py-2.5 px-2 text-left font-medium">Entity</th>
                  <th className="py-2.5 px-2 text-left font-medium">Actor</th>
                  <th className="py-2.5 px-2 text-left font-medium">Payload</th>
                  <th className="py-2.5 pr-4 pl-2 text-left font-medium">Hash</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <EventRow key={e.id} event={e} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm disabled:opacity-40 hover:bg-accent transition-colors"
          >
            <ChevronLeft className="h-4 w-4" /> Previous
          </button>
          <span className="text-xs text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm disabled:opacity-40 hover:bg-accent transition-colors"
          >
            Next <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Compliance note */}
      <p className="text-xs text-muted-foreground border-t pt-4">
        This audit log uses a cryptographic hash chain. Each event record includes a SHA-256 hash of
        its content linked to the previous record's hash, making tampering detectable.
        Use "Verify Chain Integrity" to validate the chain has not been modified.
      </p>
    </div>
  );
}
