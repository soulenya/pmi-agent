/**
 * External-link routing for the desktop (pywebview) window.
 *
 * Inside the embedded webview there is no browser chrome — no back, forward,
 * refresh, or address bar — so if a link to an external site navigates the main
 * window, the user is stranded on a page with no way back to Little Gerry.
 *
 * To avoid that, every click on a link that points to a real external site is
 * intercepted and opened in the user's real system browser instead. Links that
 * stay inside the app (the React UI on localhost and the local backend on
 * 127.0.0.1) are left untouched so in-app navigation and file downloads keep
 * working exactly as before.
 */

interface PyWebView {
  api?: {
    open_external?: (url: string) => unknown;
    save_file?: (filename: string, b64Data: string, openAfter: boolean) => unknown;
  };
}

declare global {
  interface Window {
    pywebview?: PyWebView;
  }
}

/** Hosts that belong to the app itself or its local backend — never redirected. */
function isInternalHost(host: string): boolean {
  return (
    host === window.location.hostname ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host === "::1"
  );
}

/** Open a URL in the user's real system browser. */
export function openExternal(url: string): void {
  // Prefer the native bridge exposed by the pywebview launcher — it reliably
  // hands the URL to the OS default browser regardless of webview backend.
  const open = window.pywebview?.api?.open_external;
  if (typeof open === "function") {
    try {
      open(url);
      return;
    } catch {
      /* fall through to window.open */
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/** True when running inside the pywebview desktop shell with a native file bridge. */
export function hasNativeSaveFile(): boolean {
  return typeof window.pywebview?.api?.save_file === "function";
}

/**
 * Save a file natively via the pywebview launcher bridge (Downloads folder),
 * optionally opening it afterward. Returns the saved path, or null if the
 * native bridge is unavailable or the save failed.
 *
 * The embedded webview does not honor `<a download>` / `window.open` for blob
 * URLs, so callers fetch the (authenticated) bytes themselves and pass them
 * here as a base64 string (a bare base64 payload or a full `data:` URL).
 */
export async function saveFileNative(
  filename: string,
  b64Data: string,
  openAfter: boolean,
): Promise<string | null> {
  const save = window.pywebview?.api?.save_file;
  if (typeof save !== "function") return null;
  try {
    const path = await save(filename, b64Data, openAfter);
    return typeof path === "string" && path ? path : null;
  } catch {
    return null;
  }
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

/**
 * Download a generated file (``/api/files/<name>``) with the user's session and
 * hand it to the OS: saved to Downloads and opened natively in the desktop app,
 * a plain browser download elsewhere. Used for every file link in chat, so the
 * app window itself never navigates to a backend URL — in the desktop shell
 * that replaced the whole app with the raw file and left no way back.
 */
export async function downloadGeneratedFile(name: string, openAfter = true): Promise<void> {
  const { fetchGeneratedFileBlob } = await import("../api/files");
  const blob = await fetchGeneratedFileBlob(name);
  if (hasNativeSaveFile()) {
    const saved = await saveFileNative(name, await blobToDataURL(blob), openAfter);
    if (saved) return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const FILES_PATH_RE = /^\/api\/files\/([^/]+)$/;

/**
 * Install a global, capture-phase click handler that routes external links to
 * the system browser. Safe to call once at startup in any environment; in a
 * plain browser it simply opens external links in a new tab.
 */
export function installExternalLinkHandler(): void {
  document.addEventListener(
    "click",
    (event) => {
      // Respect modifier clicks and non-primary buttons (let the OS/browser decide).
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const anchor = (event.target as Element | null)?.closest("a");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (!href) return;

      // Let download links and explicit non-navigations through unchanged
      // (except generated-file links, handled below: WKWebView ignores the
      // download attribute and would navigate).
      if (anchor.hasAttribute("download") && !/\/api\/files\//.test(href)) return;

      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return; // not a resolvable URL (e.g. "#", "javascript:")
      }

      // Only redirect real web links; leave mailto:, tel:, blob:, etc. alone.
      if (url.protocol !== "http:" && url.protocol !== "https:") return;

      // A link to a generated file (Gerry writes them as /api/files/<name>):
      // fetch it with the session and hand it to the OS. Navigating the window
      // there would show the raw file (or a 401) in place of the app.
      const fileMatch = isInternalHost(url.hostname) ? FILES_PATH_RE.exec(url.pathname) : null;
      if (fileMatch) {
        event.preventDefault();
        let name = fileMatch[1];
        try {
          name = decodeURIComponent(name);
        } catch {
          /* keep raw */
        }
        void downloadGeneratedFile(name, true).catch(() => {
          /* the card's own buttons report errors; a bare link fails quietly */
        });
        return;
      }

      // Keep app and local-backend navigation inside the window.
      if (isInternalHost(url.hostname)) return;

      event.preventDefault();
      openExternal(url.href);
    },
    true, // capture: run before React Router / other handlers
  );
}
