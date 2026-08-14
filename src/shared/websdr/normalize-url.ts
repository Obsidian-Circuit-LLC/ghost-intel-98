/**
 * WebSDR Viewer — receiver-URL validator (shared trust-boundary helper).
 *
 * Ported verbatim in behaviour from his `electron/main.ts` `normalizeUrl`: parse with the WHATWG
 * `URL` constructor and allow ONLY the `http:`/`https:` schemes. Every receiver URL passes through
 * here at the trust boundary — on save, load, status check, and external-open — so a hostile or
 * fat-fingered renderer value can never reach a `WebContentsView.loadURL`, `net.fetch`,
 * `shell.openExternal`, or a `new RegExp`/path builder as a `file:`, `javascript:`, `data:`, or
 * other dangerous scheme.
 *
 * Pure (no electron/node import) so it is reusable in the renderer (pre-validate before an IPC
 * round-trip) and testable without a runtime. Throws on any non-http(s) or unparseable input —
 * the caller decides how to surface the rejection.
 */

/** The only receiver schemes a WebSDR website is ever served over. */
const ALLOWED_WEBSDR_PROTOCOLS = ['http:', 'https:'] as const;

/**
 * Parse + validate a receiver URL, returning its normalized string form. Throws when the input
 * is not a string, is unparseable, or uses any scheme other than http/https.
 */
export function normalizeWebSdrUrl(url: unknown): string {
  if (typeof url !== 'string' || url.length === 0) {
    throw new Error('A receiver URL is required.');
  }
  // `new URL` throws on an unparseable value (relative path, bare word, control chars) — the same
  // parse his normalizeUrl relied on, so a path-injection string like `../../etc/passwd` never
  // parses to an absolute URL and is rejected here rather than reaching a path builder.
  const u = new URL(url);
  if (!(ALLOWED_WEBSDR_PROTOCOLS as readonly string[]).includes(u.protocol)) {
    throw new Error('Only http:// and https:// receiver URLs are allowed.');
  }
  return u.toString();
}
