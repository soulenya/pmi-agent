import { useLayoutEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Folder, FolderPlus, Upload, FileText, FileSpreadsheet, FileImage,
  FileCode, FileArchive, File as FileIcon, MoreVertical, Pencil, Trash2,
  Download, FolderInput, X, Loader2, ChevronRight, ShieldAlert, Save,
  HardDrive, ArrowLeft, Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";
import { DriveBrowser } from "@/components/google/DriveBrowser";
import type { DriveItem } from "@/api/google";
import {
  listRegNodes, createRegFolder, uploadRegFile, importRegFromDrive,
  renameRegNode, moveRegNode, deleteRegNode, getRegText, saveRegText,
  downloadRegFile,
  type RegNode,
} from "@/api/regulatoryFiles";

// ── helpers ─────────────────────────────────────────────────────────────────

function formatBytes(n?: number | null): string {
  if (!n && n !== 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(node: RegNode) {
  const ext = (node.extension || "").toLowerCase();
  if ([".csv", ".xlsx", ".xls"].includes(ext)) return FileSpreadsheet;
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"].includes(ext)) return FileImage;
  if ([".json", ".xml", ".html", ".htm", ".js", ".ts", ".css", ".yaml", ".yml"].includes(ext)) return FileCode;
  if ([".zip", ".rar", ".7z", ".tar", ".gz"].includes(ext)) return FileArchive;
  if ([".txt", ".md", ".markdown", ".rst", ".log", ".pdf", ".doc", ".docx"].includes(ext)) return FileText;
  return FileIcon;
}

function apiError(e: unknown, fallback: string): string {
  return (
    (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? fallback
  );
}

// ── New folder modal ────────────────────────────────────────────────────────

function NewFolderModal({ parentId, onClose }: { parentId: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const mut = useMutation({
    mutationFn: () => createRegFolder(name.trim(), parentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reg-files", parentId] });
      onClose();
    },
  });
  return (
    <ModalShell title="New Folder" icon={<FolderPlus className="h-5 w-5 text-primary" />} onClose={onClose}>
      <form
        onSubmit={(e) => { e.preventDefault(); if (name.trim()) mut.mutate(); }}
        className="space-y-4"
      >
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Folder name"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        {mut.isError && <p className="text-xs text-destructive">{apiError(mut.error, "Failed to create folder")}</p>}
        <ModalActions onCancel={onClose} submitLabel="Create" pending={mut.isPending} disabled={!name.trim()} />
      </form>
    </ModalShell>
  );
}

// ── Rename modal ────────────────────────────────────────────────────────────

function RenameModal({ node, parentId, onClose }: { node: RegNode; parentId: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(node.name);
  const mut = useMutation({
    mutationFn: () => renameRegNode(node.id, name.trim()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reg-files", parentId] });
      onClose();
    },
  });
  return (
    <ModalShell title="Rename" icon={<Pencil className="h-5 w-5 text-primary" />} onClose={onClose}>
      <form
        onSubmit={(e) => { e.preventDefault(); if (name.trim()) mut.mutate(); }}
        className="space-y-4"
      >
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        {mut.isError && <p className="text-xs text-destructive">{apiError(mut.error, "Failed to rename")}</p>}
        <ModalActions onCancel={onClose} submitLabel="Rename" pending={mut.isPending} disabled={!name.trim()} />
      </form>
    </ModalShell>
  );
}

// ── Move modal (folder picker) ──────────────────────────────────────────────

function MoveModal({ node, sourceParentId, onClose }: { node: RegNode; sourceParentId: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [dest, setDest] = useState<string | null>(null);
  const { data: listing, isLoading } = useQuery({
    queryKey: ["reg-move-picker", dest],
    queryFn: () => listRegNodes(dest),
  });
  const folders = (listing?.nodes ?? []).filter((n) => n.node_type === "folder" && n.id !== node.id);

  const mut = useMutation({
    mutationFn: () => moveRegNode(node.id, dest),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reg-files", sourceParentId] });
      qc.invalidateQueries({ queryKey: ["reg-files", dest] });
      onClose();
    },
  });

  return (
    <ModalShell title={`Move "${node.name}"`} icon={<FolderInput className="h-5 w-5 text-primary" />} onClose={onClose}>
      <div className="space-y-3">
        {/* Breadcrumb of picker location */}
        <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          {(listing?.breadcrumb ?? [{ id: null, name: "Regulatory" }]).map((c, i) => (
            <span key={c.id ?? "root"} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3" />}
              <button className="hover:text-foreground" onClick={() => setDest(c.id)}>{c.name}</button>
            </span>
          ))}
        </div>

        <div className="max-h-64 overflow-auto rounded-md border">
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : folders.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">No sub-folders here.</p>
          ) : (
            folders.map((f) => (
              <button
                key={f.id}
                onClick={() => setDest(f.id)}
                className="flex w-full items-center gap-2 border-b px-3 py-2 text-left text-sm last:border-0 hover:bg-accent"
              >
                <Folder className="h-4 w-4 text-amber-500" />
                {f.name}
                <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground" />
              </button>
            ))
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Destination: <span className="font-medium text-foreground">
            {listing?.breadcrumb?.[listing.breadcrumb.length - 1]?.name ?? "Regulatory"}
          </span>
        </p>
        {mut.isError && <p className="text-xs text-destructive">{apiError(mut.error, "Failed to move")}</p>}
        <ModalActions
          onCancel={onClose}
          submitLabel="Move here"
          pending={mut.isPending}
          disabled={dest === sourceParentId}
          onSubmit={() => mut.mutate()}
        />
      </div>
    </ModalShell>
  );
}

// ── Text editor modal ───────────────────────────────────────────────────────

function EditModal({ node, parentId, onClose }: { node: RegNode; parentId: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [content, setContent] = useState<string | null>(null);
  const { isLoading } = useQuery({
    queryKey: ["reg-text", node.id],
    queryFn: async () => {
      const r = await getRegText(node.id);
      setContent(r.content);
      return r;
    },
  });
  const mut = useMutation({
    mutationFn: () => saveRegText(node.id, content ?? ""),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reg-files", parentId] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex h-[80vh] w-full max-w-3xl flex-col rounded-xl border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">{node.name}</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        {isLoading || content === null ? (
          <div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
            className="flex-1 resize-none bg-background p-4 font-mono text-sm outline-none"
          />
        )}
        <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
          {mut.isError && <p className="mr-auto text-xs text-destructive">{apiError(mut.error, "Failed to save")}</p>}
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm text-muted-foreground hover:bg-accent">Cancel</button>
          <button
            onClick={() => mut.mutate()}
            disabled={mut.isPending || content === null}
            className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {mut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ── shared modal pieces ─────────────────────────────────────────────────────

function ModalShell({ title, icon, onClose, children }: { title: string; icon: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div className="flex items-center gap-2">{icon}<h2 className="font-semibold">{title}</h2></div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function ModalActions({ onCancel, onSubmit, submitLabel, pending, disabled }: { onCancel: () => void; onSubmit?: () => void; submitLabel: string; pending?: boolean; disabled?: boolean }) {
  return (
    <div className="flex justify-end gap-2 pt-1">
      <button type="button" onClick={onCancel} className="rounded-md border px-4 py-2 text-sm text-muted-foreground hover:bg-accent">Cancel</button>
      <button
        type={onSubmit ? "button" : "submit"}
        onClick={onSubmit}
        disabled={pending || disabled}
        className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {submitLabel}
      </button>
    </div>
  );
}

// ── row actions menu ────────────────────────────────────────────────────────

function RowMenu({ node, canWrite, onEdit, onRename, onMove, onDelete, onDownload }: {
  node: RegNode; canWrite: boolean;
  onEdit: () => void; onRename: () => void; onMove: () => void; onDelete: () => void; onDownload: () => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  // Anchor the menu to the button in viewport coordinates so it isn't clipped
  // by the listing card's `overflow-hidden`.
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const update = () => {
      const r = btnRef.current!.getBoundingClientRect();
      const MENU_W = 160; // w-40
      setPos({ top: r.bottom + 4, left: Math.max(8, r.right - MENU_W) });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
          <div
            className="fixed z-50 w-40 rounded-md border bg-popover py-1 shadow-lg"
            style={{ top: pos.top, left: pos.left }}
            onClick={(e) => e.stopPropagation()}
          >
            {node.node_type === "file" && (
              <MenuItem icon={<Download className="h-3.5 w-3.5" />} label="Download" onClick={() => { setOpen(false); onDownload(); }} />
            )}
            {canWrite && node.node_type === "file" && node.is_editable && (
              <MenuItem icon={<Pencil className="h-3.5 w-3.5" />} label="Edit" onClick={() => { setOpen(false); onEdit(); }} />
            )}
            {canWrite && <MenuItem icon={<Pencil className="h-3.5 w-3.5" />} label="Rename" onClick={() => { setOpen(false); onRename(); }} />}
            {canWrite && <MenuItem icon={<FolderInput className="h-3.5 w-3.5" />} label="Move" onClick={() => { setOpen(false); onMove(); }} />}
            {canWrite && <MenuItem icon={<Trash2 className="h-3.5 w-3.5 text-destructive" />} label="Delete" danger onClick={() => { setOpen(false); onDelete(); }} />}
          </div>
        </>
      )}
    </div>
  );
}

function MenuItem({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent", danger && "text-destructive")}
    >
      {icon}{label}
    </button>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export function RegulatoryPage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const canWrite = user?.role === "admin" || !!user?.can_write_regulatory;

  const [parentId, setParentId] = useState<string | null>(null);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [showDrive, setShowDrive] = useState(false);
  const [renameTarget, setRenameTarget] = useState<RegNode | null>(null);
  const [moveTarget, setMoveTarget] = useState<RegNode | null>(null);
  const [editTarget, setEditTarget] = useState<RegNode | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [driveImporting, setDriveImporting] = useState(false);
  const [driveStatus, setDriveStatus] = useState<string | null>(null);
  const [driveProgress, setDriveProgress] = useState<{ current: number; total: number } | null>(null);

  const { data: listing, isLoading } = useQuery({
    queryKey: ["reg-files", parentId],
    queryFn: () => listRegNodes(parentId),
  });

  const uploadMut = useMutation({
    mutationFn: (file: File) => uploadRegFile(file, parentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reg-files", parentId] }),
    onError: (e) => setUploadError(apiError(e, "Upload failed")),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteRegNode(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reg-files", parentId] }),
  });

  function handleUpload(ev: React.ChangeEvent<HTMLInputElement>) {
    setUploadError(null);
    const files = ev.target.files;
    if (!files) return;
    Array.from(files).forEach((f) => uploadMut.mutate(f));
    ev.target.value = "";
  }

  async function handleDriveImport(items: DriveItem[]) {
    const importable = items.filter((i) => i.type !== "folder");
    if (importable.length === 0) { setShowDrive(false); return; }
    setDriveImporting(true);
    setDriveProgress({ current: 0, total: importable.length });
    for (let i = 0; i < importable.length; i++) {
      setDriveStatus(`Importing ${importable[i].name}…`);
      setDriveProgress({ current: i + 1, total: importable.length });
      try {
        await importRegFromDrive(importable[i].id, parentId);
      } catch (e) {
        setDriveStatus(apiError(e, `Failed to import ${importable[i].name}`));
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    qc.invalidateQueries({ queryKey: ["reg-files", parentId] });
    setDriveImporting(false);
    setDriveStatus(null);
    setDriveProgress(null);
    setShowDrive(false);
  }

  function openNode(node: RegNode) {
    if (node.node_type === "folder") {
      setParentId(node.id);
    } else if (node.is_editable && canWrite) {
      setEditTarget(node);
    } else {
      downloadRegFile(node.id, node.name);
    }
  }

  const nodes = listing?.nodes ?? [];
  const breadcrumb = listing?.breadcrumb ?? [{ id: null, name: "Regulatory" }];

  return (
    <div className="flex flex-col gap-5 p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ShieldAlert className="h-6 w-6" />
            Regulatory Files
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Controlled document store. {canWrite ? "You can create, edit, move, and delete files." : "You have read-only access."}
          </p>
        </div>
        {canWrite && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setShowNewFolder(true)}
              className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent"
            >
              <FolderPlus className="h-4 w-4" /> New Folder
            </button>
            <label className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent">
              <Upload className="h-4 w-4" /> Upload
              <input type="file" multiple className="hidden" onChange={handleUpload} />
            </label>
            <button
              onClick={() => setShowDrive(true)}
              className="flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <HardDrive className="h-4 w-4" /> Import from Drive
            </button>
          </div>
        )}
      </div>

      {/* Read-only banner */}
      {!canWrite && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
          <Lock className="h-4 w-4 shrink-0" />
          You have read-only access to regulatory files. Ask an administrator for write access.
        </div>
      )}

      {/* Breadcrumb */}
      <div className="flex flex-wrap items-center gap-1 text-sm">
        {parentId !== null && (
          <button
            onClick={() => setParentId(breadcrumb[breadcrumb.length - 2]?.id ?? null)}
            className="mr-1 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Up one level"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        {breadcrumb.map((c, i) => (
          <span key={c.id ?? "root"} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
            <button
              onClick={() => setParentId(c.id)}
              className={cn(
                "rounded px-1.5 py-0.5 hover:bg-accent",
                i === breadcrumb.length - 1 ? "font-semibold" : "text-muted-foreground",
              )}
            >
              {c.name}
            </button>
          </span>
        ))}
      </div>

      {uploadError && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{uploadError}</p>
      )}

      {/* Listing */}
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading…
          </div>
        ) : nodes.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground">
            <Folder className="mx-auto mb-3 h-8 w-8 opacity-30" />
            <p className="text-sm font-medium">This folder is empty</p>
            {canWrite && <p className="mt-1 text-xs">Create a folder, upload, or import from Drive.</p>}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-xs text-muted-foreground">
                <th className="px-4 py-2.5 text-left font-medium">Name</th>
                <th className="hidden px-4 py-2.5 text-left font-medium sm:table-cell">Source</th>
                <th className="hidden px-4 py-2.5 text-left font-medium md:table-cell">Size</th>
                <th className="hidden px-4 py-2.5 text-left font-medium lg:table-cell">Modified</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {nodes.map((node) => {
                const Icon = node.node_type === "folder" ? Folder : fileIcon(node);
                return (
                  <tr
                    key={node.id}
                    onDoubleClick={() => openNode(node)}
                    className="group cursor-pointer border-b last:border-0 hover:bg-accent/30"
                  >
                    <td className="px-4 py-2.5">
                      <button onClick={() => openNode(node)} className="flex items-center gap-2.5 text-left">
                        <Icon className={cn("h-5 w-5 shrink-0", node.node_type === "folder" ? "text-amber-500" : "text-muted-foreground")} />
                        <span className="font-medium">{node.name}</span>
                      </button>
                    </td>
                    <td className="hidden px-4 py-2.5 text-xs text-muted-foreground sm:table-cell">
                      {node.node_type === "folder" ? "—"
                        : node.source_type === "google_drive" ? "Drive"
                        : node.source_type === "upload" ? "Upload" : "Local"}
                    </td>
                    <td className="hidden px-4 py-2.5 text-xs text-muted-foreground md:table-cell">
                      {node.node_type === "folder" ? "—" : formatBytes(node.size_bytes)}
                    </td>
                    <td className="hidden px-4 py-2.5 text-xs text-muted-foreground lg:table-cell">
                      {new Date(node.updated_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <RowMenu
                        node={node}
                        canWrite={canWrite}
                        onDownload={() => downloadRegFile(node.id, node.name)}
                        onEdit={() => setEditTarget(node)}
                        onRename={() => setRenameTarget(node)}
                        onMove={() => setMoveTarget(node)}
                        onDelete={() => {
                          if (confirm(`Delete "${node.name}"${node.node_type === "folder" ? " and everything in it" : ""}? This can't be undone.`)) {
                            deleteMut.mutate(node.id);
                          }
                        }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Files are stored locally. Source files mostly originate from the PMI Share Drive — use
        “Import from Drive” to pull a working copy into this controlled store.
      </p>

      {/* Modals */}
      {showNewFolder && <NewFolderModal parentId={parentId} onClose={() => setShowNewFolder(false)} />}
      {renameTarget && <RenameModal node={renameTarget} parentId={parentId} onClose={() => setRenameTarget(null)} />}
      {moveTarget && <MoveModal node={moveTarget} sourceParentId={parentId} onClose={() => setMoveTarget(null)} />}
      {editTarget && <EditModal node={editTarget} parentId={parentId} onClose={() => setEditTarget(null)} />}
      {showDrive && (
        <DriveBrowser
          onClose={() => { if (!driveImporting) setShowDrive(false); }}
          onSelect={handleDriveImport}
          importing={driveImporting}
          importStatus={driveStatus}
          importProgress={driveProgress}
        />
      )}
    </div>
  );
}
