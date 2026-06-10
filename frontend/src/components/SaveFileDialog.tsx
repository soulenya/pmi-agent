/**
 * SaveFileDialog — lets the user choose where a downloaded file goes:
 *
 *   1. "Save to this computer" — opens the browser's native Save-As picker
 *      (File System Access API) so the user picks the exact folder; falls
 *      back to a regular download (browser Downloads folder) when the API
 *      isn't available.
 *   2. "Upload to Google Drive" — browse My Drive / shared drives, pick a
 *      destination folder, and upload. Shows exactly where the file went
 *      with an "Open in Drive" link.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getGoogleStatus,
  listSharedDrives,
  driveListFolder,
  driveUploadBlob,
  type DriveUploadResult,
} from "@/api/google";
import {
  X,
  Monitor,
  Cloud,
  Folder,
  ChevronRight,
  ChevronLeft,
  Loader2,
  CheckCircle2,
  ExternalLink,
  HardDrive,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  /** Filename to save as (shown to the user and used as the suggested name). */
  filename: string;
  /** Fetches the file content when the user picks a destination. */
  getBlob: () => Promise<Blob>;
  onClose: () => void;
}

/** Minimal typing for the File System Access API (Chromium browsers). */
interface SaveFilePickerHandle {
  createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
}
type SaveFilePickerFn = (opts?: { suggestedName?: string }) => Promise<SaveFilePickerHandle>;

interface Crumb {
  id: string;
  name: string;
  driveId?: string;
}

