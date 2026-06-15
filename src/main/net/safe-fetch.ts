/**
 * Shared egress-gated fetch. Follows redirects manually, re-validating every hop against the
 * public-URL guard (isPublicHttpUrl) AND the DNS-resolve guard (assertResolvedPublic), so an
 * external feed cannot 30x-redirect the request inward (SSRF / cloud metadata). Used by both the
 * persisted GeoINT sources (sources.ts) and the ephemeral threat-layer modules (threat-layers/).
 * Single home for the SSRF re-validation logic — do not duplicate it.
 */

import { isPublicHttpUrl, assertResolvedPublic } from '../security/validate';
import { FETCH_TIMEOUT_MS } from './limits';

export async function safeFetch(url: string, maxHops = 4, headers?: Record<string, string>): Promise<Response> {
  let current = url;
  for (let hop = 0; hop < maxHops; hop++) {
    if (!isPublicHttpUrl(current)) throw new Error('refusing to fetch a non-public URL');
    await assertResolvedPublic(new URL(current).hostname);
    const res = await fetch(current, { redirect: 'manual', headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
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
