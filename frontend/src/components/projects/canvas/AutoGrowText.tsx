/**
 * A textarea that reports the height its text wants.
 *
 * Uncontrolled on purpose: a controlled value fights the caret when the board
 * refetches mid-sentence. New text from the server is only taken while the
 * field is not the one being typed in.
 *
 * Two modes, like any whiteboard: at rest a press-and-drag on the text moves
 * the card, and a double-click enters the text. While the text is entered the
 * field carries React Flow's `nodrag` class, so a drag selects characters
 * instead of moving the card; leaving the field (blur, Escape) returns it to
 * the card.
 */

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
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
  const [entered, setEntered] = useState(autoFocus);

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

  const enter = () => {
    if (readOnly) return;
    setEntered(true);
    // The two presses of the double-click were kept from focusing the field;
    // focus it now with a collapsed caret. Not select-all: dragging across
    // selected text starts a native text drag instead of a new selection.
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  };

  return (
    <textarea
      ref={ref}
      defaultValue={value}
      readOnly={readOnly || !entered}
      tabIndex={entered ? 0 : -1}
      placeholder={placeholder}
      onInput={measure}
      onMouseDown={(e) => {
        // At rest the press belongs to the card (React Flow drags it); no
        // focus, no caret, no half-selection under the drag.
        if (!entered) e.preventDefault();
      }}
      onDoubleClick={(e) => {
        if (entered || readOnly) return;
        e.stopPropagation();
        enter();
      }}
      onBlur={(e) => {
        if (!readOnly && e.target.value !== value) onCommit(e.target.value);
        setEntered(false);
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
        // React Flow's node wrapper is user-select:none; say so explicitly the other way when entered.
        entered ? "nodrag cursor-text select-text" : "cursor-default select-none",
        className,
      )}
      style={style}
    />
  );
}
