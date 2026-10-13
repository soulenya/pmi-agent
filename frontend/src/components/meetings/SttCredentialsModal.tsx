import { useRef, useState } from "react";
import { AlertTriangle, Download, KeyRound, Loader2, Upload, X } from "lucide-react";
import { fetchSttCredentials, uploadSttCredentials } from "@/api/meetings";

function apiErr(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object" && "message" in detail) {
    return String((detail as { message?: unknown }).message ?? fallback);
  }
  return fallback;
}

/**
 * Shown when a recording is uploaded but this machine is missing the company
 * transcription key (little_gerry_stt). Mirrors the login page's
 * "Download credentials" flow: one click fetches the key from the shared Drive
 * link and sets it up automatically.
 */
export function SttCredentialsModal({
  downloadAvailable,
  onClose,
  onReady,
}: {
  downloadAvailable: boolean;
  onClose: () => void;
  onReady: () => void;
}) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setDownloading(true);
    try {
      await uploadSttCredentials(file);
      onReady();
    } catch (err) {
      setError(apiErr(err, "That file isn't a valid service-account key."));
    } finally {
      setDownloading(false);
    }
  }

  async function handleDownload() {
    setError(null);
    setDownloading(true);
    try {
      await fetchSttCredentials();
      onReady();
    } catch (e) {
      setError(apiErr(e, "Couldn't download the transcription credentials. Try again."));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border bg-card shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" />
            Transcription credentials needed
          </h3>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3 text-sm">
          <p className="text-muted-foreground">
            Turning meeting recordings into text needs the company transcription key
            (a Google service-account JSON). This computer doesn't have it yet.
          </p>
          {downloadAvailable ? (
            <p className="text-muted-foreground">
              Click below to download it from the company's shared Drive and set it
              up automatically — there are no files to move or rename.
            </p>
          ) : (
            <p className="text-muted-foreground">
              Ask an administrator for the key file, then choose it below — it is
              installed in the right place for you.
            </p>
          )}
          {error && (
            <p className="flex items-start gap-1.5 text-xs text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t bg-muted/30">
          <button
            onClick={onClose}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
          >
            Cancel
          </button>
          {downloadAvailable ? (
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {downloading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Downloading…
                </>
              ) : (
                <>
                  <Download className="h-3.5 w-3.5" /> Download credentials
                </>
              )}
            </button>
          ) : (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={handleUpload}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={downloading}
                className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {downloading ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Installing…
                  </>
                ) : (
                  <>
                    <Upload className="h-3.5 w-3.5" /> Choose key file
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
