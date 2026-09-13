/**
 * Getting invoices into a budget, and reviewing what turned up.
 *
 * Four ways in — a watched Drive folder, the inbox, a file handed over by
 * hand or dropped onto the panel, and a file picked off Drive — and one way
 * out: a list of what was found, which somebody has to accept before a
 * single figure reaches the sheet. Nothing here writes to the ledger on its
 * own, because a misread total that appears without asking is worse than no
 * automation at all.
 *
 * Every one of these needs the Google account on this computer, so this panel
 * only ever runs against a local budget. The project Budget tab reaches it
 * through the local twin of the shared sheet.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FolderOpen,
  Loader2,
  Mail,
  ScanSearch,
  Upload,
  X,
} from "lucide-react";
import { useRef, useState, type DragEvent } from "react";

import { acceptSuggestion, dismissSuggestion, listSuggestions } from "@/api/assistant";
import {
  gmailScanBudget,
  intakeDriveInvoice,
  linkBudgetFolder,
  listBudgetFolderFiles,
  scanBudgetFolder,
  unlinkBudgetFolder,
  updateBudget,
  updateBudgetFolder,
  uploadBudgetInvoice,
  type BudgetDetail,
  type BudgetFolder,
  type DriveIntakeResult,
  type FolderFile,
  type InvoiceUploadResult,
} from "@/api/budgets";
import { money } from "@/components/budgets/BudgetLedger";
import { cn } from "@/lib/utils";
import { useToastStore } from "@/stores/toastStore";

/** What the reader can actually make sense of. */
const ACCEPTED_UPLOADS = ".pdf,.png,.jpg,.jpeg,.gif,.bmp,.tif,.tiff,.csv,.txt";

const DRIVE_URL_RE = /https?:\/\/(?:drive|docs)\.google\.com\/\S+/i;

/** A Drive link carried by a drag — from the Drive tab, or a pasted URL. */
function driveLinkIn(dt: DataTransfer): string | null {
  for (const type of ["text/uri-list", "text/plain"]) {
    const m = dt.getData(type).match(DRIVE_URL_RE);
    if (m) return m[0];
  }
  return null;
}

function detailOf(e: unknown): string | null {
  const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
  return typeof d === "string" ? d : null;
}

