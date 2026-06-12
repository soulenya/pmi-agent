/**
 * Platform detection for the embedded webview / browser.
 * Used to show the right modifier-key glyphs (⌘ on macOS, Ctrl elsewhere)
 * and to accept Cmd as the shortcut modifier on Macs.
 */
export const isMac: boolean =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(
    // userAgentData.platform where available, falling back to navigator.platform
    (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ??
      navigator.platform ??
      "",
  );

/** Display label for the primary modifier key, e.g. "⌘K" / "Ctrl+K". */
export function modLabel(key: string): string {
  return isMac ? `⌘${key}` : `Ctrl+${key}`;
}

/** True when the platform's primary modifier (Cmd on Mac, Ctrl elsewhere) is held. */
export function isModKey(e: KeyboardEvent | { ctrlKey: boolean; metaKey: boolean }): boolean {
  return isMac ? e.metaKey : e.ctrlKey;
}
