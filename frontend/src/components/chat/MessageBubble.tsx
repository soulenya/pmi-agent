import { cn } from "@/lib/utils";
import type { Message } from "@/types/chat";
import { Bot, User } from "lucide-react";

interface Props {
  message: Message;
}

export function MessageBubble({ message }: Props) {
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";

  if (!isUser && !isAssistant) return null;

  return (
    <div
      className={cn(
        "flex gap-3",
        isUser ? "flex-row-reverse" : "flex-row",
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-secondary text-secondary-foreground",
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>

      {/* Bubble */}
      <div
        className={cn(
          "max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
          isUser
            ? "rounded-tr-sm bg-primary text-primary-foreground"
            : "rounded-tl-sm bg-secondary text-secondary-foreground",
        )}
      >
        <p className="whitespace-pre-wrap break-words">{message.content}</p>

        {/* Citations */}
        {isAssistant && message.cited_chunk_ids && message.cited_chunk_ids.length > 0 && (
          <p className="mt-1 text-xs opacity-60">
            {message.cited_chunk_ids.length} source
            {message.cited_chunk_ids.length > 1 ? "s" : ""} cited
          </p>
        )}

        {/* Model label */}
        {isAssistant && message.model_used && (
          <p className="mt-0.5 text-xs opacity-40">{message.model_used}</p>
        )}
      </div>
    </div>
  );
}
