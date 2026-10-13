import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, FolderPlus, Loader2, RefreshCw, Upload } from "lucide-react";

import {
  createCompanyLayout,
  getCompanySetupStatus,
  importCompanyFile,
  listSharedDrives,
  publishCompanyFile,
  setCompanyLocations,
  type CompanyLocation,
} from "@/api/companySetup";

/** Extract a Drive file/folder ID from a pasted ID or a full Drive URL. */
export function parseDriveId(raw: string): string {
  const s = raw.trim();
  const m =
    s.match(/\/d\/([\w-]{20,})/) ??
    s.match(/\/folders\/([\w-]{20,})/) ??
    s.match(/[?&]id=([\w-]{20,})/) ??
    null;
  return m ? m[1] : s;
}

function errorText(err: unknown, fallback: string): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (detail && typeof detail === "object" && "message" in detail) {
    return String((detail as { message: unknown }).message);
  }
  return fallback;
}

function driveUrl(loc: CompanyLocation): string | null {
  if (loc.kind === "bucket" || loc.kind === "name" || Array.isArray(loc.value) || !loc.value) return null;
  return `https://drive.google.com/drive/folders/${loc.value}`;
}

const SOURCE_LABEL: Record<CompanyLocation["source"], string> = {
  setting: "set here",
  brand: "built-in default",
  none: "not set",
};

export interface CompanySetupPanelProps {
  /** Compact mode hides the per-location table's purpose column — used inside the wizard. */
  compact?: boolean;
  /** Called after any change that gives the company at least a Company Truth location. */
  onConfigured?: () => void;
}

/**
 * Where the company keeps its files on Drive. One panel, two homes: Settings →
 * Company (admins, any time) and the first-run wizard (the first admin).
 */
