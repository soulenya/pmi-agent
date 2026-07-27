import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Paperclip, X, FileText, Loader2 } from "lucide-react";
import {
  listAttachments,
  uploadAttachment,
  deleteAttachment,
} from "@/api/attachments";
import type { ChatAttachment } from "@/types/chat";
import { cn } from "@/lib/utils";

const ACCEPT = ".pdf,.docx,.txt,.md,.markdown,.csv,.png,.jpg,.jpeg,.gif,.webp";

/** Extensions accepted as chat reference files (kept in sync with ACCEPT). */
export const CHAT_ATTACHMENT_EXTS = ACCEPT.split(",");

function formatSize(bytes: number | null): string {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function errorMessage(err: unknown): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response
    ?.data?.detail;
  if (typeof detail === "string") return detail;
  return "Could not add the file. Please try again.";
}

/**
 * Reference-file bar shown above the chat input. Files added here are available
 * to the AI for the whole conversation but are NOT added to the Knowledge Base.
 */
export function AttachmentBar({ conversationId }: { conversationId: string }) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const queryKey = ["attachments", conversationId];

  const { data: attachments = [] } = useQuery({
    queryKey,
    queryFn: () => listAttachments(conversationId),
    enabled: !!conversationId,
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadAttachment(conversationId, file),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (attachmentId: string) =>
      deleteAttachment(conversationId, attachmentId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  function handleFiles(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      uploadMutation.mutate(file);
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  const hasAttachments = attachments.length > 0;

  return (
    <div className="mb-2">
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploadMutation.isPending}
          className={cn(
            "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors",
            uploadMutation.isPending
              ? "opacity-60 cursor-not-allowed"
              : "hover:bg-accent",
          )}
          title="Attach a reference file (not added to the Knowledge Base)"
        >
          {uploadMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Paperclip className="h-3.5 w-3.5" />
          )}
          Attach file
        </button>

        {attachments.map((att: ChatAttachment) => (
          <span
            key={att.id}
            className="flex items-center gap-1.5 rounded-md bg-secondary px-2.5 py-1 text-xs text-secondary-foreground"
            title={`${att.file_name}${
              att.file_size_bytes ? ` · ${formatSize(att.file_size_bytes)}` : ""
            }`}
          >
            <FileText className="h-3.5 w-3.5 shrink-0 opacity-70" />
            <span className="max-w-[180px] truncate">{att.file_name}</span>
            <button
              type="button"
              onClick={() => deleteMutation.mutate(att.id)}
              className="shrink-0 text-muted-foreground hover:text-foreground"
              title="Remove file"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>

      {hasAttachments && (
        <p className="mt-1 px-1 text-[11px] text-muted-foreground">
          Reference files — visible to Little Gerry in this conversation, not added
          to the Knowledge Base.
        </p>
      )}
      {error && <p className="mt-1 px-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
