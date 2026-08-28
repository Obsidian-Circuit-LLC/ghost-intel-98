// @vitest-environment node
/**
 * Carrying GhostExodus's existing campaigns into the embedded station.
 *
 * THE SECOND v3.73.0 DEFECT. The embed keeps his single state document at a NEW path and reads
 * nothing from `scrapingCaseDir('x', …)`, where every campaign, post, follower network and note
 * collected up to v3.72.8 actually lives. Nothing was deleted — but on upgrading he opens the
 * station to a fresh "Primary Campaign" with nothing in it, which from where he is sitting is
 * indistinguishable from having lost the lot.
 *
 * So the document is built ONCE from the old stores on first run. The mapping is asserted field by
 * field here because a migration that silently mis-maps is worse than none: it would look like it
 * worked and quietly corrupt his evidence set.
 *
 * Rules this pins:
 *   - it runs ONLY when there is no document yet (never overwrites a live one)
 *   - a campaign with no posts still comes across — an empty campaign is data too
 *   - his TARGET SOURCES are reconstructed from the sources posts were collected FROM
 *     (`channelId`), never from a post's author, which on a reply/repost is a third party
 *   - what cannot be mapped is COUNTED and reported, never dropped in silence
 */
import { describe, expect, it, vi } from 'vitest';
import { migrateLegacyStation, type LegacyReader } from '../src/main/xls-embed/migrate';

const NOW = '2026-08-28T12:00:00.000Z';
let n = 0;
const ctx = { now: () => NOW, makeId: () => `id-${++n}` };

