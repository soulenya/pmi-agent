import { useRef, useEffect, type KeyboardEvent, type FormEvent } from "react";
import { Send } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  onSend: (content: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function ChatInput({ onSend, disabled = false, placeholder }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Auto-grow the textarea
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  });

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function submit() {
    const value = ref.current?.value.trim();
    if (!value || disabled) return;
    onSend(value);
    if (ref.current) {
      ref.current.value = "";
      ref.current.style.height = "auto";
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    submit();
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-end gap-2 rounded-xl border bg-card p-3 shadow-sm"
    >
      <textarea
        ref={ref}
        rows={1}
        disabled={disabled}
        placeholder={placeholder ?? "Message PMI Agent… (Shift+Enter for new line)"}
        onKeyDown={handleKeyDown}
        className={cn(
          "flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground",
          disabled && "opacity-50 cursor-not-allowed",
        )}
      />
      <button
        type="submit"
        disabled={disabled}
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity",
          disabled && "opacity-40 cursor-not-allowed",
        )}
        aria-label="Send"
      >
        <Send className="h-4 w-4" />
      </button>
    </form>
  );
}
