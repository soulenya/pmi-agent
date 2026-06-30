import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ShieldCheck,
  ShieldAlert,
  RefreshCw,
  Download,
  ExternalLink,
  Save,
  HardDrive,
  Cloud,
  CloudOff,
} from "lucide-react";
import { apiClient } from "@/api/client";

const PREFIX = "/api/backups";

interface BackupConfig {
  enabled: boolean;
  hour: number;
  drive_folder_id: string;
}

interface LedgerEntry {
  sequence: number;
  created_at: string;
  reason?: string;
  filename: string;
  content_hash: string;
  record_hash: string;
  conversation_count: number;
  message_count: number;
  drive_file_id?: string;
  drive_url?: string;
}

interface BackupStatus {
  config: BackupConfig;
  google_connected: boolean;
  count: number;
  last: LedgerEntry | null;
}

interface VerifyResult {
  ok: boolean;
  checked: number;
  problems: string[];
}

function getError(e: unknown): string {
  const err = e as { response?: { data?: { detail?: unknown } } };
  const detail = err?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (!err?.response) return "Cannot reach the server. Is Little Gerry running?";
  return "Something went wrong. Please try again.";
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function BackupsPage() {
  const qc = useQueryClient();
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);

  // Local editable settings (seeded from status once loaded).
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [hour, setHour] = useState<number | null>(null);
  const [folder, setFolder] = useState<string | null>(null);

  const status = useQuery<BackupStatus>({
    queryKey: ["backup-status"],
    queryFn: async () => {
      const res = await apiClient.get<BackupStatus>(`${PREFIX}/status`);
      const c = res.data.config;
      if (enabled === null) setEnabled(c.enabled);
      if (hour === null) setHour(c.hour);
      if (folder === null) setFolder(c.drive_folder_id);
      return res.data;
    },
  });

  const backups = useQuery<LedgerEntry[]>({
    queryKey: ["backup-list"],
    queryFn: async () => {
      const res = await apiClient.get<{ backups: LedgerEntry[] }>(PREFIX);
      return res.data.backups ?? [];
    },
  });

  const saveSettings = useMutation({
    mutationFn: async () => {
      const res = await apiClient.put<BackupConfig>(`${PREFIX}/settings`, {
        enabled,
        hour,
        drive_folder_id: folder,
      });
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["backup-status"] });
      setNotice({ kind: "ok", text: "Backup settings saved." });
    },
    onError: (e) => setNotice({ kind: "error", text: getError(e) }),
  });

  const runNow = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<LedgerEntry & { drive: unknown }>(
        `${PREFIX}/run`,
        {},
        { timeout: 5 * 60 * 1000 },
      );
      return res.data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["backup-status"] });
      qc.invalidateQueries({ queryKey: ["backup-list"] });
      setVerifyResult(null);
      setNotice({
        kind: "ok",
        text: `Backup #${data.sequence} created — ${data.conversation_count} conversations, ${data.message_count} messages${
          data.drive_file_id ? " (uploaded to Drive)" : " (local only)"
        }.`,
      });
    },
    onError: (e) => setNotice({ kind: "error", text: getError(e) }),
  });

  const verify = useMutation({
    mutationFn: async () => {
      const res = await apiClient.get<VerifyResult>(`${PREFIX}/verify`);
      return res.data;
    },
    onSuccess: (data) => {
      setVerifyResult(data);
      setNotice(
        data.ok
          ? { kind: "ok", text: `Integrity verified — ${data.checked} backups, chain intact.` }
          : { kind: "error", text: `Tampering detected in ${data.problems.length} place(s).` },
      );
    },
    onError: (e) => setNotice({ kind: "error", text: getError(e) }),
  });

  async function download(entry: LedgerEntry) {
    try {
      const res = await apiClient.get(`${PREFIX}/download/${encodeURIComponent(entry.filename)}`, {
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(res.data as Blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = entry.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      setNotice({ kind: "error", text: getError(e) });
    }
  }

  const config = status.data?.config;

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 text-zinc-200">
      <div className="mb-6 flex items-center gap-3">
        <Archive className="h-7 w-7 text-amber-400" />
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Conversation Backups</h1>
          <p className="text-sm text-zinc-400">
            Append-only, cryptographically signed snapshots of every conversation — kept locally
            and exported to Google Drive for a tamper-evident audit trail.
          </p>
        </div>
      </div>

      {notice && (
        <div
          className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
            notice.kind === "ok"
              ? "border-emerald-700 bg-emerald-950/40 text-emerald-300"
              : "border-red-800 bg-red-950/40 text-red-300"
          }`}
        >
          {notice.text}
        </div>
      )}

      {/* Settings */}
      <section className="mb-6 rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
        <h2 className="mb-4 text-lg font-medium text-zinc-100">Schedule</h2>
        <div className="space-y-4">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              className="h-4 w-4 accent-amber-500"
              checked={enabled ?? false}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span className="text-sm text-zinc-200">
              Automatically back up conversations once a day
            </span>
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-zinc-400">Run daily at</span>
            <select
              className="rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-100"
              value={hour ?? 2}
              onChange={(e) => setHour(Number(e.target.value))}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, "0")}:00
                </option>
              ))}
            </select>
            <span className="text-sm text-zinc-500">(local time)</span>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm text-zinc-400">Google Drive folder ID</label>
            <input
              type="text"
              className="w-full max-w-md rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100"
              value={folder ?? ""}
              onChange={(e) => setFolder(e.target.value)}
              placeholder="Drive folder ID"
            />
            <span className="flex items-center gap-1.5 text-xs text-zinc-500">
              {status.data?.google_connected ? (
                <>
                  <Cloud className="h-3.5 w-3.5 text-emerald-400" /> Google connected — backups
                  upload to Drive.
                </>
              ) : (
                <>
                  <CloudOff className="h-3.5 w-3.5 text-zinc-500" /> Google not connected — backups
                  stay local only.
                </>
              )}
            </span>
          </div>

          <button
            onClick={() => saveSettings.mutate()}
            disabled={saveSettings.isPending}
            className="inline-flex items-center gap-2 rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {saveSettings.isPending ? "Saving…" : "Save settings"}
          </button>
        </div>
      </section>

      {/* Actions + status */}
      <section className="mb-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-medium text-zinc-100">
            <HardDrive className="h-5 w-5 text-zinc-400" /> Status
          </h2>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-zinc-400">Total backups</dt>
              <dd className="text-zinc-100">{status.data?.count ?? 0}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-400">Last backup</dt>
              <dd className="text-zinc-100">
                {status.data?.last ? fmtDate(status.data.last.created_at) : "Never"}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-400">Auto-backup</dt>
              <dd className={config?.enabled ? "text-emerald-400" : "text-zinc-500"}>
                {config?.enabled ? `Enabled (${String(config.hour).padStart(2, "0")}:00)` : "Disabled"}
              </dd>
            </div>
          </dl>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
          <h2 className="mb-3 text-lg font-medium text-zinc-100">Actions</h2>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => runNow.mutate()}
              disabled={runNow.isPending}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-zinc-700 px-4 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-600 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${runNow.isPending ? "animate-spin" : ""}`} />
              {runNow.isPending ? "Backing up…" : "Back up now"}
            </button>
            <button
              onClick={() => verify.mutate()}
              disabled={verify.isPending}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
            >
              <ShieldCheck className="h-4 w-4" />
              {verify.isPending ? "Verifying…" : "Verify integrity"}
            </button>
          </div>

          {verifyResult && (
            <div
              className={`mt-3 rounded-md border px-3 py-2 text-xs ${
                verifyResult.ok
                  ? "border-emerald-800 bg-emerald-950/40 text-emerald-300"
                  : "border-red-800 bg-red-950/40 text-red-300"
              }`}
            >
              <div className="flex items-center gap-1.5 font-medium">
                {verifyResult.ok ? (
                  <ShieldCheck className="h-4 w-4" />
                ) : (
                  <ShieldAlert className="h-4 w-4" />
                )}
                {verifyResult.ok
                  ? `Chain intact (${verifyResult.checked} backups)`
                  : "Integrity problems:"}
              </div>
              {!verifyResult.ok && (
                <ul className="mt-1 list-disc pl-5">
                  {verifyResult.problems.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </section>

      {/* History */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
        <h2 className="mb-4 text-lg font-medium text-zinc-100">History</h2>
        {backups.isLoading ? (
          <p className="text-sm text-zinc-500">Loading…</p>
        ) : (backups.data?.length ?? 0) === 0 ? (
          <p className="text-sm text-zinc-500">No backups yet. Click “Back up now” to create one.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-zinc-500">
                <tr className="border-b border-zinc-800">
                  <th className="py-2 pr-3">#</th>
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Conversations</th>
                  <th className="py-2 pr-3">Messages</th>
                  <th className="py-2 pr-3">Record hash</th>
                  <th className="py-2 pr-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {backups.data!.map((b) => (
                  <tr key={b.sequence} className="border-b border-zinc-800/60">
                    <td className="py-2 pr-3 text-zinc-400">{b.sequence}</td>
                    <td className="py-2 pr-3 text-zinc-200">{fmtDate(b.created_at)}</td>
                    <td className="py-2 pr-3 text-zinc-200">{b.conversation_count}</td>
                    <td className="py-2 pr-3 text-zinc-200">{b.message_count}</td>
                    <td className="py-2 pr-3 font-mono text-xs text-zinc-500">
                      {b.record_hash.slice(0, 12)}…
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => download(b)}
                          title="Download signed backup"
                          className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-amber-400"
                        >
                          <Download className="h-4 w-4" />
                        </button>
                        {b.drive_url && (
                          <a
                            href={b.drive_url}
                            target="_blank"
                            rel="noreferrer"
                            title="Open in Google Drive"
                            className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-amber-400"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
