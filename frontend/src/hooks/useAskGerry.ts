import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createConversation } from "@/api/chat";
import { uploadAttachment } from "@/api/attachments";
import { useChatSidebarStore } from "@/stores/chatSidebarStore";

export interface AskGerryFile {
  /** The raw file bytes to attach so Gerry can read the real contents. */
  blob: Blob;
  /** File name (with extension) used for the attachment. */
  filename: string;
}

export interface AskGerryOptions {
  /** Title for the new conversation, e.g. "About: Q3 budget". */
  title: string;
  /** The seed message Gerry answers first. */
  prompt: string;
  /** Optional file to upload into the conversation for full-content access. */
  file?: AskGerryFile;
}

/**
 * Returns an `askGerry` function that starts a NEW conversation seeded with a
 * question about a specific item, optionally uploading the item's file so Gerry
 * can read its contents, then opens the persistent chat window on it.
 *
 * The seed message is auto-sent by the ChatSidebar once its websocket connects.
 */
export function useAskGerry() {
  const qc = useQueryClient();
  const setOpen = useChatSidebarStore((s) => s.setOpen);
  const setActive = useChatSidebarStore((s) => s.setActiveConversationId);
  const setPending = useChatSidebarStore((s) => s.setPendingMessage);

  return useCallback(
    async ({ title, prompt, file }: AskGerryOptions) => {
      const conv = await createConversation({ title: title.slice(0, 120) });

      // Best-effort: upload the file so Gerry reads its real contents. Some
      // file types aren't text-extractable (images, spreadsheets) — if the
      // upload is rejected we still open the conversation with the text prompt.
      if (file) {
        try {
          const f = new File([file.blob], file.filename, {
            type: file.blob.type || "application/octet-stream",
          });
          await uploadAttachment(conv.id, f);
        } catch {
          /* attachment is optional — continue with the text prompt only */
        }
      }

      await qc.invalidateQueries({ queryKey: ["conversations"] });
      setPending(prompt);
      setActive(conv.id);
      setOpen(true);
    },
    [qc, setOpen, setActive, setPending],
  );
}
