/**
 * Shared security primitives for the capture stack (Plan A, Task F2).
 *
 * These are the small, pure(-ish) guards the X Listening Station — and, in
 * Plan B, Telegram Hunter — lean on at every trust boundary between scraped,
 * attacker-controlled content and the app: outbound link opening, CSV/HTML
 * export emission, and remote-media capture.
 *
 * CLEARNET-QUARANTINE NOTE: this module imports only `node:path`. It pulls in
 * NOTHING from `bgconn`/Tor/socks/`socmint`/`telegram`; the import-graph
 * sentinel depends on that staying true.
 *
 * The `csvCell` guard is ported from quarantine `electron/main.cjs:1130`, but
 * with the spreadsheet formula-injection prefix ADDED — the review flagged the
 * original as neutralizing interior quotes only, leaving a scraped bio like
 * `=HYPERLINK("http://evil")` free to execute when the CSV is opened in Excel
 * or Sheets. `escapeField` mirrors the quarantine `escapeHtml` at `main.cjs:896`.
 */

/** Structural shape of a capture page we can run static JS in. Electron's
 *  `BrowserWindow` is assignable to this; tests supply a minimal fake. */
export interface MediaCapturePage {
  webContents: {
    executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
  };
}

/**
 * Returns `u` iff it parses to an `http:`/`https:` URL, else `null`. The gate
 * for anything that will be handed to the app's scheme-guarded external opener:
 * a scraped href can be `javascript:`, `file:`, `data:`, or garbage, and none of
 * those may ever reach a navigation or an opener.
 */
export function guardExternalUrl(u: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    return null;
  }
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    return u;
  }
  return null;
}

/**
 * Hosts a captured media URL may be fetched from — X's own media/CDN + site
 * hosts only. `guardExternalUrl` alone admits any http(s) host, so a hostile X
 * DOM with `img[src*="profile_images"]` pointing at an arbitrary host would make
 * the capture page fetch it and beacon the analyst's real IP to the observed
 * account. This allowlist is enforced BEFORE any in-page fetch to close that
 * deanon vector. A subdomain of an allowed host is also permitted.
 */
const MEDIA_HOST_ALLOWLIST = ['pbs.twimg.com', 'abs.twimg.com', 'x.com', 'twitter.com'];

/** True iff `host` is an allowlisted media host exactly, or a subdomain of one. */
function mediaHostAllowed(host: string): boolean {
  const h = host.toLowerCase();
  return MEDIA_HOST_ALLOWLIST.some((allowed) => h === allowed || h.endsWith(`.${allowed}`));
}

/** Lead chars a spreadsheet may interpret as the start of a formula. */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * Emit `v` as a single quoted CSV cell, formula-injection safe. A value whose
 * first character could be read as a formula (`= + - @`, tab, CR) is prefixed
 * with a `'` so the spreadsheet treats it as literal text; interior double
 * quotes are doubled and the whole cell is wrapped in quotes (RFC-4180).
 */
export function csvCell(v: string): string {
  const text = String(v ?? '');
  const guarded = FORMULA_LEAD.test(text) ? `'${text}` : text;
  return `"${guarded.replaceAll('"', '""')}"`;
}

/**
 * HTML-escape `& < > " '` for safe interpolation into an exported HTML/PDF
 * document. `&` is escaped first so the entities this function introduces are
 * not themselves re-escaped.
 */
export function escapeField(v: string): string {
  return String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/**
 * Fetch a remote media URL from INSIDE the capture page and return it as a
 * `data:` URI, or `null` on any failure. The URL is scheme-guarded first, then
 * JSON-encoded into the static fetch script (never raw-interpolated), and the
 * result is admitted only if it is actually a `data:` string — so a hostile
 * page can never make this return a remote `http(s)` URL that would later reach
 * an `<img src>` and beacon the analyst's view back to the observed account.
 */
export async function remoteMediaToDataUri(
  win: MediaCapturePage,
  url: string
): Promise<string | null> {
  const safe = guardExternalUrl(url);
  if (!safe) return null;

  // Enforce the media HOST allowlist BEFORE any fetch — a scraped media URL
  // pointing off X's own hosts is a real-IP deanon beacon and is refused here,
  // before the capture page ever issues a request.
  let host: string;
  try {
    host = new URL(safe).hostname;
  } catch {
    return null;
  }
  if (!mediaHostAllowed(host)) return null;

  // Static payload: the ONLY dynamic part is a JSON-encoded string literal, so
  // the scraped URL cannot break out of the string and inject code.
  const js = `(async () => {
    try {
      const resp = await fetch(${JSON.stringify(safe)}, { credentials: 'omit' });
      if (!resp || !resp.ok) return null;
      const blob = await resp.blob();
      if (!blob || !String(blob.type || '').startsWith('image/')) return null;
      if (blob.size > 5 * 1024 * 1024) return null;
      return await new Promise((res) => {
        const reader = new FileReader();
        reader.onloadend = () => res(typeof reader.result === 'string' ? reader.result : null);
        reader.onerror = () => res(null);
        reader.readAsDataURL(blob);
      });
    } catch (_e) {
      return null;
    }
  })()`;

  let result: unknown;
  try {
    result = await win.webContents.executeJavaScript(js, true);
  } catch {
    return null;
  }
  if (typeof result === 'string' && result.startsWith('data:')) {
    return result;
  }
  return null;
}
