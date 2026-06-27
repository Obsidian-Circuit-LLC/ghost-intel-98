/**
 * Scheme-guard: returns a safe href for http/https URLs, null for everything else
 * (javascript:, data:, file:, vbscript:, malformed). The sole XSS choke-point for
 * URL rendering in the SOCMINT module — callers render null as plain text, no anchor.
 */
export function safeHref(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    // Reject userinfo (e.g. http://display@real-host/) — a harvested permalink could
    // otherwise render a host-spoofed anchor that misleads an analyst about its target.
    if (u.username || u.password) return null;
    return u.href;
  } catch {
    return null;
  }
}
