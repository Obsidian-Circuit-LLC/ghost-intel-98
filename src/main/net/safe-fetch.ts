/**
 * Shared egress-gated fetch. Follows redirects manually, re-validating every hop against the
 * public-URL guard (isPublicHttpUrl) AND the DNS-resolve guard (assertResolvedPublic), so an
 * external feed cannot 30x-redirect the request inward (SSRF / cloud metadata). Used by both the
 * persisted GeoINT sources (sources.ts) and the ephemeral threat-layer modules (threat-layers/).
 * Single home for the SSRF re-validation logic — do not duplicate it.
 */

import { isPublicHttpUrl, assertResolvedPublic } from '../security/validate';
import { FETCH_TIMEOUT_MS } from './limits';

/** Header names that are safe to forward across an origin change. Everything else (notably
 *  Authorization and the keyed-layer x-ucdp-access-token / gdeltcloud bearer) is dropped the moment
 *  a redirect lands on a different scheme/host/port than the ORIGINAL request — otherwise a 30x to
 *  an attacker host would re-send the caller's credentials to that host. Compared case-insensitively. */
const CROSS_ORIGIN_SAFE_HEADERS = new Set(['accept', 'accept-language', 'user-agent']);

function stripCrossOriginHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  for (const [k, v] of Object.entries(headers)) {
    if (CROSS_ORIGIN_SAFE_HEADERS.has(k.toLowerCase())) out[k] = v;
  }
  return out;
}

export async function safeFetch(url: string, maxHops = 4, headers?: Record<string, string>): Promise<Response> {
  let current = url;
  // Origin of the ORIGINAL request. Any hop whose origin differs from this drops sensitive headers.
  const originalOrigin = new URL(url).origin;
  for (let hop = 0; hop < maxHops; hop++) {
    if (!isPublicHttpUrl(current)) throw new Error('refusing to fetch a non-public URL');
    await assertResolvedPublic(new URL(current).hostname);
    // Same origin (scheme+host+port) as hop 0 → all headers; cross-origin → only the safe subset.
    const hopHeaders = new URL(current).origin === originalOrigin ? headers : stripCrossOriginHeaders(headers);
    const res = await fetch(current, { redirect: 'manual', headers: hopHeaders, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return res;
      current = new URL(loc, current).toString();
      continue;
    }
    return res;
  }
  throw new Error('too many redirects');
}
