/**
 * The one way into the Knowledge Base.
 *
 * Every place that can add something — an email attachment, a meeting note, a
 * file Gerry made, a page in the browser, a Drive file — opens this and gets
 * the same three questions: what to call it, which category, and whether it is
 * a regulated document. Duplicates are handled the same way everywhere: the
 * existing copy is named and you choose to keep both or stop.
 */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BookPlus, Loader2, ShieldCheck, X } from "lucide-react";

import { listCategories } from "@/api/documents";
import { cn } from "@/lib/utils";

export interface KbMeta {
  title: string;
  category_id: string | null;
  is_regulated: boolean;
  /** Set on the second attempt after a duplicate was reported. */
  force: boolean;
}

export interface KbDuplicate {
  id: string;
  title: string;
  file_name?: string | null;
  created_at?: string | null;
}

/** The 409 every intake endpoint raises when the same bytes are already in. */
export function duplicateFrom(err: unknown): KbDuplicate | null {
  const e = err as { response?: { status?: number; data?: { detail?: unknown } } };
  if (e?.response?.status !== 409) return null;
  const detail = e.response.data?.detail as
    | { code?: string; existing?: KbDuplicate; document_id?: string; message?: string }
    | string
    | undefined;
  if (!detail || typeof detail === "string") return { id: "", title: "the same content" };
  if (detail.existing) return detail.existing;
  if (detail.document_id) return { id: detail.document_id, title: detail.message ?? "an earlier copy" };
  return { id: "", title: "the same content" };
}

export function errorText(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { detail?: unknown } }; message?: string };
  const d = e?.response?.data?.detail;
  if (typeof d === "string") return d;
  if (d && typeof d === "object" && "message" in d && typeof (d as { message: unknown }).message === "string") {
    return (d as { message: string }).message;
  }
  return e?.message || fallback;
}

export interface SaveToKnowledgeBaseDialogProps {
  /** What is being added, for the heading: "this attachment", "the meeting notes". */
  subject: string;
  defaultTitle: string;
  /** Batch imports keep each file's own name; show the summary instead of an input. */
  titleLocked?: boolean;
  defaultCategoryId?: string | null;
  /** Some sources cannot be marked regulated (a web page, an email); hide the box. */
  allowRegulated?: boolean;
  /** Called with the answers; throw the axios error on failure and the dialog explains it. */
  onSubmit: (meta: KbMeta) => Promise<unknown>;
  onDone?: () => void;
  onClose: () => void;
}

export function SaveToKnowledgeBaseDialog({
  subject,
  defaultTitle,
  titleLocked = false,
  defaultCategoryId = null,
  allowRegulated = true,
  onSubmit,
  onDone,
  onClose,
}: SaveToKnowledgeBaseDialogProps) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(defaultTitle);
  const [categoryId, setCategoryId] = useState<string | null>(defaultCategoryId);
  const [regulated, setRegulated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<KbDuplicate | null>(null);

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: listCategories,
    staleTime: 60_000,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(force: boolean) {
    const clean = title.trim();
    if (!clean) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ title: clean, category_id: categoryId, is_regulated: regulated, force });
      qc.invalidateQueries({ queryKey: ["documents"] });
      qc.invalidateQueries({ queryKey: ["categories"] });
      onDone?.();
      onClose();
    } catch (err) {
      const dup = duplicateFrom(err);
      if (dup && !force) setDuplicate(dup);
      else setError(errorText(err, "Could not add it to the Knowledge Base."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between border-b px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <BookPlus className="h-4 w-4 text-primary" />
            Add {subject} to the Knowledge Base
          </h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form
          className="space-y-4 px-5 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(false);
          }}
        >
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">{titleLocked ? "Adding" : "Title"}</span>
            {titleLocked ? (
              <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">{title}</p>
            ) : (
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            )}
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Category</span>
            <select
              value={categoryId ?? ""}
              onChange={(e) => setCategoryId(e.target.value || null)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="">— None —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          {allowRegulated && (
            <label className="flex items-start gap-2.5 rounded-md border px-3 py-2.5">
              <input
                type="checkbox"
                checked={regulated}
                onChange={(e) => setRegulated(e.target.checked)}
                className="mt-0.5"
              />
              <span className="text-sm">
                <span className="flex items-center gap-1.5 font-medium">
                  <ShieldCheck className="h-3.5 w-3.5 text-primary" /> Regulated document
                </span>
                <span className="text-xs text-muted-foreground">
                  ISO, FDA, DHF and the like. Gerry treats it as a controlled record and cites it as one.
                </span>
              </span>
            </label>
          )}

          {duplicate && (
            <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm">
              <p className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <span>
                  The same content is already in the Knowledge Base as{" "}
                  <span className="font-medium">“{duplicate.title}”</span>
                  {duplicate.created_at ? ` (added ${new Date(duplicate.created_at).toLocaleDateString()})` : ""}.
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                Add it anyway only if you mean to keep two copies.
              </p>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent">
              Cancel
            </button>
            {duplicate ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void submit(true)}
                className={cn("inline-flex items-center gap-2 rounded-md border border-amber-500/60 px-3 py-1.5 text-sm hover:bg-amber-500/10 disabled:opacity-50")}
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Add anyway
              </button>
            ) : (
              <button
                type="submit"
                disabled={busy || !title.trim()}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Add to Knowledge Base
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
