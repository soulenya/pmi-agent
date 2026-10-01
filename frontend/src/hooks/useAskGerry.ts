import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { createConversation } from "@/api/chat";
import { uploadAttachment } from "@/api/attachments";
import { useChatSidebarStore } from "@/stores/chatSidebarStore";
import { useProjectHere } from "@/hooks/useProjectHere";
import { useIsPhone } from "@/hooks/useViewport";

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
 * Returns an `askGerry` function that opens the assistant panel on a question
 * about a specific item.
 *
 * Inside a project the question goes to the project's own conversation, so
 * Gerry answers with the project's goal, pins and tasks in hand. Anywhere else
 * it starts a NEW conversation, optionally uploading the item's file so Gerry
 * can read its contents.
 *
 * The seed message is auto-sent by the panel once its websocket connects.
 */
export function useAskGerry() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const phone = useIsPhone();
  const setOpen = useChatSidebarStore((s) => s.setOpen);
  const setActive = useChatSidebarStore((s) => s.setActiveConversationId);
  const setPending = useChatSidebarStore((s) => s.setPendingMessage);
  const here = useProjectHere();
  const projectConversationId = here?.conversationId ?? null;

  // No side panel on a phone: the conversation page picks the seed up instead.
  const show = useCallback(
    (conversationId: string, hub: boolean) => {
      setActive(conversationId);
      if (phone) navigate(hub ? `/hub/chat/${conversationId}` : `/chat/${conversationId}`);
      else setOpen(true);
    },
    [phone, navigate, setActive, setOpen],
  );

  return useCallback(
    async ({ title, prompt, file }: AskGerryOptions) => {
      if (projectConversationId) {
        // Attachments belong to this computer's conversations; a hub one
        // carries the question only.
        let seed = prompt;
        if (file && here?.source !== "hub") {
          seed = await attachOrExplain(projectConversationId, file, prompt);
        }
        setPending(seed);
        show(projectConversationId, here?.source === "hub");
        return;
      }

      const conv = await createConversation({ title: title.slice(0, 120), kind: "ask" });
      const seed = file ? await attachOrExplain(conv.id, file, prompt) : prompt;

      await qc.invalidateQueries({ queryKey: ["conversations"] });
      setPending(seed);
      show(conv.id, false);
    },
    [qc, show, setPending, projectConversationId, here?.source],
  );
}

/**
 * Upload the file into the conversation. If the server refuses it, the seed
 * message says so — otherwise Gerry is told "I've attached it" about a file
 * that never arrived and goes looking for it.
 */
async function attachOrExplain(
  conversationId: string,
  file: AskGerryFile,
  prompt: string,
): Promise<string> {
  try {
    const f = new File([file.blob], file.filename, {
      type: file.blob.type || "application/octet-stream",
    });
    await uploadAttachment(conversationId, f);
    return prompt;
  } catch (err) {
    const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data
      ?.detail;
    const reason = typeof detail === "string" ? detail : "the upload failed";
    return (
      `${prompt}\n\n(Note from the app: the file "${file.filename}" could not be attached ` +
      `to this conversation — ${reason} Tell me that plainly rather than guessing at its contents.)`
    );
  }
}
