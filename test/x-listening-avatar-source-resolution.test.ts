/**
 * Port of his `avatarSourceForUsername` (`main.cjs:1445`).
 *
 * GhostExodus, after three failed display-pic releases: "I think Claude is still trying to recreate
 * it in its own environment and not integrating the app I already tested and triaged at length."
 * He was right. His app resolves an avatar URL for ANY handle from data it already holds —
 *
 *     profiles  →  relationships (network rows)  →  posts        (newest first within each)
 *
 * — because every captured post and every network row carries its author's avatar URL. Our port kept
 * only profile-header avatars, so an account that was merely MENTIONED had no source at all and could
 * only ever render a monogram. That is why fixing the *fetching* three times changed nothing: the
 * candidate list was empty before the fetcher ever ran.
 */
import { describe, it, expect } from 'vitest';
import { resolveAvatarCandidates } from '../src/main/x-listening/avatar-repair';

const A = (h: string) => `https://pbs.twimg.com/profile_images/1/${h}.jpg`;

describe('resolveAvatarCandidates', () => {
  it('resolves a handle seen ONLY in a captured post — the mentioned-account case', () => {
    const out = resolveAvatarCandidates({
      profiles: [],
      networkAccounts: [],
      posts: [{ username: 'nicoleeggert', avatar: A('nicole'), observedAt: '2026-08-01' }],
    });
    expect(out).toEqual([{ handle: 'nicoleeggert', sourceUrl: A('nicole') }]);
  });

  it('prefers a profile-header avatar over a network row over a post (his precedence)', () => {
    const out = resolveAvatarCandidates({
      profiles: [{ username: 'target', avatar: A('from-profile'), observedAt: '2026-08-01' }],
      networkAccounts: [{ username: 'target', avatar: A('from-network'), observedAt: '2026-08-02' }],
      posts: [{ username: 'target', avatar: A('from-post'), observedAt: '2026-08-03' }],
    });
    expect(out).toEqual([{ handle: 'target', sourceUrl: A('from-profile') }]);
  });

  it('within a tier, the NEWEST observation wins', () => {
    const out = resolveAvatarCandidates({
      profiles: [],
      networkAccounts: [],
      posts: [
        { username: 'x', avatar: A('old'), observedAt: '2026-08-01' },
        { username: 'x', avatar: A('new'), observedAt: '2026-08-09' },
      ],
    });
    expect(out[0]!.sourceUrl).toBe(A('new'));
  });

  it('falls through a tier that has no usable URL', () => {
    const out = resolveAvatarCandidates({
      profiles: [{ username: 'y', avatar: '', observedAt: '2026-08-01' }],
      networkAccounts: [],
      posts: [{ username: 'y', avatar: A('post'), observedAt: '2026-08-02' }],
    });
    expect(out[0]!.sourceUrl).toBe(A('post'));
  });

  it('canonicalises handles so one account is one candidate, not three', () => {
    const out = resolveAvatarCandidates({
      profiles: [],
      networkAccounts: [{ username: '@Target', avatar: A('n'), observedAt: '2026-08-02' }],
      posts: [{ username: 'target', avatar: A('p'), observedAt: '2026-08-03' }],
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.handle).toBe('target');
  });

  it('drops off-host and non-http avatar URLs rather than queueing a fetch for them', () => {
    const out = resolveAvatarCandidates({
      profiles: [],
      networkAccounts: [],
      posts: [
        { username: 'a', avatar: 'https://evil.example/profile_images/x.jpg', observedAt: '1' },
        { username: 'b', avatar: 'javascript:alert(1)', observedAt: '1' },
        { username: 'c', avatar: A('ok'), observedAt: '1' },
      ],
    });
    expect(out.map((c) => c.handle)).toEqual(['c']);
  });

  it('drops handles that are not valid X handles', () => {
    const out = resolveAvatarCandidates({
      profiles: [],
      networkAccounts: [],
      posts: [
        { username: 'not a handle', avatar: A('x'), observedAt: '1' },
        { username: 'waytoolongforahandle12', avatar: A('x'), observedAt: '1' },
        { username: 'fine_1', avatar: A('ok'), observedAt: '1' },
      ],
    });
    expect(out.map((c) => c.handle)).toEqual(['fine_1']);
  });

  it('returns nothing when nothing has been captured yet', () => {
    expect(resolveAvatarCandidates({ profiles: [], networkAccounts: [], posts: [] })).toEqual([]);
  });
});
