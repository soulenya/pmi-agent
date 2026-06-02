import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { cn } from "@/lib/utils";
import type { Message } from "@/types/chat";
import { Bot, User, ChevronDown, ChevronRight, Wrench } from "lucide-react";

// Import a highlight.js theme (dark-compatible)
import "highlight.js/styles/github-dark.css";

interface Props {
  message: Message;
}

function ToolCallsSection({ toolCalls }: { toolCalls: unknown[] }) {
  const [open, setOpen] = useState(false);
  if (!toolCalls || toolCalls.length === 0) return null;

  const names: string[] = toolCalls.map((tc) => {
    const t = tc as Record<string, unknown>;
    const fn = t.function as Record<string, unknown> | undefined;
    return (fn?.name as string) ?? "tool";
  });

  return (
    <div className="mt-2 border-t border-white/10 pt-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs opacity-50 hover:opacity-80 transition-opacity"
      >
        <Wrench className="h-3 w-3" />
        <span>{names.length} tool{names.length > 1 ? "s" : ""} used</span>
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      </button>
      {open && (
        <ul className="mt-1 space-y-0.5">
          {names.map((name, i) => (
            <li key={i} className="text-xs opacity-50 font-mono pl-2">
              {name.replace(/_/g, " ")}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
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
        {isAssistant ? (
          <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-headings:mb-1 prose-headings:mt-2 prose-pre:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        ) : (
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        )}

        {/* Tool calls (persisted) */}
        {isAssistant && message.tool_calls && message.tool_calls.length > 0 && (
          <ToolCallsSection toolCalls={message.tool_calls} />
        )}

        {/* Citations */}
        {isAssistant && message.cited_chunk_ids && message.cited_chunk_ids.length > 0 && (
          <p className="mt-1 text-xs opacity-60">
            {message.cited_chunk_ids.length} source
            {message.cited_chunk_ids.length > 1 ? "s" : ""} cited
          </p>
        )}

        {/* Model label */}
        {isAssistant && message.model_name && (
          <p className="mt-0.5 text-xs opacity-40">{message.model_name}</p>
        )}
      </div>
    </div>
  );
}
