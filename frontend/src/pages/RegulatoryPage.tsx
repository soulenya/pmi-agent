import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  Folder, FolderPlus, Upload, FileText, FileSpreadsheet, FileImage,
  FileCode, FileArchive, File as FileIcon, MoreVertical, Pencil, Trash2,
  Download, FolderInput, X, Loader2, ChevronRight, ShieldAlert, Save,
  HardDrive, ArrowLeft, Lock, RefreshCw, AlertTriangle, CheckCircle2,
  Sparkles, ClipboardCheck, ArrowRight, ScanText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";
import { DropOverlay } from "@/components/DropOverlay";
import { ExtractDataModal } from "@/components/ExtractDataModal";
import { useFileDrop } from "@/hooks/useFileDrop";
import { DriveBrowser } from "@/components/google/DriveBrowser";
import { SaveFileDialog } from "@/components/SaveFileDialog";
import type { DriveItem } from "@/api/google";
import {
  listRegNodes, createRegFolder, uploadRegFile, importRegFromDrive,
  renameRegNode, moveRegNode, deleteRegNode, getRegText, saveRegText, getRegNode,
  fetchRegFileBlob, checkRegUpdates, applyRegUpdate, dismissRegUpdate,
  type RegNode, type RegSyncChange, type RegCheckUpdatesSummary,
} from "@/api/regulatoryFiles";
import {
  listRegTemplates, recommendRegFormat, generateRegDocument,
  type RegTemplateInfo, type RegGenerateResult,
} from "@/api/regulatoryTemplates";
import { createTask } from "@/api/tasks";
import type { TaskPriority } from "@/types/tasks";

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

