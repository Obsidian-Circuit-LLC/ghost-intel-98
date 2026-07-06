/**
 * True if `value` parses as a URL whose host is a Tor onion service (`*.onion`). Used by the SearXNG
 * instance settings editor (renderer) to warn the operator BEFORE the main process fail-closes a
 * non-onion endpoint — the SearXNG engine only ever fetches `.onion` hosts (`searxng.ts`), so a
 * clearnet value silently yields `bad-endpoint`/no results rather than an IP-leaking clearnet fetch.
 * Scheme-agnostic (http/https), case-insensitive on the host, whitespace-trimmed; parses via the
 * same `new URL(...)` main uses, so the UI's verdict matches main's enforcement.
 */
export function isOnionUrl(value: string): boolean {
  try {
    return new URL(value.trim()).hostname.toLowerCase().endsWith('.onion');
  } catch {
    return false;
  }
}