function legacy(over: Partial<LegacyReader> = {}): LegacyReader {
  return {
    listCampaigns: vi.fn(async () => [
      { id: 'camp-1', name: 'Operation Midnight', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z' },
    ]),
    readPosts: vi.fn(async () => [
      {
        id: 'p1', channelId: 'darkwebtoday', channelLabel: '@darkwebtoday', authorHandle: 'darkwebtoday',
        displayName: 'Dark Web Today', avatar: 'https://pbs.twimg.com/profile_images/1/a.jpg',
        text: 'hello', url: 'https://x.com/darkwebtoday/status/1',
        publishedAt: '2026-08-01T10:00:00.000Z', harvestedAt: '2026-08-01T11:00:00.000Z',
        kind: 'post', parentPostId: null, metrics: { replies: 1, reposts: 2, likes: 3, views: 4 },
        evidenceHash: 'abc', mediaRefs: ['x-media/' + 'b'.repeat(64)],
      },
    ]),
    readNetworks: vi.fn(async () => [
      {
        target: 'darkwebtoday', kind: 'followers', capturedAt: '2026-08-03T00:00:00.000Z',
        accounts: [{ handle: 'alice', displayName: 'Alice', bio: 'bio', avatar: 'https://pbs.twimg.com/profile_images/2/b.jpg' }],
      },
    ]),
    readNotes: vi.fn(async () => [{ id: 'n1', findingId: 'p1', text: 'a note', savedAt: '2026-08-04T00:00:00.000Z' }]),
    ...over,
  } as LegacyReader;
}

describe('migrateLegacyStation', () => {
  it('brings his campaigns across as his campaign records', async () => {
    const s = await migrateLegacyStation(legacy(), ctx);
    expect(s).not.toBeNull();
    expect(s!.state.cases).toHaveLength(1);
    expect(s!.state.cases[0]).toMatchObject({
      id: 'camp-1',
      name: 'Operation Midnight',
      createdAt: '2026-08-01T00:00:00.000Z',
    });
    // The migrated campaign is the active one, so the station opens on his data.
    expect(s!.state.activeCaseId).toBe('camp-1');
    expect(s!.state.schemaVersion).toBe(9);
  });

  it('maps a post field by field into his shape', async () => {
    const s = await migrateLegacyStation(legacy(), ctx);
    const post = s!.state.posts[0];
    expect(post).toMatchObject({
      id: 'p1',
      caseId: 'camp-1',
      username: 'darkwebtoday',
      displayName: 'Dark Web Today',
      sourceUsername: 'darkwebtoday',
      url: 'https://x.com/darkwebtoday/status/1',
      text: 'hello',
      createdAt: '2026-08-01T10:00:00.000Z',   // his createdAt is the PUBLISH time
      collectedAt: '2026-08-01T11:00:00.000Z', // …and collectedAt is when we harvested it
      kind: 'post',
      isReply: false,
      parentPostId: null,
      evidenceHash: 'abc',
    });
    expect(post.metrics).toEqual({ replies: 1, reposts: 2, likes: 3, views: 4 });
    // Local media refs carry over as his `media` array.
    expect(post.media).toEqual(['x-media/' + 'b'.repeat(64)]);
    // The avatar travels ON the post, which is his model (and what the v3.73.1 read path expects).
    expect(post.avatar).toBe('https://pbs.twimg.com/profile_images/1/a.jpg');
    // Every post is attached to a reconstructed profile.
    expect(post.profileId).toBeTruthy();
  });

  it('reconstructs TARGET SOURCES from the collection source, not the post author', async () => {
    // On a reply or repost the author is a third party. Deriving sources from authorHandle is the
    // exact contamination bug the v3.71.0 scheduler review caught; it must not come back here.
    const l = legacy({
      readPosts: vi.fn(async () => [
        { id: 'p1', channelId: 'darkwebtoday', authorHandle: 'some_random_commenter', text: 't',
          url: 'u', publishedAt: NOW, harvestedAt: NOW, kind: 'comment', parentPostId: null,
          metrics: { replies: 0, reposts: 0, likes: 0, views: 0 } },
      ]) as never,
    });
    const s = await migrateLegacyStation(l, ctx);
    expect(s!.state.profiles.map((p) => p.username)).toEqual(['darkwebtoday']);
  });

  it('maps a follower network into his relationship rows', async () => {
    const s = await migrateLegacyStation(legacy(), ctx);
    expect(s!.state.relationships).toHaveLength(1);
    expect(s!.state.relationships[0]).toMatchObject({
      caseId: 'camp-1',
      sourceUsername: 'darkwebtoday',
      relationship: 'follower', // his singular form, not the artifact's plural 'followers'
      username: 'alice',
      displayName: 'Alice',
      bio: 'bio',
    });
    expect(s!.state.relationships[0].url).toBe('https://x.com/alice');
  });

  it('brings notes across attached to their post', async () => {
    const s = await migrateLegacyStation(legacy(), ctx);
    expect(s!.state.notes[0]).toMatchObject({ caseId: 'camp-1', postId: 'p1', text: 'a note' });
  });

  it('keeps a campaign that has nothing in it yet', async () => {
    const l = legacy({
      readPosts: vi.fn(async () => []),
      readNetworks: vi.fn(async () => []),
      readNotes: vi.fn(async () => []),
    });
    const s = await migrateLegacyStation(l, ctx);
    expect(s!.state.cases).toHaveLength(1);
    expect(s!.state.posts).toHaveLength(0);
  });

  it('is null when there is nothing to migrate, so first run is a clean default', async () => {
    const l = legacy({ listCampaigns: vi.fn(async () => []) });
    expect(await migrateLegacyStation(l, ctx)).toBeNull();
  });

  it('counts what it could not read instead of failing or silently dropping it', async () => {
    const l = legacy({
      listCampaigns: vi.fn(async () => [
        { id: 'ok', name: 'Fine' },
        { id: 'bad', name: 'Unreadable' },
      ]),
      readPosts: vi.fn(async (id: string) => {
        if (id === 'bad') throw new Error('EDECRYPT');
        return [];
      }) as never,
    });
    const s = await migrateLegacyStation(l, ctx);
    // The readable campaign still comes across…
    expect(s!.state.cases.map((c) => c.name)).toContain('Fine');
    // …and the failure is reported rather than hidden.
    expect(s!.skipped).toContainEqual(expect.objectContaining({ campaign: 'Unreadable' }));
  });
});