function RowMenu({ node, canWrite, onEdit, onRename, onMove, onDelete, onDownload, onExtract }: {
  node: RegNode; canWrite: boolean;
  onEdit: () => void; onRename: () => void; onMove: () => void; onDelete: () => void; onDownload: () => void;
  onExtract: () => void;
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
            {node.node_type === "file" && /\.(pdf|png|jpe?g|gif|webp)$/i.test(node.name) && (
              <MenuItem icon={<ScanText className="h-3.5 w-3.5" />} label="Extract data" onClick={() => { setOpen(false); onExtract(); }} />
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

// ── Drive sync review modal (selective — regulated) ─────────────────────────

const SYNC_BADGE: Record<string, { label: string; cls: string }> = {
  modified: {
    label: "Update available",
    cls: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300",
  },
  renamed: {
    label: "Renamed in source",
    cls: "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-900/20 dark:text-blue-300",
  },
  deleted: {
    label: "Source deleted",
    cls: "border-red-300 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-900/20 dark:text-red-300",
  },
};

type RowState = "idle" | "working" | "updated" | "dismissed" | "error";

function SyncReviewModal({
  changes,
  parentId,
  onClose,
}: {
  changes: RegSyncChange[];
  parentId: string | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  // Regulated section: nothing is pre-selected — the user deliberately picks files.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  // Items still awaiting a decision (not yet updated/dismissed).
  const pending = changes.filter(
    (c) => rowState[c.id] !== "updated" && rowState[c.id] !== "dismissed",
  );
  const allDone = pending.length === 0;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    const selectableIds = pending.map((c) => c.id);
    setSelected((prev) =>
      selectableIds.every((id) => prev.has(id)) ? new Set() : new Set(selectableIds),
    );
  }

  async function run(action: "apply" | "dismiss") {
    const ids = pending.filter((c) => selected.has(c.id)).map((c) => c.id);
    if (ids.length === 0) return;
    setBusy(true);
    for (const id of ids) {
      const change = changes.find((c) => c.id === id);
      // A deleted source can't be re-imported — only dismissed.
      if (action === "apply" && change?.sync_status === "deleted") {
        setRowState((s) => ({ ...s, [id]: "error" }));
        setRowError((e) => ({
          ...e,
          [id]: "Source was deleted in Drive — re-import isn't possible. Dismiss to keep the current copy.",
        }));
        continue;
      }
      setRowState((s) => ({ ...s, [id]: "working" }));
      try {
        if (action === "apply") await applyRegUpdate(id);
        else await dismissRegUpdate(id);
        setRowState((s) => ({ ...s, [id]: action === "apply" ? "updated" : "dismissed" }));
        setRowError((e) => {
          const n = { ...e };
          delete n[id];
          return n;
        });
        setSelected((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      } catch (err) {
        setRowState((s) => ({ ...s, [id]: "error" }));
        setRowError((e) => ({ ...e, [id]: apiError(err, "Action failed") }));
      }
    }
    setBusy(false);
    qc.invalidateQueries({ queryKey: ["reg-files", parentId] });
  }

  const selectedCount = pending.filter((c) => selected.has(c.id)).length;

  return (
    <ModalShell
      title="Review Drive changes"
      icon={<RefreshCw className="h-5 w-5 text-primary" />}
      onClose={onClose}
    >
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            This is a controlled store. Changes are <strong>never applied automatically</strong> — select
            only the files you want to re-import, then choose an action.
          </span>
        </div>

        {allDone ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
            <CheckCircle2 className="h-8 w-8 text-emerald-500" />
            <p className="text-sm font-medium">All changes have been reviewed.</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <button
                onClick={toggleAll}
                disabled={busy}
                className="text-xs font-medium text-primary hover:underline disabled:opacity-50"
              >
                {pending.every((c) => selected.has(c.id)) ? "Deselect all" : "Select all"}
              </button>
              <span className="text-xs text-muted-foreground">
                {selectedCount} of {pending.length} selected
              </span>
            </div>

            <div className="max-h-72 space-y-1.5 overflow-y-auto">
              {changes.map((c) => {
                const state = rowState[c.id] ?? "idle";
                const settled = state === "updated" || state === "dismissed";
                const badge = SYNC_BADGE[c.sync_status] ?? SYNC_BADGE.modified;
                return (
                  <label
                    key={c.id}
                    className={cn(
                      "flex items-start gap-2.5 rounded-md border px-3 py-2 text-sm",
                      settled ? "opacity-60" : "cursor-pointer hover:bg-accent/30",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 shrink-0"
                      checked={selected.has(c.id)}
                      disabled={busy || settled}
                      onChange={() => toggle(c.id)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium">{c.name}</span>
                        <span className={cn("rounded-full border px-1.5 py-0.5 text-[10px] font-medium", badge.cls)}>
                          {badge.label}
                        </span>
                        {state === "working" && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                        {state === "updated" && <span className="text-[10px] font-medium text-emerald-600">Re-imported</span>}
                        {state === "dismissed" && <span className="text-[10px] font-medium text-muted-foreground">Dismissed</span>}
                      </div>
                      {c.detail && <p className="mt-0.5 text-xs text-muted-foreground">{c.detail}</p>}
                      {rowError[c.id] && <p className="mt-0.5 text-xs text-destructive">{rowError[c.id]}</p>}
                    </div>
                  </label>
                );
              })}
            </div>
          </>
        )}

        <div className="flex items-center justify-end gap-2 border-t pt-3">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            {allDone ? "Done" : "Close"}
          </button>
          {!allDone && (
            <>
              <button
                onClick={() => run("dismiss")}
                disabled={busy || selectedCount === 0}
                className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
                title="Keep the current local copy and clear the flag"
              >
                Dismiss selected
              </button>
              <button
                onClick={() => run("apply")}
                disabled={busy || selectedCount === 0}
                className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Re-import selected
              </button>
            </>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

// ── Generate document wizard ────────────────────────────────────────────────

function GenerateDocModal({ parentId, folderName, onClose }: {
  parentId: string | null;
  folderName: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Step 1 — what to create
  const { data: templates, isLoading: loadingTemplates } = useQuery({
    queryKey: ["reg-templates"],
    queryFn: listRegTemplates,
  });
  const [templateKey, setTemplateKey] = useState("");
  const [title, setTitle] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
  const [docNumber, setDocNumber] = useState("");
  const [notes, setNotes] = useState("");
  const selected: RegTemplateInfo | null = templates?.find((t) => t.key === templateKey) ?? null;

  const categories = Array.from(new Set((templates ?? []).map((t) => t.category)));

  function pickTemplate(key: string) {
    setTemplateKey(key);
    const t = templates?.find((x) => x.key === key);
    if (t && !titleTouched) setTitle(t.label);
  }

  // Step 2 — AI-recommended formatting
  const [format, setFormat] = useState<"docx" | "md">("docx");
  const [sectionsText, setSectionsText] = useState("");
  const [rationale, setRationale] = useState<string | null>(null);
  const recMut = useMutation({
    mutationFn: () =>
      recommendRegFormat({ template_key: templateKey, title: title.trim(), notes: notes.trim() || null }),
    onSuccess: (rec) => {
      setFormat(rec.format);
      setSectionsText(rec.sections.join("\n"));
      setRationale(rec.rationale);
      setStep(2);
    },
  });

  // Step 3 — auto-populate + generate
  const [autoPopulate, setAutoPopulate] = useState(true);
  const [result, setResult] = useState<RegGenerateResult | null>(null);
  const genMut = useMutation({
    mutationFn: () =>
      generateRegDocument({
        template_key: templateKey,
        title: title.trim(),
        doc_number: docNumber.trim() || null,
        sections: sectionsText.split("\n").map((s) => s.trim()).filter(Boolean),
        format,
        auto_populate: autoPopulate,
        notes: notes.trim() || null,
        parent_id: parentId,
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["reg-files", parentId] });
      setResult(res);
      setStep(4);
    },
  });

  // Step 4 — review task + preview
  const [taskCreated, setTaskCreated] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const taskMut = useMutation({
    mutationFn: () => {
      if (!result) throw new Error("No generated document.");
      const rt = result.review_task;
      return createTask({
        title: rt.title,
        description: rt.description,
        priority: rt.priority as TaskPriority,
        due_date: rt.due_date,
        tags: rt.tags,
        source_ref: {
          kind: "regulatory_doc",
          id: result.node.id,
          label: result.node.name,
        },
      });
    },
    onSuccess: () => {
      setTaskCreated(true);
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const busy = recMut.isPending || genMut.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">Generate Regulatory Document</h2>
            <span className="ml-2 text-xs text-muted-foreground">Step {step} of 4</span>
          </div>
          <button
            onClick={() => { if (!busy) onClose(); }}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {/* ── Step 1: what to create ── */}
          {step === 1 && (
            <>
              <p className="text-sm text-muted-foreground">
                What would you like to create? Pick an FDA or ISO template and give it a title.
              </p>
              {loadingTemplates ? (
                <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              ) : (
                <>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Template</label>
                    <select
                      value={templateKey}
                      onChange={(e) => pickTemplate(e.target.value)}
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="" disabled>Select a document template…</option>
                      {categories.map((cat) => (
                        <optgroup key={cat} label={cat}>
                          {(templates ?? []).filter((t) => t.category === cat).map((t) => (
                            <option key={t.key} value={t.key}>{t.label}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                  {selected && (
                    <div className="rounded-md border bg-muted/40 px-3 py-2.5 text-xs">
                      <p className="text-muted-foreground">{selected.description}</p>
                      <p className="mt-1.5">
                        {selected.related_standards.map((s) => (
                          <span key={s} className="mr-1.5 inline-block rounded-full border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{s}</span>
                        ))}
                      </p>
                    </div>
                  )}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-muted-foreground">Title</label>
                      <input
                        value={title}
                        onChange={(e) => { setTitle(e.target.value); setTitleTouched(true); }}
                        placeholder="Document title"
                        className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-muted-foreground">Document number (optional)</label>
                      <input
                        value={docNumber}
                        onChange={(e) => setDocNumber(e.target.value)}
                        placeholder="e.g. SOP-001"
                        className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Notes for the AI (optional)</label>
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={2}
                      placeholder="Anything specific this document should cover…"
                      className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Saving into: <span className="font-medium text-foreground">{folderName}</span>
                  </p>
                </>
              )}
              {recMut.isError && (
                <p className="text-xs text-destructive">{apiError(recMut.error, "Failed to get a formatting recommendation")}</p>
              )}
            </>
          )}

          {/* ── Step 2: formatting recommendation ── */}
          {step === 2 && (
            <>
              {rationale && (
                <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2.5 text-xs">
                  <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <p><span className="font-medium">Recommended formatting:</span> {rationale}</p>
                </div>
              )}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Output format</label>
                <div className="space-y-2">
                  <label className="flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                    <input type="radio" checked={format === "docx"} onChange={() => setFormat("docx")} className="mt-0.5" />
                    <span>
                      <span className="font-medium">Word document (.docx)</span>
                      <span className="block text-xs text-muted-foreground">Formal controlled document — download and edit in Word.</span>
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                    <input type="radio" checked={format === "md"} onChange={() => setFormat("md")} className="mt-0.5" />
                    <span>
                      <span className="font-medium">Markdown (.md)</span>
                      <span className="block text-xs text-muted-foreground">Editable directly in this app's text editor.</span>
                    </span>
                  </label>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Sections (one per line — edit freely)</label>
                <textarea
                  value={sectionsText}
                  onChange={(e) => setSectionsText(e.target.value)}
                  rows={9}
                  spellCheck={false}
                  className="w-full resize-none rounded-md border bg-background px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </>
          )}

          {/* ── Step 3: auto-populate ── */}
          {step === 3 && (
            <>
              <p className="text-sm text-muted-foreground">
                Would you like Little Gerry to auto-populate the document?
              </p>
              <div className="space-y-2">
                <label className="flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                  <input type="radio" checked={autoPopulate} onChange={() => setAutoPopulate(true)} className="mt-0.5" />
                  <span>
                    <span className="font-medium">Yes — auto-populate (recommended)</span>
                    <span className="block text-xs text-muted-foreground">
                      Fills in PMI and VACTOR specifics from the company profile and knowledge base.
                      Anything unknown is left as a [FILL IN: …] placeholder — nothing is invented.
                    </span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                  <input type="radio" checked={!autoPopulate} onChange={() => setAutoPopulate(false)} className="mt-0.5" />
                  <span>
                    <span className="font-medium">No — blank template</span>
                    <span className="block text-xs text-muted-foreground">
                      Generates the structure with guidance and [FILL IN: …] placeholders only.
                    </span>
                  </span>
                </label>
              </div>
              {genMut.isPending && (
                <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Drafting "{title.trim()}" — this can take a minute…
                </div>
              )}
              {genMut.isError && (
                <p className="text-xs text-destructive">{apiError(genMut.error, "Document generation failed")}</p>
              )}
            </>
          )}

          {/* ── Step 4: done + review task ── */}
          {step === 4 && result && (
            <>
              <div className="flex flex-col gap-2.5 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>
                    <span className="font-medium">{result.node.name}</span> was created in{" "}
                    <span className="font-medium">{folderName}</span>.
                    {result.node.is_editable
                      ? " You can preview and edit it right here in the app."
                      : " Open it to download and review in Word."}
                  </p>
                </div>
                <button
                  onClick={() => setPreviewOpen(true)}
                  className="inline-flex items-center gap-1.5 self-start rounded-md border border-emerald-400 bg-white/70 px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-white dark:border-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-200 dark:hover:bg-emerald-900/50"
                >
                  {result.node.is_editable
                    ? (<><FileText className="h-3.5 w-3.5" /> Open &amp; preview</>)
                    : (<><Download className="h-3.5 w-3.5" /> Open to download</>)}
                </button>
              </div>
              <div className="rounded-md border px-3 py-3">
                <div className="flex items-start gap-2">
                  <ClipboardCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">Recommended: create a review task</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      AI-generated regulatory content must be reviewed before use. This creates a
                      high-priority task due in one week: "{result.review_task.title}".
                    </p>
                    {taskMut.isError && (
                      <p className="mt-1 text-xs text-destructive">{apiError(taskMut.error, "Failed to create the task")}</p>
                    )}
                  </div>
                  {taskCreated ? (
                    <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-emerald-600">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Task created
                    </span>
                  ) : (
                    <button
                      onClick={() => taskMut.mutate()}
                      disabled={taskMut.isPending}
                      className="flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    >
                      {taskMut.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                      Create task
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t px-5 py-3">
          <div>
            {(step === 2 || step === 3) && (
              <button
                onClick={() => setStep((s) => (s === 3 ? 2 : 1))}
                disabled={busy}
                className="flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm text-muted-foreground hover:bg-accent disabled:opacity-50"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {step < 4 && (
              <button
                onClick={() => { if (!busy) onClose(); }}
                disabled={busy}
                className="rounded-md border px-4 py-2 text-sm text-muted-foreground hover:bg-accent disabled:opacity-50"
              >
                Cancel
              </button>
            )}
            {step === 1 && (
              <button
                onClick={() => recMut.mutate()}
                disabled={!templateKey || !title.trim() || recMut.isPending}
                className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {recMut.isPending
                  ? (<><Loader2 className="h-3.5 w-3.5 animate-spin" /> Researching format…</>)
                  : (<>Next <ArrowRight className="h-3.5 w-3.5" /></>)}
              </button>
            )}
            {step === 2 && (
              <button
                onClick={() => setStep(3)}
                disabled={!sectionsText.trim()}
                className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                Next <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
            {step === 3 && (
              <button
                onClick={() => genMut.mutate()}
                disabled={genMut.isPending}
                className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {genMut.isPending
                  ? (<><Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating…</>)
                  : (<><Sparkles className="h-3.5 w-3.5" /> Generate document</>)}
              </button>
            )}
            {step === 4 && (
              <button
                onClick={onClose}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Done
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Preview / open the just-created file directly from the wizard */}
      {previewOpen && result && (
        result.node.is_editable ? (
          <EditModal node={result.node} parentId={parentId} onClose={() => setPreviewOpen(false)} />
        ) : (
          <SaveFileDialog
            filename={result.node.name}
            getBlob={() => fetchRegFileBlob(result.node.id)}
            onClose={() => setPreviewOpen(false)}
          />
        )
      )}
    </div>
  );
}

export function RegulatoryPage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const canWrite = user?.role === "admin" || !!user?.can_write_regulatory;

  const [parentId, setParentId] = useState<string | null>(null);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [showDrive, setShowDrive] = useState(false);
  const [renameTarget, setRenameTarget] = useState<RegNode | null>(null);
  const [moveTarget, setMoveTarget] = useState<RegNode | null>(null);
  const [editTarget, setEditTarget] = useState<RegNode | null>(null);
  const [saveTarget, setSaveTarget] = useState<RegNode | null>(null);
  const [extractTarget, setExtractTarget] = useState<RegNode | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [driveImporting, setDriveImporting] = useState(false);
  const [driveStatus, setDriveStatus] = useState<string | null>(null);
  const [driveProgress, setDriveProgress] = useState<{ current: number; total: number } | null>(null);
  const [syncChanges, setSyncChanges] = useState<RegSyncChange[] | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  // ?doc=<node id> — arriving from a review task highlights that file in its folder.
  const [searchParams, setSearchParams] = useSearchParams();
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  useEffect(() => {
    const id = searchParams.get("doc");
    if (!id) return;
    setFocusNodeId(id);
    const next = new URLSearchParams(searchParams);
    next.delete("doc");
    setSearchParams(next, { replace: true });
    getRegNode(id)
      .then((node) => setParentId(node.parent_id ?? null))
      .catch(() => undefined);
  }, [searchParams, setSearchParams]);

  const checkUpdatesMut = useMutation({
    mutationFn: () => checkRegUpdates(),
    onSuccess: (summary: RegCheckUpdatesSummary) => {
      qc.invalidateQueries({ queryKey: ["reg-files", parentId] });
      if (summary.skipped === "not_connected") {
        setSyncMessage("Connect your Google account in Settings to check for Drive updates.");
        return;
      }
      if (summary.changed === 0) {
        setSyncMessage(
          summary.checked === 0
            ? "No Drive-linked files to check."
            : `All ${summary.checked} Drive-linked file${summary.checked === 1 ? "" : "s"} are up to date.`,
        );
        return;
      }
      setSyncMessage(null);
      setSyncChanges(summary.items);
    },
    onError: (e) => setSyncMessage(apiError(e, "Failed to check for updates")),
  });

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

  // Drag-and-drop anywhere on the page → upload into the current folder.
  const { isDragOver, dropProps } = useFileDrop(
    (files) => {
      setUploadError(null);
      files.forEach((f) => uploadMut.mutate(f));
    },
    { disabled: !canWrite },
  );

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
      setSaveTarget(node);
    }
  }

  const nodes = listing?.nodes ?? [];
  const breadcrumb = listing?.breadcrumb ?? [{ id: null, name: "Regulatory" }];

  return (
    <div className="relative flex flex-col gap-5 p-6 max-w-6xl mx-auto" {...dropProps}>
      <DropOverlay
        show={isDragOver}
        label={`Drop files to upload into ${breadcrumb[breadcrumb.length - 1]?.name ?? "Regulatory"}`}
      />
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
              onClick={() => setShowGenerate(true)}
              className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent"
              title="Generate an FDA / ISO document from a template with AI"
            >
              <Sparkles className="h-4 w-4" /> Generate Document
            </button>
            <button
              onClick={() => { setSyncMessage(null); checkUpdatesMut.mutate(); }}
              disabled={checkUpdatesMut.isPending}
              className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
              title="Check Drive-linked files for source changes"
            >
              {checkUpdatesMut.isPending
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <RefreshCw className="h-4 w-4" />}
              Check for updates
            </button>
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

      {syncMessage && (
        <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <span>{syncMessage}</span>
          <button onClick={() => setSyncMessage(null)} className="rounded p-0.5 hover:bg-accent" title="Dismiss">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
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
                    className={cn(
                      "group cursor-pointer border-b last:border-0 hover:bg-accent/30",
                      focusNodeId === node.id && "bg-primary/10 ring-1 ring-inset ring-primary/40",
                    )}
                  >
                    <td className="px-4 py-2.5">
                      <button onClick={() => openNode(node)} className="flex items-center gap-2.5 text-left">
                        <Icon className={cn("h-5 w-5 shrink-0", node.node_type === "folder" ? "text-amber-500" : "text-muted-foreground")} />
                        <span className="font-medium">{node.name}</span>
                        {node.sync_status && node.sync_status !== "current" && SYNC_BADGE[node.sync_status] && (
                          <span
                            className={cn("rounded-full border px-1.5 py-0.5 text-[10px] font-medium", SYNC_BADGE[node.sync_status].cls)}
                            title={node.sync_detail ?? undefined}
                          >
                            {SYNC_BADGE[node.sync_status].label}
                          </span>
                        )}
                      </button>
                    </td>
                    <td className="hidden px-4 py-2.5 text-xs text-muted-foreground sm:table-cell">
                      {node.node_type === "folder" ? "—"
                        : node.source_type === "google_drive" ? "Drive"
                        : node.source_type === "generated" ? "Generated"
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
                        onDownload={() => setSaveTarget(node)}
                        onExtract={() => setExtractTarget(node)}
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
      {showGenerate && (
        <GenerateDocModal
          parentId={parentId}
          folderName={breadcrumb[breadcrumb.length - 1]?.name ?? "Regulatory"}
          onClose={() => setShowGenerate(false)}
        />
      )}
      {renameTarget && <RenameModal node={renameTarget} parentId={parentId} onClose={() => setRenameTarget(null)} />}
      {moveTarget && <MoveModal node={moveTarget} sourceParentId={parentId} onClose={() => setMoveTarget(null)} />}
      {editTarget && <EditModal node={editTarget} parentId={parentId} onClose={() => setEditTarget(null)} />}
      {saveTarget && (
        <SaveFileDialog
          filename={saveTarget.name}
          getBlob={() => fetchRegFileBlob(saveTarget.id)}
          onClose={() => setSaveTarget(null)}
        />
      )}
      {extractTarget && (
        <ExtractDataModal
          sourceKind="regulatory_node"
          sourceRef={extractTarget.id}
          fileName={extractTarget.name}
          onClose={() => setExtractTarget(null)}
        />
      )}
      {showDrive && (
        <DriveBrowser
          onClose={() => { if (!driveImporting) setShowDrive(false); }}
          onSelect={handleDriveImport}
          importing={driveImporting}
          importStatus={driveStatus}
          importProgress={driveProgress}
        />
      )}
      {syncChanges && (
        <SyncReviewModal
          changes={syncChanges}
          parentId={parentId}
          onClose={() => setSyncChanges(null)}
        />
      )}
    </div>
  );
}