const FILE_STATUS: Record<NonNullable<FolderFile["status"]>, { label: string; cls: string }> = {
  suggested: { label: "read", cls: "bg-primary/10 text-primary" },
  already_suggested: { label: "read", cls: "bg-primary/10 text-primary" },
  no_amount: { label: "no amount found", cls: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" },
  error: { label: "failed", cls: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300" },
};

/**
 * The files in one linked folder, each with a Read button, so a single
 * invoice can be pulled in without waiting for a whole scan.
 */
function FolderFiles({
  budget,
  folder,
  onRead,
}: {
  budget: BudgetDetail;
  folder: BudgetFolder;
  onRead: (ref: string, folderRowId: string) => Promise<unknown>;
}) {
  const [busyFile, setBusyFile] = useState<string | null>(null);
  const files = useQuery({
    queryKey: ["budget-folder-files", budget.id, folder.id],
    queryFn: () => listBudgetFolderFiles(budget.id, folder.id),
  });

  if (files.isLoading) {
    return <p className="px-2 py-1 text-xs text-muted-foreground">Listing the folder…</p>;
  }
  if (files.isError) {
    return (
      <p className="px-2 py-1 text-xs text-red-600">
        {detailOf(files.error) ?? "The folder could not be listed."}
      </p>
    );
  }
  const rows = files.data ?? [];
  if (rows.length === 0) {
    return <p className="px-2 py-1 text-xs text-muted-foreground">The folder is empty.</p>;
  }
  return (
    <ul className="max-h-64 divide-y overflow-y-auto rounded-md border bg-background">
      {rows.map((f) => {
        const st = f.status ? FILE_STATUS[f.status] : null;
        return (
          <li key={f.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2.5 py-1.5 text-xs">
            <a
              href={f.url}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-0 flex-1 truncate hover:underline"
              title={f.name}
            >
              {f.name}
            </a>
            {f.amount != null && (
              <span className="text-muted-foreground">
                {money(f.amount, budget.currency)}
                {f.vendor && ` · ${f.vendor}`}
              </span>
            )}
            {!f.supported ? (
              <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] text-muted-foreground">
                not a PDF, image or CSV
              </span>
            ) : st ? (
              <span className={cn("rounded px-1.5 py-0.5 text-[10px]", st.cls)}>{st.label}</span>
            ) : null}
            {f.supported && f.status !== "suggested" && f.status !== "already_suggested" && (
              <button
                onClick={async () => {
                  setBusyFile(f.id);
                  try {
                    await onRead(f.id, folder.id);
                    await files.refetch();
                  } finally {
                    setBusyFile(null);
                  }
                }}
                disabled={busyFile !== null}
                className="flex items-center gap-1 rounded-md border px-2 py-0.5 hover:bg-accent disabled:opacity-60"
                title="Read this file now and put what it says below to accept"
              >
                {busyFile === f.id ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <ScanSearch className="h-3 w-3" />
                )}
                {f.status ? "Read again" : "Read"}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Where invoices come from: linked folders, the inbox, and the upload button.
 */
function SourcesPanel({
  budget,
  onChanged,
}: {
  budget: BudgetDetail;
  onChanged: () => void;
}) {
  const push = useToastStore((s) => s.push);
  const qc = useQueryClient();
  const [linkingKind, setLinkingKind] = useState<"invoice" | "receipt" | null>(null);
  const [ref, setRef] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openFolder, setOpenFolder] = useState<string | null>(null);
  const [driveRef, setDriveRef] = useState("");
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  const scan = async (folderRowId: string, name: string) => {
    setBusyId(folderRowId);
    try {
      const r = await scanBudgetFolder(budget.id, folderRowId);
      const bits = [`${r.scanned} file(s) read`];
      if (r.suggested) bits.push(`${r.suggested} to review below`);
      if (r.no_amount) bits.push(`${r.no_amount} with no readable amount`);
      if (r.errors) bits.push(`${r.errors} failed`);
      if (r.remaining) bits.push(`${r.remaining} more on the next scan`);
      push(r.suggested ? "success" : "info", `Scanned "${name}": ${bits.join(", ")}.`);
      onChanged();
    } catch (e) {
      push("error", detailOf(e) ?? "Scan failed.");
    } finally {
      setBusyId(null);
    }
  };

  const link = async () => {
    if (!linkingKind || !ref.trim()) return;
    setBusyId("link");
    try {
      const folder = await linkBudgetFolder(budget.id, { kind: linkingKind, ref: ref.trim() });
      setRef("");
      setLinkingKind(null);
      onChanged();
      if (
        window.confirm(
          `"${folder.folder_name}" linked. Read it for ${linkingKind}s now? (Your files are only read, never changed.)`,
        )
      ) {
        await scan(folder.id, folder.folder_name);
      }
    } catch (e) {
      push("error", detailOf(e) ?? "Couldn't link the folder.");
    } finally {
      setBusyId(null);
    }
  };

  const unlink = async (f: BudgetFolder) => {
    if (
      !window.confirm(`Unlink "${f.folder_name}"? The Drive folder and its files stay untouched.`)
    ) {
      return;
    }
    await unlinkBudgetFolder(budget.id, f.id);
    onChanged();
  };

  const gmailToggle = useMutation({
    mutationFn: (enabled: boolean) => updateBudget(budget.id, { gmail_check_enabled: enabled }),
    onSuccess: (b) => {
      onChanged();
      push(
        "info",
        b.gmail_check_enabled
          ? "The inbox will be checked daily for invoices, and findings listed here to accept."
          : "Daily inbox checks are off for this budget.",
      );
    },
  });

  const gmailNow = useMutation({
    mutationFn: () => gmailScanBudget(budget.id),
    onSuccess: (r) => {
      onChanged();
      push(
        r.suggested ? "success" : "info",
        r.suggested
          ? `Found ${r.suggested} invoice${r.suggested === 1 ? "" : "s"} in the inbox to review below.`
          : "No new invoices in the last couple of days.",
      );
    },
    onError: (e) => push("error", detailOf(e) ?? "The inbox could not be checked."),
  });

  const readToast = (r: InvoiceUploadResult | DriveIntakeResult, where: string) => {
    qc.invalidateQueries({ queryKey: ["budget-suggestions", budget.id] });
    push(
      r.duplicate ? "info" : "success",
      r.duplicate
        ? `${where} has already been read — it is waiting below, or was dealt with already.`
        : `Read ${money(r.amount, budget.currency)}${r.vendor ? ` from ${r.vendor}` : ""} (${where}) — check it below before it goes on the sheet.`,
    );
  };

  const upload = useMutation({
    mutationFn: (file: File) => uploadBudgetInvoice(budget.id, file),
    onSuccess: (r, file) => {
      onChanged();
      readToast(r, file.name);
    },
    onError: (e) => push("error", detailOf(e) ?? "That file could not be read."),
  });

  /** One Drive file, by link or by pick. Reports; never throws. */
  const readDrive = async (fileRef: string, folderRowId?: string) => {
    setReading((n) => n + 1);
    try {
      const r = await intakeDriveInvoice(budget.id, fileRef, folderRowId);
      onChanged();
      readToast(r, r.name);
      if (r.in_folder) {
        qc.invalidateQueries({ queryKey: ["budget-folder-files", budget.id] });
      }
      return r;
    } catch (e) {
      push("error", detailOf(e) ?? "That Drive file could not be read.");
      return null;
    } finally {
      setReading((n) => n - 1);
    }
  };

  const readFiles = async (files: File[]) => {
    setReading((n) => n + 1);
    try {
      // One at a time: each is an OCR and a model call.
      for (const file of files) {
        // eslint-disable-next-line no-await-in-loop
        await upload.mutateAsync(file).catch(() => undefined);
      }
    } finally {
      setReading((n) => n - 1);
    }
  };

  const onDrop = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      void readFiles(files);
      return;
    }
    const link = driveLinkIn(e.dataTransfer);
    if (link) void readDrive(link);
    else push("info", "Drop a PDF, image or CSV file, or a Google Drive link.");
  };

  const busy = reading > 0 || upload.isPending;

  return (
    <section
      className={cn(
        "relative space-y-3 rounded-xl border bg-card p-4",
        dragging && "border-primary ring-2 ring-primary/30",
      )}
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragging) setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={onDrop}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-background/80 text-sm font-medium text-primary">
          <Upload className="mr-2 h-4 w-4" /> Drop invoices here to read them
        </div>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <FolderOpen className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div>
            <p className="text-sm font-medium">Where invoices come from</p>
            <p className="text-xs text-muted-foreground">
              Point Gerry at Drive folders of invoices or receipts. She reads them — never
              modifies or moves anything — pulls out the vendor, date and amount, and puts
              them below for you to accept. A category she finds that the sheet does not
              have yet is added to it when you accept.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => {
              setLinkingKind(linkingKind === "invoice" ? null : "invoice");
              setRef("");
            }}
            className={cn(
              "rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent",
              linkingKind === "invoice" && "border-primary text-primary",
            )}
          >
            Link invoice folder
          </button>
          <button
            onClick={() => {
              setLinkingKind(linkingKind === "receipt" ? null : "receipt");
              setRef("");
            }}
            className={cn(
              "rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent",
              linkingKind === "receipt" && "border-primary text-primary",
            )}
          >
            Link receipts folder
          </button>
        </div>
      </div>

      {linkingKind && (
        <div className="flex gap-2">
          <input
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder={`Paste the ${linkingKind} folder's Drive link`}
            className="flex-1 rounded-md border bg-background px-2 py-1.5 text-sm"
            autoFocus
          />
          <button
            onClick={() => void link()}
            disabled={!ref.trim() || busyId === "link"}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {busyId === "link" ? "Linking…" : "Link"}
          </button>
        </div>
      )}

      {budget.folders.length > 0 && (
        <ul className="space-y-2">
          {budget.folders.map((f) => (
            <li
              key={f.id}
              className="space-y-2 rounded-md border px-3 py-2 text-xs"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <button
                onClick={() => setOpenFolder(openFolder === f.id ? null : f.id)}
                className="text-muted-foreground hover:text-foreground"
                title={openFolder === f.id ? "Hide the files" : "Show the files, to read one at a time"}
              >
                {openFolder === f.id ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
              </button>
              <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                {f.kind}
              </span>
              <a
                href={f.folder_url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium hover:underline"
              >
                {f.folder_name}
              </a>
              <span className="text-muted-foreground">
                {f.files_scanned} file(s) read · found {money(f.extracted_total, budget.currency)}
                {f.last_scan_at && ` · last read ${new Date(f.last_scan_at).toLocaleString()}`}
              </span>
              <span className="ml-auto flex items-center gap-2">
                <label
                  className="flex cursor-pointer items-center gap-1.5 text-muted-foreground"
                  title="Read this folder automatically once a day"
                >
                  <input
                    type="checkbox"
                    checked={f.auto_scan}
                    onChange={async (e) => {
                      await updateBudgetFolder(budget.id, f.id, { auto_scan: e.target.checked });
                      onChanged();
                    }}
                    className="h-3.5 w-3.5 accent-primary"
                  />
                  Daily
                </label>
                <button
                  onClick={() => void scan(f.id, f.folder_name)}
                  disabled={busyId === f.id}
                  className="flex items-center gap-1 rounded-md border px-2 py-1 hover:bg-accent disabled:opacity-60"
                >
                  {busyId === f.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <ScanSearch className="h-3 w-3" />
                  )}
                  Read now
                </button>
                <button
                  onClick={() => void unlink(f)}
                  className="text-muted-foreground hover:text-destructive"
                  title="Unlink (folder and files stay untouched)"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
              </div>
              {openFolder === f.id && (
                <FolderFiles budget={budget} folder={f} onRead={readDrive} />
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
        <div className="flex items-start gap-3">
          <Mail className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div>
            <p className="text-sm font-medium">Search the inbox for invoices</p>
            <p className="text-xs text-muted-foreground">
              Invoice-like attachments become entries to review. Accepting one files it into
              the linked invoice folder and logs it. Never automatic.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => gmailNow.mutate()}
            disabled={gmailNow.isPending}
            className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent disabled:opacity-60"
            title="Look through the last couple of days of mail right now"
          >
            {gmailNow.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <ScanSearch className="h-3 w-3" />
            )}
            Check now
          </button>
          <label
            className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground"
            title="Check the inbox automatically once a day"
          >
            <input
              type="checkbox"
              checked={budget.gmail_check_enabled}
              disabled={gmailToggle.isPending}
              onChange={(e) => gmailToggle.mutate(e.target.checked)}
              className="h-3.5 w-3.5 accent-primary"
            />
            Daily
          </label>
        </div>
      </div>

      <div className="space-y-2 border-t pt-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <Upload className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-medium">Add an invoice yourself</p>
              <p className="text-xs text-muted-foreground">
                Drop files onto this panel, choose one from this computer, or paste a Google
                Drive link. Each is read for its figures; a file from this computer is then
                discarded, and a Drive file is left where it is.
              </p>
            </div>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPTED_UPLOADS}
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = ""; // so the same file can be offered twice
              if (files.length > 0) void readFiles(files);
            }}
          />
          <button
            onClick={() => fileInput.current?.click()}
            disabled={busy}
            className="flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Upload className="h-3 w-3" />
            )}
            {busy ? "Reading…" : "Choose a file"}
          </button>
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const link = driveRef.trim();
            if (!link) return;
            setDriveRef("");
            void readDrive(link);
          }}
        >
          <input
            value={driveRef}
            onChange={(e) => setDriveRef(e.target.value)}
            placeholder="Paste a Google Drive file link (or its ID)"
            className="flex-1 rounded-md border bg-background px-2 py-1.5 text-xs"
          />
          <button
            type="submit"
            disabled={!driveRef.trim() || busy}
            className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent disabled:opacity-60"
          >
            <ScanSearch className="h-3 w-3" />
            Read from Drive
          </button>
        </form>
      </div>
    </section>
  );
}

/**
 * What was found and has not been dealt with yet.
 *
 * Hidden entirely when empty: a permanent "nothing here" box on a page this
 * busy is noise.
 */
function FoundInvoices({
  budget,
  onChanged,
}: {
  budget: BudgetDetail;
  onChanged: () => void;
}) {
  const push = useToastStore((s) => s.push);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const suggestions = useQuery({
    queryKey: ["budget-suggestions", budget.id],
    queryFn: () => listSuggestions({ status: "pending" }),
    refetchInterval: 30_000,
    select: (rows) =>
      rows.filter(
        (r) =>
          (r.kind === "budget_entry" || r.kind === "gmail_invoice") &&
          (r.payload as { budget_id?: string })?.budget_id === budget.id,
      ),
  });
  const pending = suggestions.data ?? [];
  if (pending.length === 0) return null;

  const resolve = async (id: string, action: "accept" | "dismiss") => {
    try {
      if (action === "accept") await acceptSuggestion(id);
      else await dismissSuggestion(id);
    } catch (e) {
      push("error", detailOf(e) ?? `Couldn't ${action} that one.`);
    }
    qc.invalidateQueries({ queryKey: ["budget-suggestions", budget.id] });
    onChanged();
  };

  const acceptAll = async () => {
    if (
      !window.confirm(
        `Put all ${pending.length} of these on the sheet? Each one is written as its own line.`,
      )
    ) {
      return;
    }
    setBusy(true);
    for (const s of pending) {
      // Sequential on purpose: each write re-reads the sheet first.
      // eslint-disable-next-line no-await-in-loop
      await resolve(s.id, "accept");
    }
    setBusy(false);
  };

  return (
    <section className="space-y-2 rounded-xl border border-primary/40 bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">
          {pending.length} invoice{pending.length === 1 ? "" : "s"} found, waiting on you
        </p>
        {pending.length > 1 && (
          <button
            onClick={() => void acceptAll()}
            disabled={busy}
            className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {busy ? "Accepting…" : "Accept all"}
          </button>
        )}
      </div>
      <ul className="space-y-1.5">
        {pending.map((s) => {
          const entry = (s.payload as { entry?: { category?: string } })?.entry;
          const category = entry?.category?.trim();
          const isNew =
            !!category &&
            !(budget.cached_categories ?? []).some(
              (c) => c.name.trim().toLowerCase() === category.toLowerCase(),
            );
          return (
            <li
              key={s.id}
              className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-xs"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium">{s.title}</p>
                {s.summary && <p className="truncate text-muted-foreground">{s.summary}</p>}
              </div>
              {category && (
                <span
                  className={cn(
                    "shrink-0 rounded px-1.5 py-0.5 text-[10px]",
                    isNew
                      ? "bg-primary/10 text-primary"
                      : "bg-accent text-muted-foreground",
                  )}
                  title={
                    isNew
                      ? "A category the sheet does not have yet — accepting adds it"
                      : "An existing category on the sheet"
                  }
                >
                  {category}
                  {isNew && " · new"}
                </span>
              )}
              {s.source_url && (
                <a
                  href={s.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground"
                  title="Open the document it came from"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
              <button
                onClick={() => void resolve(s.id, "accept")}
                disabled={busy}
                className="rounded-md border border-primary px-2 py-1 text-primary hover:bg-primary/10 disabled:opacity-60"
              >
                Accept
              </button>
              <button
                onClick={() => void resolve(s.id, "dismiss")}
                disabled={busy}
                className="rounded-md border px-2 py-1 text-muted-foreground hover:bg-accent disabled:opacity-60"
              >
                Dismiss
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function InvoiceIntake({
  budget,
  onChanged,
}: {
  budget: BudgetDetail;
  onChanged: () => void;
}) {
  return (
    <>
      <SourcesPanel budget={budget} onChanged={onChanged} />
      <FoundInvoices budget={budget} onChanged={onChanged} />
    </>
  );
}
