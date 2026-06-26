/**
 * Scheme-guard: returns a safe href for http/https URLs, null for everything else
 * (javascript:, data:, file:, vbscript:, malformed). The sole XSS choke-point for
 * URL rendering in the SOCMINT module — callers render null as plain text, no anchor.
 */
export function safeHref(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
    return null;
  } catch {
    return null;
  }
}
