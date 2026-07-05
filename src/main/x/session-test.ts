/**
 * Main-side X session (cookie-pair) validation.
 *
 * One authenticated GET to X's account/settings endpoint through the host-pinned, egress-gated
 * `safeFetch`, using the exact `auth_token`+`ct0` a user pasted. It answers the only question the
 * Add-session / Stored-sessions UI needs: are these cookies alive right now, and — if so — which
 * handle do they authenticate as? Bad or expired cookies surface here, at save/Test time, instead
 * of silently returning nothing when a harvest runs.
 *
 * Charter invariants:
 *  - NO cookie value is ever logged, echoed, or placed in a thrown error. `testSession` never
 *    throws — every failure (including a thrown/aborted fetch) is caught and mapped to a
 *    reason code, so there is no error path that could carry the secret out.
 *  - The response is UNTRUSTED. Only `screen_name` is read, and it is charset/length-guarded
 *    (`[A-Za-z0-9_]{1,15}`, X's own handle grammar) before it is returned for display.
 *  - Egress is confined to X hosts by `safeFetch` (SSRF re-validation on every redirect hop, and
 *    the Authorization/cookie headers are dropped the moment a hop leaves the original origin).
 *    This is a real clearnet request (same IP exposure as a collect), so the IPC layer gates it
 *    behind `x.networkEnabled` — this module is the mechanism, not the gate.
 *
 * The bearer below is the PUBLIC X web-app bearer — a well-known client constant, not a secret and
 * not user-specific. It is an X-controlled value that can rotate; if validation starts returning
 * `expired` for known-good cookies, this constant is the first thing to re-check.
 */

import { safeFetch } from '../net/safe-fetch';
import { readTextCapped } from '../net/limits';

/** Public X web-app bearer (client constant, not a secret). X-controlled — can rotate. */
export const X_WEB_BEARER =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

/** Authenticated whoami endpoint — returns the acting account's settings incl. `screen_name`. */
const X_SETTINGS_URL = 'https://api.x.com/1.1/account/settings.json';

/** Cap the untrusted settings body; it is a small JSON object, so a tight cap is plenty. */
const SETTINGS_MAX_BYTES = 256 * 1024;

export type SessionTestResult =
  | { valid: true; handle: string }
  | { valid: false; reason: 'expired' | 'rate-limited' | 'network' };

/**
 * Strip an untrusted `screen_name` to X's handle grammar: ASCII letters, digits, underscore, at
 * most 15 chars. Anything else (tags, whitespace, unicode) is dropped, so the value is safe to
 * render as an @handle. Returns '' when nothing usable remains.
 */
function sanitizeHandle(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[^A-Za-z0-9_]/g, '').slice(0, 15);
}

/**
 * Validate a cookie pair against X. Never throws; maps every outcome to a `SessionTestResult`.
 *
 *  - 200 + a usable `screen_name` → `{ valid:true, handle }`
 *  - 401 / 403                    → `{ valid:false, reason:'expired' }`
 *  - 429                          → `{ valid:false, reason:'rate-limited' }`
 *  - a throw/timeout, or any other/anomalous response (incl. a 200 with no usable handle)
 *                                 → `{ valid:false, reason:'network' }` (inconclusive)
 */
export async function testSession(creds: { authToken: string; ct0: string }): Promise<SessionTestResult> {
  const { authToken, ct0 } = creds;
  try {
    const res = await safeFetch(X_SETTINGS_URL, 2, {
      authorization: `Bearer ${X_WEB_BEARER}`,
      'x-csrf-token': ct0,
      cookie: `auth_token=${authToken}; ct0=${ct0}`,
    });

    if (res.status === 401 || res.status === 403) return { valid: false, reason: 'expired' };
    if (res.status === 429) return { valid: false, reason: 'rate-limited' };

    if (res.status === 200) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readTextCapped(res, SETTINGS_MAX_BYTES));
      } catch {
        // Authenticated but the body was unreadable/anomalous — inconclusive, let the user retry.
        return { valid: false, reason: 'network' };
      }
      const handle =
        parsed && typeof parsed === 'object'
          ? sanitizeHandle((parsed as Record<string, unknown>).screen_name)
          : '';
      if (handle) return { valid: true, handle };
      return { valid: false, reason: 'network' };
    }

    // Any other status (5xx, unexpected) is treated as an inconclusive transient failure.
    return { valid: false, reason: 'network' };
  } catch {
    // Thrown/aborted fetch. Swallow the error object entirely — it must never carry a cookie out.
    return { valid: false, reason: 'network' };
  }
}
