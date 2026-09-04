/**
 * A textarea that reports the height its text wants.
 *
 * Uncontrolled on purpose: a controlled value fights the caret when the board
 * refetches mid-sentence. New text from the server is only taken while the
 * field is not the one being typed in.
 */

import { useEffect, useLayoutEffect, useRef, type CSSProperties } from "react";
import { cn } from "@/lib/utils";

interface Props {
  value: string;
  readOnly?: boolean;
  /** Report the height the text needs. Omit to leave the box alone. */
  onHeight?: (height: number) => void;
  onCommit: (text: string) => void;
  onDone?: () => void;
  autoFocus?: boolean;
  placeholder?: string;
  className?: string;
  style?: CSSProperties;
}

export function AutoGrowText({
  value,
  readOnly = false,
  onHeight,
  onCommit,
  onDone,
  autoFocus = false,
  placeholder,
  className,
  style,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const measure = () => {
    const el = ref.current;
    if (!el || !onHeight) return;
    const held = el.style.height;
    el.style.height = "0px";
    const needed = el.scrollHeight;
    el.style.height = held;
    onHeight(needed);
  };

  useLayoutEffect(measure);

  useEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el && el.value !== value) el.value = value;
  }, [value]);

  useEffect(() => {
    if (!autoFocus) return;
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [autoFocus]);

  return (
    <textarea
      ref={ref}
      defaultValue={value}
      readOnly={readOnly}
      placeholder={placeholder}
      onInput={measure}
      onBlur={(e) => {
        if (!readOnly && e.target.value !== value) onCommit(e.target.value);
        onDone?.();
      }}
      onKeyDown={(e) => {
        // Keep Backspace, Delete and the tool keys away from the board.
        e.stopPropagation();
        if (e.key === "Escape") e.currentTarget.blur();
      }}
      className={cn(
        "w-full resize-none border-0 bg-transparent p-0 outline-none",
        onHeight ? "overflow-hidden" : "overflow-auto",
        className,
      )}
      style={style}
    />
  );
}
