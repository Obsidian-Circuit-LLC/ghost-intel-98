/**
 * X Listening Station — entity display pics (backend lookup).
 *
 * GhostExodus: "its not pulling display pics from entities". His Enterprise ENTITY INDEX shows an
 * avatar on every MENTION entity + small avatar chips for each finding's source. Rebuilt onto the
 * hardened seams as a CACHE-ONLY lookup: `buildAvatarLookup` reads back the per-campaign avatar
 * cache (the repair ledger `x-avatar-cache.json`, populated by the Tor-gated host-anchored repair
 * pass) into a `{ canonicalHandle → LOCAL data: URI }` map — the hardened analog of Enterprise's
 * `avatarLookup`/`avatarFor`.
 *
 * HARDENING the lookup preserves BY CONSTRUCTION:
 *   - it has NO window / NO network / NO `cacheRemoteMedia` seam — displaying an entity can never
 *     trigger a remote fetch (so a synthetic entity, like any other, triggers nothing);
 *   - every value it can emit is a LOCAL `data:` URI (via `readCachedMedia`, ref-shape-validated) —
 *     never a remote URL in the map, so never in the DOM.
 *
 * These tests drive it entirely through injected read seams (no electron/network/secure-fs).
 */
import { describe, it, expect, vi } from 'vitest';
import { buildAvatarLookup } from '../src/main/x-listening/avatar-repair';

const CASE = '33333333-3333-4333-8333-333333333333';
const REF = (h: string) => `x-media/${'a'.repeat(63)}${h.length % 10}`;
const DATA_URI = (h: string) => `data:image/png;base64,${Buffer.from(h).toString('base64')}`;

/** A raw persisted avatar-cache object as `x-avatar-cache.json` holds it: canonical handle → entry. */
function cache(entries: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [handle, ref] of Object.entries(entries)) {
    out[handle] = { ref, sha256: 'f'.repeat(64), sourceUrl: `https://pbs.twimg.com/${handle}.jpg`, cachedAt: '2026-08-01T00:00:00.000Z' };
  }
  return out;
}

describe('X Listening entity display pics — buildAvatarLookup (cache-only, local refs)', () => {
  it('maps each cached handle to its LOCAL data: URI (read back per ref)', async () => {
    const readCache = vi.fn(async () => cache({ danielhill: REF('danielhill'), alice: REF('alice') }));
    const readMedia = vi.fn(async (_id: string, ref: string) => DATA_URI(ref));

    const lookup = await buildAvatarLookup(CASE, { readCache, readMedia });

    expect(lookup.danielhill).toBe(DATA_URI(REF('danielhill')));
    expect(lookup.alice).toBe(DATA_URI(REF('alice')));
    // Read back through the ref-validating readCachedMedia seam, keyed by caseId + the cached ref.
    expect(readMedia).toHaveBeenCalledWith(CASE, REF('danielhill'));
    expect(readMedia).toHaveBeenCalledWith(CASE, REF('alice'));
  });

  it('emits ONLY local data: URIs — never a remote URL (the no-remote-media-in-DOM invariant)', async () => {
    const readCache = vi.fn(async () => cache({ bob: REF('bob') }));
    const readMedia = vi.fn(async (_id: string, ref: string) => DATA_URI(ref));

    const lookup = await buildAvatarLookup(CASE, { readCache, readMedia });

    for (const v of Object.values(lookup)) {
      expect(v.startsWith('data:')).toBe(true);
      expect(v.startsWith('http')).toBe(false);
    }
  });

  it('normalizes cache keys to canonical handles (@/case-folded) so entity/source handles resolve', async () => {
    const readCache = vi.fn(async (): Promise<Record<string, unknown>> => cache({ '@DanielHill': REF('x') }));
    const readMedia = vi.fn(async (_id: string, ref: string) => DATA_URI(ref));

    const lookup = await buildAvatarLookup(CASE, { readCache, readMedia });

    expect(lookup.danielhill).toBe(DATA_URI(REF('x')));
    expect(lookup['@DanielHill']).toBeUndefined();
  });

  it('omits a handle whose read-back misses (regenerable display artifact — a miss, not a fault)', async () => {
    const readCache = vi.fn(async () => cache({ present: REF('present'), gone: REF('gone') }));
    const readMedia = vi.fn(async (_id: string, ref: string) => (ref === REF('gone') ? null : DATA_URI(ref)));

    const lookup = await buildAvatarLookup(CASE, { readCache, readMedia });

    expect(lookup.present).toBe(DATA_URI(REF('present')));
    expect('gone' in lookup).toBe(false);
  });

  it('an absent/empty cache yields an empty map without a single read-back or a throw (no egress)', async () => {
    const readMedia = vi.fn(async () => DATA_URI('unused'));

    await expect(buildAvatarLookup(CASE, { readCache: async () => null, readMedia })).resolves.toEqual({});
    expect(readMedia).not.toHaveBeenCalled();
  });
});
