/**
 * Ghost Social Media Manager (hardened GI98 port) — URL trust-boundary helpers.
 *
 * His `electron/main.ts` drove `WebContentsView.loadURL`, `shell.openExternal`, and `favicon:fetch`
 * from raw renderer/remote-page strings with NO scheme validation (Global Constraints #4/#5/#6).
 * These pure helpers gate every such string at the boundary: only `http:`/`https:` ever passes, and
 * `sameSite` decides whether a popup URL may drive the authenticated account view in place (his
 * `setWindowOpenHandler` did `loadURL(anyUrl)`) or must be handed to the system browser instead.
 *
 * Pure — no electron/node import — so both the main view-manager and the Phase-4 renderer can
 * pre-validate without a runtime, and every branch is unit-testable.
 */

/** The only schemes an authenticated social page is ever served/opened over. */
const ALLOWED_PROTOCOLS = ['http:', 'https:'] as const;

/**
 * Parse + validate a social URL, returning its normalized string. Throws when the input is not a
 * string, is unparseable (a bare word / relative path / control chars never becomes an absolute
 * URL), or uses any scheme other than http/https — so a `file:`/`javascript:`/`data:` string can
 * never reach `loadURL`, `openExternal`, or a favicon fetch.
 */
export function normalizeSocialUrl(url: unknown): string {
  if (typeof url !== 'string' || url.length === 0) {
    throw new Error('A URL is required.');
  }
  const u = new URL(url);
  if (!(ALLOWED_PROTOCOLS as readonly string[]).includes(u.protocol)) {
    throw new Error('Only http:// and https:// URLs are allowed.');
  }
  return u.toString();
}

/** The lowercased host (with port) of a parseable http(s) URL, or `null` for anything else. Used to
 *  anchor the favicon fetch and to seed the known-account-host registry. */
export function hostOfUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * The registrable-ish base domain of a hostname: its last two labels (e.g. `www.facebook.com` and
 * `m.facebook.com` → `facebook.com`). A deliberately simple heuristic — every platform host this
 * module targets (facebook.com, x.com, instagram.com, tiktok.com, linkedin.com, youtube.com,
 * bsky.app, messenger.com) is a plain two-label domain, so it collapses their subdomains correctly.
 * It is NOT a public-suffix parser; `sameSite` fails SAFE regardless (see below).
 */
export function baseDomain(hostname: string): string {
  const parts = hostname.toLowerCase().split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  return parts.slice(-2).join('.');
}

/**
 * Whether a candidate URL is "same site" as the account view's current page — used ONLY to decide
 * whether a denied popup navigates the view in place (same registrable domain) or is opened in the
 * system browser instead (off-site). Fails SAFE: an off-site verdict routes to `openExternal`
 * (never into the authenticated view), so even an imperfect base-domain match cannot smuggle a
 * cross-site URL into the logged-in session — the worst case of a false "same-site" is a URL that
 * genuinely shares the account's registrable domain.
 */
export function sameSite(candidateHost: string, accountHost: string): boolean {
  if (!candidateHost || !accountHost) return false;
  return baseDomain(candidateHost) === baseDomain(accountHost);
}
