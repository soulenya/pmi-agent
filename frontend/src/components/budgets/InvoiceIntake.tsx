/**
 * Getting invoices into a budget, and reviewing what turned up.
 *
 * Three ways in — a watched Drive folder, the inbox, or a file handed over by
 * hand — and one way out: a list of what was found, which somebody has to
 * accept before a single figure reaches the sheet. Nothing here writes to the
 * ledger on its own, because a misread total that appears without asking is
 * worse than no automation at all.
 *
 * Every one of these needs the Google account on this computer, so this panel
 * only ever runs against a local budget. The project Budget tab reaches it
 * through the local twin of the shared sheet.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ExternalLink,
  FolderOpen,
  Loader2,
  Mail,
  ScanSearch,
  Upload,
  X,
} from "lucide-react";
import { useRef, useState } from "react";

import { acceptSuggestion, dismissSuggestion, listSuggestions } from "@/api/assistant";
import {
  gmailScanBudget,
  linkBudgetFolder,
  scanBudgetFolder,
  unlinkBudgetFolder,
  updateBudget,
  updateBudgetFolder,
  uploadBudgetInvoice,
  type BudgetDetail,
  type BudgetFolder,
} from "@/api/budgets";
import { money } from "@/components/budgets/BudgetLedger";
import { cn } from "@/lib/utils";
import { useToastStore } from "@/stores/toastStore";

/** What the reader can actually make sense of. */
const ACCEPTED_UPLOADS = ".pdf,.png,.jpg,.jpeg,.gif,.bmp,.tif,.tiff,.csv,.txt";

function detailOf(e: unknown): string | null {
  const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
  return typeof d === "string" ? d : null;
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
  const [linkingKind, setLinkingKind] = useState<"invoice" | "receipt" | null>(null);
  const [ref, setRef] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
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

  const upload = useMutation({
    mutationFn: (file: File) => uploadBudgetInvoice(budget.id, file),
    onSuccess: (r) => {
      onChanged();
      push(
        r.duplicate ? "info" : "success",
        r.duplicate
          ? "That invoice has already been read — it is waiting below, or was dealt with already."
          : `Read ${money(r.amount, budget.currency)}${r.vendor ? ` from ${r.vendor}` : ""} — check it below before it goes on the sheet.`,
      );
    },
    onError: (e) => push("error", detailOf(e) ?? "That file could not be read."),
  });

  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
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
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-xs"
            >
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

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
        <div className="flex items-start gap-3">
          <Upload className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div>
            <p className="text-sm font-medium">Add an invoice yourself</p>
            <p className="text-xs text-muted-foreground">
              For one that arrived on paper or anywhere Gerry cannot reach. It is read for
              its figures and then discarded — the file itself is not kept.
            </p>
          </div>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPTED_UPLOADS}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = ""; // so the same file can be offered twice
            if (file) upload.mutate(file);
          }}
        />
        <button
          onClick={() => fileInput.current?.click()}
          disabled={upload.isPending}
          className="flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent disabled:opacity-60"
        >
          {upload.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Upload className="h-3 w-3" />
          )}
          {upload.isPending ? "Reading…" : "Choose a file"}
        </button>
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