export function CompanySetupPanel({ compact = false, onConfigured }: CompanySetupPanelProps) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [parentInput, setParentInput] = useState("");
  const [withQms, setWithQms] = useState(true);
  const [edits, setEdits] = useState<Record<string, string>>({});

  const { data: status, isLoading } = useQuery({
    queryKey: ["company-setup"],
    queryFn: getCompanySetupStatus,
  });
  const { data: drives } = useQuery({
    queryKey: ["company-setup", "shared-drives"],
    queryFn: listSharedDrives,
    enabled: !!status?.google_connected,
    retry: false,
  });

  const configured = useMemo(
    () => !!status?.locations.find((l) => l.key === "company_context")?.value,
    [status],
  );
  useEffect(() => {
    if (configured) onConfigured?.();
  }, [configured, onConfigured]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["company-setup"] });

  const create = useMutation({
    mutationFn: () => createCompanyLayout(parseDriveId(parentInput), withQms),
    onSuccess: (report) => {
      const made = Object.values(report.folders).filter((f) => f.created).length;
      const seeded = Object.values(report.seeded).reduce((n, list) => n + list.length, 0);
      setError(null);
      setNote(`Layout ready — ${made} folder(s) created, ${seeded} starter file(s) added.`);
      setParentInput("");
      refresh();
    },
    onError: (err) => setError(errorText(err, "Couldn't create the Drive layout.")),
  });

  const save = useMutation({
    mutationFn: () => {
      const payload: Record<string, string | string[]> = {};
      for (const [key, raw] of Object.entries(edits)) {
        const loc = status?.locations.find((l) => l.key === key);
        if (!loc) continue;
        if (loc.kind === "folder_list") {
          payload[key] = raw.split(/[\n,]/).map((s) => parseDriveId(s)).filter(Boolean);
        } else if (loc.kind === "bucket" || loc.kind === "name") {
          payload[key] = raw.trim();
        } else {
          payload[key] = parseDriveId(raw);
        }
      }
      return setCompanyLocations(payload);
    },
    onSuccess: () => {
      setError(null);
      setNote("Saved.");
      setEdits({});
      refresh();
    },
    onError: (err) => setError(errorText(err, "Couldn't save those locations.")),
  });

  const publish = useMutation({
    mutationFn: publishCompanyFile,
    onSuccess: (res) => {
      setError(null);
      setNote(`${res.updated ? "Updated" : "Published"} ${res.name} — other installs pick it up on their next start.`);
      refresh();
    },
    onError: (err) => setError(errorText(err, "Couldn't publish the company file.")),
  });

  const doImport = useMutation({
    mutationFn: () => importCompanyFile(false),
    onSuccess: (res) => {
      setError(null);
      setNote(
        res.found
          ? `Imported ${res.applied.length} location(s) from ${status?.company_file ?? "the company file"}.`
          : res.reason === "no_company_file"
            ? `No ${status?.company_file ?? "company file"} is shared with this Google account yet.`
            : "Nothing to import.",
      );
      refresh();
    },
    onError: (err) => setError(errorText(err, "Couldn't import the company file.")),
  });

  if (isLoading || !status) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const busy = create.isPending || save.isPending || publish.isPending || doImport.isPending;

  return (
    <div className="space-y-4">
      {!status.google_connected && (
        <p className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          Connect Google first (Settings → Google) — the layout is created in that account's Drive.
        </p>
      )}

      {/* Create the standard layout */}
      <div className="rounded-lg border px-4 py-3 space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <FolderPlus className="h-4 w-4" /> Create the standard Drive layout
        </div>
        <p className="text-xs text-muted-foreground">
          Pick a shared drive or paste a folder link. Inside it the app creates Company Truth,
          Templates, Budgets, Invoices, Workrooms, Backups and app-clients, and copies in the blank
          Company Truth sections and starter templates. Running it again reuses what is already there.
        </p>
        <div className="flex flex-wrap gap-2">
          {drives && drives.length > 0 && (
            <select
              value=""
              onChange={(e) => e.target.value && setParentInput(e.target.value)}
              className="rounded-md border bg-background px-2 py-1.5 text-sm"
              disabled={busy}
            >
              <option value="">Shared drive…</option>
              {drives.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          )}
          <input
            value={parentInput}
            onChange={(e) => setParentInput(e.target.value)}
            placeholder="Folder or shared-drive ID / link"
            className="min-w-[16rem] flex-1 rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
            disabled={busy}
          />
          <button
            onClick={() => create.mutate()}
            disabled={busy || !parentInput.trim() || !status.google_connected}
            className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {create.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderPlus className="h-3.5 w-3.5" />}
            {create.isPending ? "Creating…" : "Create layout"}
          </button>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={withQms} onChange={(e) => setWithQms(e.target.checked)} />
          Include the generic QMS SOP template
        </label>
      </div>

      {/* Per-location table */}
      <div className="rounded-lg border divide-y">
        {status.locations.map((loc) => {
          const current = Array.isArray(loc.value) ? loc.value.join("\n") : loc.value;
          const editing = edits[loc.key];
          const url = driveUrl(loc);
          return (
            <div key={loc.key} className="px-4 py-2.5 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{loc.label}</span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[11px] ${
                    loc.source === "none" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"
                  }`}
                >
                  {SOURCE_LABEL[loc.source]}
                </span>
                {url && (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    Open <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
              {!compact && <p className="text-xs text-muted-foreground">{loc.purpose}</p>}
              {loc.kind === "folder_list" ? (
                <textarea
                  rows={2}
                  value={editing ?? current}
                  onChange={(e) => setEdits((m) => ({ ...m, [loc.key]: e.target.value }))}
                  placeholder="One folder ID or link per line"
                  className="w-full rounded-md border bg-background px-3 py-1.5 font-mono text-xs outline-none focus:ring-2 focus:ring-ring"
                />
              ) : (
                <input
                  value={editing ?? current}
                  onChange={(e) => setEdits((m) => ({ ...m, [loc.key]: e.target.value }))}
                  placeholder={loc.kind === "bucket" ? "bucket-name" : loc.kind === "name" ? "Shared drive name" : "Drive ID or link"}
                  className="w-full rounded-md border bg-background px-3 py-1.5 font-mono text-xs outline-none focus:ring-2 focus:ring-ring"
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => save.mutate()}
          disabled={busy || Object.keys(edits).length === 0}
          className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          Save locations
        </button>
        <button
          onClick={() => publish.mutate()}
          disabled={busy || !status.google_connected}
          title="Writes the company file to the app-clients folder so every other install adopts these locations."
          className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          {publish.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          Publish for other installs
        </button>
        <button
          onClick={() => doImport.mutate()}
          disabled={busy || !status.google_connected}
          className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          {doImport.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Import from company file
        </button>
        {status.published_at && (
          <span className="text-xs text-muted-foreground">
            Published {new Date(status.published_at).toLocaleString()}
          </span>
        )}
      </div>

      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