export function SaveFileDialog({ filename, getBlob, onClose }: Props) {
  const [view, setView] = useState<"choose" | "drive">("choose");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedLocal, setSavedLocal] = useState<string | null>(null);
  const [driveResult, setDriveResult] = useState<{ result: DriveUploadResult; path: string } | null>(null);

  // Drive navigation. crumbs[0] is a virtual top level that shows "My Drive"
  // plus any shared drives; deeper crumbs are real Drive folders.
  const TOP = "__top__";
  const [crumbs, setCrumbs] = useState<Crumb[]>([{ id: TOP, name: "Google Drive" }]);
  const current = crumbs[crumbs.length - 1];
  const atTopLevel = current.id === TOP;
  // Uploading at "My Drive" (or the virtual top) targets the My Drive root.
  const uploadFolderId = atTopLevel || current.id === "root" ? undefined : current.id;

  const { data: googleStatus } = useQuery({
    queryKey: ["google-status"],
    queryFn: getGoogleStatus,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const googleConnected = googleStatus?.connected === true;

  const { data: sharedDrives = [] } = useQuery({
    queryKey: ["drive-shared-drives"],
    queryFn: listSharedDrives,
    enabled: view === "drive" && googleConnected && atTopLevel,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const { data: items = [], isLoading: folderLoading } = useQuery({
    queryKey: ["drive-folder", current.id, current.driveId ?? ""],
    queryFn: () => driveListFolder(current.id, current.driveId),
    enabled: view === "drive" && googleConnected && !atTopLevel,
    staleTime: 60_000,
    retry: false,
  });
  const folders = items.filter((i) => i.type === "folder");

  const pathLabel = crumbs.filter((c) => c.id !== TOP).map((c) => c.name).join(" / ") || "Google Drive";

  // ── Save to this computer ────────────────────────────────────────────────
  async function handleSaveLocal() {
    setBusy(true);
    setError("");
    try {
      const picker = (window as unknown as { showSaveFilePicker?: SaveFilePickerFn }).showSaveFilePicker;
      if (picker) {
        // Native Save-As dialog: the user chooses the exact location.
        let handle: SaveFilePickerHandle;
        try {
          handle = await picker({ suggestedName: filename });
        } catch (e) {
          // User cancelled the picker — not an error.
          if (e instanceof DOMException && e.name === "AbortError") return;
          throw e;
        }
        const blob = await getBlob();
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        setSavedLocal("Saved to the location you chose.");
      } else {
        // Fallback: regular browser download.
        const blob = await getBlob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        setSavedLocal("Saved to your browser's Downloads folder.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save the file.");
    } finally {
      setBusy(false);
    }
  }

  // ── Upload to Google Drive ───────────────────────────────────────────────
  async function handleUploadHere() {
    setBusy(true);
    setError("");
    try {
      const blob = await getBlob();
      const result = await driveUploadBlob(blob, filename, uploadFolderId);
      setDriveResult({ result, path: pathLabel });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to upload to Google Drive.");
    } finally {
      setBusy(false);
    }
  }

  function enterFolder(id: string, name: string, driveId?: string) {
    setCrumbs((c) => [...c, { id, name, driveId: driveId ?? c[c.length - 1].driveId }]);
  }

  function goToCrumb(index: number) {
    setCrumbs((c) => c.slice(0, index + 1));
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex w-full max-w-lg flex-col rounded-xl border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 border-b px-5 py-4">
          {view === "drive" && !driveResult && (
            <button onClick={() => { setView("choose"); setError(""); }} className="rounded-md p-1 text-muted-foreground hover:bg-accent">
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
          <h2 className="flex-1 truncate text-sm font-semibold">
            {view === "choose" ? "Save file" : "Save to Google Drive"}
            <span className="ml-2 font-normal text-muted-foreground">{filename}</span>
          </h2>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4">
          {/* ── Choose destination ── */}
          {view === "choose" && (
            <div className="space-y-2">
              <button
                onClick={handleSaveLocal}
                disabled={busy}
                className="flex w-full items-start gap-3 rounded-lg border p-3.5 text-left hover:bg-accent transition-colors disabled:opacity-60"
              >
                <Monitor className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <span>
                  <span className="block text-sm font-semibold">Save to this computer</span>
                  <span className="block text-xs text-muted-foreground mt-0.5">
                    Choose exactly where to save it (or your Downloads folder on browsers without a save dialog).
                  </span>
                </span>
                {busy && <Loader2 className="ml-auto h-4 w-4 animate-spin" />}
              </button>

              <button
                onClick={() => { setView("drive"); setError(""); }}
                disabled={!googleConnected}
                className="flex w-full items-start gap-3 rounded-lg border p-3.5 text-left hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Cloud className="mt-0.5 h-5 w-5 shrink-0 text-sky-500" />
                <span>
                  <span className="block text-sm font-semibold">Upload to Google Drive</span>
                  <span className="block text-xs text-muted-foreground mt-0.5">
                    {googleConnected
                      ? "Pick a Drive folder — you'll see exactly where it goes."
                      : "Connect Google Workspace on the Google page to enable this."}
                  </span>
                </span>
              </button>

              {savedLocal && (
                <div className="flex items-center gap-2 rounded-md bg-green-500/10 px-3 py-2.5 text-sm text-green-700 dark:text-green-400">
                  <CheckCircle2 className="h-4 w-4 shrink-0" /> {savedLocal}
                </div>
              )}
            </div>
          )}

          {/* ── Drive folder browser ── */}
          {view === "drive" && !driveResult && (
            <div className="space-y-3">
              {/* Breadcrumbs */}
              <div className="flex flex-wrap items-center gap-1 text-xs">
                {crumbs.map((c, i) => (
                  <span key={`${c.id}-${i}`} className="flex items-center gap-1">
                    {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground/50" />}
                    <button
                      onClick={() => goToCrumb(i)}
                      className={cn(
                        "rounded px-1 py-0.5 hover:bg-accent",
                        i === crumbs.length - 1 ? "font-semibold" : "text-muted-foreground",
                      )}
                    >
                      {c.name}
                    </button>
                  </span>
                ))}
              </div>

              {/* Folder list */}
              <div className="max-h-64 overflow-y-auto rounded-lg border divide-y">
                {folderLoading && !atTopLevel ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <>
                    {atTopLevel && (
                      <button
                        onClick={() => enterFolder("root", "My Drive")}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-accent transition-colors"
                      >
                        <HardDrive className="h-4 w-4 shrink-0 text-primary" />
                        <span className="flex-1 truncate">My Drive</span>
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
                      </button>
                    )}
                    {atTopLevel && sharedDrives.map((d) => (
                      <button
                        key={d.id}
                        onClick={() => enterFolder(d.id, d.name, d.id)}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-accent transition-colors"
                      >
                        <HardDrive className="h-4 w-4 shrink-0 text-sky-500" />
                        <span className="flex-1 truncate">{d.name}</span>
                        <span className="text-[10px] uppercase text-muted-foreground">Shared drive</span>
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
                      </button>
                    ))}
                    {!atTopLevel && folders.map((f) => (
                      <button
                        key={f.id}
                        onClick={() => enterFolder(f.id, f.name)}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-accent transition-colors"
                      >
                        <Folder className="h-4 w-4 shrink-0 text-amber-500" />
                        <span className="flex-1 truncate">{f.name}</span>
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
                      </button>
                    ))}
                    {!atTopLevel && !folderLoading && folders.length === 0 && (
                      <p className="px-3 py-6 text-center text-xs text-muted-foreground">No subfolders here.</p>
                    )}
                  </>
                )}
              </div>

              <button
                onClick={handleUploadHere}
                disabled={busy || atTopLevel}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow hover:bg-primary/90 disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}
                Upload to "{current.name}"
              </button>
              <p className="text-center text-xs text-muted-foreground">
                {atTopLevel
                  ? "Open My Drive or a shared drive to choose where it goes."
                  : <>Will be saved in <span className="font-medium">{pathLabel}</span></>}
              </p>
            </div>
          )}

          {/* ── Drive upload success ── */}
          {view === "drive" && driveResult && (
            <div className="space-y-3 py-2 text-center">
              <CheckCircle2 className="mx-auto h-10 w-10 text-green-500" />
              <p className="text-sm font-semibold">Uploaded to Google Drive</p>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium">{driveResult.result.name}</span> is now in{" "}
                <span className="font-medium">{driveResult.path}</span>
              </p>
              {driveResult.result.url && (
                <a
                  href={driveResult.result.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent"
                >
                  Open in Drive <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          )}

          {error && (
            <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t px-5 py-3">
          <button onClick={onClose} className="rounded-md border px-4 py-1.5 text-xs hover:bg-accent">
            {savedLocal || driveResult ? "Done" : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}
