import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/api/client";

const GOOGLE_PREFIX = "/api/google";

async function apiFetch(path: string, options?: { method?: string; body?: unknown }) {
  const method = options?.method ?? "GET";
  const res = method === "GET" || method === "DELETE"
    ? await apiClient[method.toLowerCase() as "get" | "delete"](`${GOOGLE_PREFIX}${path}`)
    : await apiClient.post(`${GOOGLE_PREFIX}${path}`, options?.body ?? {});
  return res.data;
}

// ── Status types ──────────────────────────────────────────────────────────

interface GoogleStatus {
  connected: boolean;
  status: string;
  email?: string;
}

interface Proposal {
  id: string;
  action_type: string;
  description: string;
  status: "pending" | "approved" | "cancelled" | "error";
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function GoogleIntegrationPage() {
  const qc = useQueryClient();

  const { data: status, isLoading } = useQuery<GoogleStatus>({
    queryKey: ["google-status"],
    queryFn: () => apiFetch("/status"),
    refetchInterval: (query) =>
      query.state.data?.status === "pending" ? 2000 : false,
  });

  const { data: pendingData } = useQuery<{ proposals: Proposal[] }>({
    queryKey: ["google-proposals"],
    queryFn: () => apiFetch("/actions/pending"),
    enabled: status?.connected === true,
    refetchInterval: 5000,
  });

  const startAuth = useMutation({
    mutationFn: () => apiFetch("/auth/start", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["google-status"] }),
  });

  const revoke = useMutation({
    mutationFn: () => apiFetch("/auth/revoke", { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["google-status"] }),
  });

  const approve = useMutation({
    mutationFn: (id: string) => apiFetch(`/actions/${id}/approve`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["google-proposals"] }),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => apiFetch(`/actions/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["google-proposals"] }),
  });

  const proposals = pendingData?.proposals ?? [];

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold text-white">Google Workspace</h1>

      {/* ── Connection card ── */}
      <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-zinc-300">Account connection</p>
            {isLoading ? (
              <p className="text-xs text-zinc-500 mt-0.5">Checking…</p>
            ) : status?.connected ? (
              <p className="text-xs text-green-400 mt-0.5">● Connected</p>
            ) : status?.status === "pending" ? (
              <p className="text-xs text-yellow-400 mt-0.5">● Waiting for sign-in…</p>
            ) : status?.status?.startsWith("error") ? (
              <p className="text-xs text-red-400 mt-0.5">● {status.status}</p>
            ) : (
              <p className="text-xs text-zinc-500 mt-0.5">● Not connected</p>
            )}
          </div>

          {status?.connected ? (
            <button
              onClick={() => revoke.mutate()}
              className="text-xs px-3 py-1.5 rounded border border-zinc-600 text-zinc-400 hover:text-red-400 hover:border-red-600 transition-colors"
            >
              Disconnect
            </button>
          ) : (
            <button
              onClick={() => startAuth.mutate()}
              disabled={startAuth.isPending || status?.status === "pending"}
              className="text-xs px-3 py-1.5 rounded bg-red-700 hover:bg-red-600 text-white disabled:opacity-50 transition-colors"
            >
              {startAuth.isPending || status?.status === "pending"
                ? "Opening browser…"
                : "Connect Google"}
            </button>
          )}
        </div>

        {status?.connected && (
          <div className="border-t border-zinc-800 pt-3">
            <p className="text-xs text-zinc-500 font-medium mb-1.5">Services active</p>
            <div className="flex flex-wrap gap-1.5">
              {["Gmail", "Drive", "Calendar", "Contacts"].map((s) => (
                <span key={s} className="text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300">
                  {s}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Pending approval actions ── */}
      {proposals.length > 0 && (
        <div className="rounded-lg border border-yellow-800 bg-zinc-900 p-5 space-y-3">
          <p className="text-sm font-semibold text-yellow-400">
            ⚠ Actions awaiting your approval ({proposals.length})
          </p>
          <p className="text-xs text-zinc-500">
            Little Gerry wants to perform the following actions. Review and approve or cancel each one.
          </p>
          <div className="space-y-3">
            {proposals.map((p) => (
              <ProposalCard
                key={p.id}
                proposal={p}
                onApprove={() => approve.mutate(p.id)}
                onCancel={() => cancel.mutate(p.id)}
                isApproving={approve.isPending}
                isCancelling={cancel.isPending}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Info / instructions ── */}
      {!status?.connected && !isLoading && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 space-y-2">
          <p className="text-xs font-medium text-zinc-400">How it works</p>
          <ul className="text-xs text-zinc-500 space-y-1 list-disc list-inside">
            <li>Click <strong className="text-zinc-400">Connect Google</strong> — a browser sign-in window will open.</li>
            <li>Sign in with your Google Workspace account and grant the requested permissions.</li>
            <li>Little Gerry will be able to search your Gmail, Drive, Calendar and Contacts.</li>
            <li>Any action that <em>sends</em> or <em>creates</em> something requires your explicit approval here first.</li>
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Proposal card component ───────────────────────────────────────────────

function ProposalCard({
  proposal,
  onApprove,
  onCancel,
  isApproving,
  isCancelling,
}: {
  proposal: Proposal;
  onApprove: () => void;
  onCancel: () => void;
  isApproving: boolean;
  isCancelling: boolean;
}) {
  return (
    <div className="rounded border border-zinc-700 bg-zinc-800 p-3 space-y-2">
      <p className="text-xs font-medium text-zinc-300 capitalize">
        {proposal.action_type.replace("_", " ")}
      </p>
      <pre className="text-xs text-zinc-400 whitespace-pre-wrap font-sans leading-relaxed">
        {proposal.description}
      </pre>
      <div className="flex gap-2 pt-1">
        <button
          onClick={onApprove}
          disabled={isApproving}
          className="text-xs px-3 py-1 rounded bg-green-700 hover:bg-green-600 text-white disabled:opacity-50 transition-colors"
        >
          Approve
        </button>
        <button
          onClick={onCancel}
          disabled={isCancelling}
          className="text-xs px-3 py-1 rounded border border-zinc-600 text-zinc-400 hover:text-red-400 hover:border-red-500 disabled:opacity-50 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
