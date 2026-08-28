// @vitest-environment node
/**
 * Display pictures in the embedded station — the bug I shipped in v3.73.0.
 *
 * GhostExodus's model stores an avatar as the REMOTE URL his scraper read off the page
 * (`img[src*="profile_images"]` → `src`, e.g. https://pbs.twimg.com/profile_images/…). The v3.73.0
 * handler passed that value straight to `readCachedMedia`, whose first line is
 * `if (!MEDIA_REF_RE.test(ref)) return null` with `MEDIA_REF_RE = /^x-media\/[0-9a-f]{64}$/`. A
 * remote URL can never match, so EVERY avatar resolved to null and the station could not show a
 * display picture at all — by construction, on every machine.
 *
 * That is the sixth time this feature has failed, and the first time it was caused by preserving
 * his model correctly and then breaking the READ path by assuming our own ref format. So the fix is
 * pinned by tests that would have caught it: a remote URL must be localised through the app's
 * hardened media cache and then read back, and a value that is already a local ref must be read
 * directly without a fetch.
 *
 * The localisation is not optional politeness — the charter forbids inlining remote media, so the
 * bytes are fetched through the X session window (same Tor-gated partition, host-anchored to the
 * media allowlist), written to the encrypted cache, and the LOCAL ref is written back onto his
 * records so the fetch happens once.
 */
import { describe, expect, it, vi } from 'vitest';
import { resolveAvatarDataUri } from '../src/main/xls-embed/avatars';

const REMOTE = 'https://pbs.twimg.com/profile_images/1234567890/abcdef_400x400.jpg';
const LOCAL = 'x-media/' + 'a'.repeat(64);

function deps(over: Partial<Parameters<typeof resolveAvatarDataUri>[1]> = {}) {
  return {
    readCached: vi.fn(async (_caseId: string, ref: string) =>
      ref === LOCAL ? 'data:image/jpeg;base64,LOCALBYTES' : null
    ),
    cacheRemote: vi.fn(async () => ({ ref: LOCAL })),
    hasSession: vi.fn(() => true),
    ...over,
  };
}

describe('resolveAvatarDataUri', () => {
  it('reads a value that is already a local ref, with NO fetch', async () => {
    const d = deps();
    const uri = await resolveAvatarDataUri({ caseId: 'c1', ref: LOCAL }, d);
    expect(uri).toBe('data:image/jpeg;base64,LOCALBYTES');
    expect(d.cacheRemote).not.toHaveBeenCalled();
  });

  it('localises a REMOTE avatar URL and returns the cached bytes', async () => {
    // The v3.73.0 defect: this returned null for every avatar.
    const d = deps();
    const uri = await resolveAvatarDataUri({ caseId: 'c1', ref: REMOTE }, d);
    expect(d.cacheRemote).toHaveBeenCalledWith('c1', REMOTE);
    expect(uri).toBe('data:image/jpeg;base64,LOCALBYTES');
  });

  it('reports the local ref back so the fetch happens once', async () => {
    const d = deps();
    const seen: string[] = [];
    await resolveAvatarDataUri({ caseId: 'c1', ref: REMOTE, onLocalised: (r) => seen.push(r) }, d);
    expect(seen).toEqual([LOCAL]);
  });

  it('never fetches a host outside the media allowlist', async () => {
    const d = deps();
    const uri = await resolveAvatarDataUri({ caseId: 'c1', ref: 'https://evil.example.com/a.jpg' }, d);
    expect(uri).toBeNull();
    expect(d.cacheRemote).not.toHaveBeenCalled();
  });

  it('refuses non-http schemes outright', async () => {
    const d = deps();
    for (const bad of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'file:///etc/passwd']) {
      expect(await resolveAvatarDataUri({ caseId: 'c1', ref: bad }, d)).toBeNull();
    }
    expect(d.cacheRemote).not.toHaveBeenCalled();
  });

  it('does not fetch when there is no X session to fetch through', async () => {
    // No window means no Tor-gated partition to route through — fail closed, show a monogram.
    const d = deps({ hasSession: vi.fn(() => false) });
    expect(await resolveAvatarDataUri({ caseId: 'c1', ref: REMOTE }, d)).toBeNull();
    expect(d.cacheRemote).not.toHaveBeenCalled();
  });

  it('returns null rather than throwing when the fetch fails', async () => {
    const d = deps({ cacheRemote: vi.fn(async () => null) });
    expect(await resolveAvatarDataUri({ caseId: 'c1', ref: REMOTE }, d)).toBeNull();
  });

  it('is null for an empty or missing avatar', async () => {
    const d = deps();
    expect(await resolveAvatarDataUri({ caseId: 'c1', ref: '' }, d)).toBeNull();
    expect(await resolveAvatarDataUri({ caseId: 'c1', ref: undefined }, d)).toBeNull();
  });
});
