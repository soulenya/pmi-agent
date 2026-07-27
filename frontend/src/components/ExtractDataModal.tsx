import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Check, Copy, Loader2, ScanText, X } from "lucide-react";
import {
  listExtractionSchemas,
  runExtraction,
  type ExtractionResult,
  type ExtractionSourceKind,
} from "@/api/extractions";

/**
 * "Extract data" modal — runs vision extraction on a file (chat attachment,
 * regulatory file, or generated file) with an optional saved schema.
 */
export function ExtractDataModal({
  sourceKind,
  sourceRef,
  fileName,
  onClose,
}: {
  sourceKind: ExtractionSourceKind;
  sourceRef: string;
  fileName: string;
  onClose: () => void;
}) {
  const [schemaName, setSchemaName] = useState<string>("");
  const [instruction, setInstruction] = useState("");
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: schemas = [] } = useQuery({
    queryKey: ["extraction-schemas"],
    queryFn: listExtractionSchemas,
    staleTime: 60_000,
  });

  const run = useMutation({
    mutationFn: () =>
      runExtraction({
        source_kind: sourceKind,
        source_ref: sourceRef,
        schema_name: schemaName || undefined,
        instruction: instruction.trim() || undefined,
      }),
    onSuccess: setResult,
  });

  const errText =
    result?.status === "error"
      ? result.error
      : run.isError
        ? ((run.error as { response?: { data?: { detail?: string } } })?.response?.data
            ?.detail ?? "Extraction failed. Please try again.")
        : null;

  async function copyJson() {
    if (!result?.structured) return;
    await navigator.clipboard.writeText(JSON.stringify(result.structured, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <ScanText className="h-4 w-4" />
            Extract data — <span className="max-w-[280px] truncate font-normal">{fileName}</span>
          </h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 overflow-y-auto px-5 py-4">
          {!result && (
            <>
              <label className="block">
                <span className="mb-1 block text-sm font-medium">Schema</span>
                <select
                  value={schemaName}
                  onChange={(e) => setSchemaName(e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="">Transcription only (no structured fields)</option>
                  {schemas.map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.name}
                      {s.description ? ` — ${s.description}` : ""}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-xs text-muted-foreground">
                  Saved schemas are managed in Settings → Extraction Schemas. Fields not
                  present in the document come back empty — never invented.
                </span>
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium">Instruction (optional)</span>
                <input
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder="e.g. Only the totals section matters"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </label>
            </>
          )}

          {errText && <p className="text-sm text-destructive">{errText}</p>}

          {result && result.status === "ok" && (
            <>
              <p className="text-xs text-muted-foreground">
                {result.pages ?? 1} page(s) · {result.model}
                {result.input_tokens != null &&
                  ` · ${result.input_tokens}/${result.output_tokens ?? 0} tokens`}
              </p>
              {result.structured && (
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-sm font-medium">Structured data</span>
                    <button
                      onClick={copyJson}
                      className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent"
                    >
                      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      {copied ? "Copied" : "Copy JSON"}
                    </button>
                  </div>
                  <pre className="max-h-64 overflow-auto rounded-md border bg-muted/40 p-3 text-xs">
                    {JSON.stringify(result.structured, null, 2)}
                  </pre>
                </div>
              )}
              <details>
                <summary className="cursor-pointer text-sm font-medium">
                  Transcribed text{result.raw_text_truncated ? " (truncated)" : ""}
                </summary>
                <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-xs">
                  {result.raw_text || "(no text)"}
                </pre>
              </details>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t px-5 py-3">
          {result ? (
            <button
              onClick={() => { setResult(null); run.reset(); }}
              className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
            >
              Run again
            </button>
          ) : (
            <button
              onClick={() => run.mutate()}
              disabled={run.isPending}
              className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {run.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Reading document…
                </>
              ) : (
                <>
                  <ScanText className="h-4 w-4" /> Extract
                </>
              )}
            </button>
          )}
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm hover:bg-accent">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
