/**
 * Task D1 — `removeSource` cascade (Target Sources REMOVE).
 *
 * A source is DERIVED from captured posts (no persisted profile record), so removal is a
 * read-filter-write over the `posts` + `networks` sidecars — same primitive `removeNote`/
 * `removePreset` use. These tests pin the filter behaviour (match on channelId||authorHandle and
 * on network `target`, `@`-insensitive + case-insensitive), the blank-key guard, and determinism.
 */
import { describe, expect, it, vi } from 'vitest';
import { removeSource } from '../src/main/x-listening/ipc';
import type { XPostArtifact, XNetworkArtifact } from '../src/main/x-listening/store';

function mkPost(over: Partial<XPostArtifact> & { id: string }): XPostArtifact {
  return {
    id: over.id,
    platform: 'x',
    authorHandle: over.authorHandle ?? 'alice',
    authorId: 'a',
    text: 't',
    channelId: over.channelId ?? 'alice',
    channelLabel: over.channelLabel ?? '@alice',
    messageId: over.id,
    publishedAt: '2026-08-01T00:00:00.000Z',
    harvestedAt: '2026-08-01T00:00:00.000Z',
    url: `https://x.com/alice/status/${over.id}`,
    provenance: { collectorVersion: 'test', jobId: 'j', caseId: 'c' },
    kind: 'post',
    parentPostId: null,
    metrics: { replies: 0, reposts: 0, likes: 0, views: 0 },
    metricsRaw: {},
    evidenceHash: `hash-${over.id}`,
    ...over,
  } as XPostArtifact;
}

function mkNet(target: string, kind: 'followers' | 'following' = 'followers'): XNetworkArtifact {
  return { target, kind, accounts: [], capturedAt: '2026-08-01T00:00:00.000Z' };
}

describe('removeSource — cascade over posts + networks', () => {
  it('removes only the matching source posts (by channelId) and leaves the rest byte-for-byte', async () => {
    const posts = [
      mkPost({ id: '1', channelId: 'alice', authorHandle: 'alice' }),
      mkPost({ id: '2', channelId: 'carol', authorHandle: 'carol', channelLabel: '@carol' }),
      mkPost({ id: '3', channelId: 'alice', authorHandle: 'alice' }),
    ];
    let writtenPosts: XPostArtifact[] | null = null;
    const res = await removeSource('case-a', 'alice', {
      readPosts: async () => posts,
      writePosts: async (_c, p) => { writtenPosts = p; },
      readNetworks: async () => [],
      writeNetworks: async () => {},
    });
    expect(res.removedPosts).toBe(2);
    expect(writtenPosts!.map((p) => p.id)).toEqual(['2']);
    // Surviving artifact is unchanged (no hash recompute).
    expect(writtenPosts![0].evidenceHash).toBe('hash-2');
  });

  it('falls back to authorHandle when channelId is empty', async () => {
    const posts = [
      mkPost({ id: '1', channelId: '', authorHandle: 'bob' }),
      mkPost({ id: '2', channelId: '', authorHandle: 'eve' }),
    ];
    let writtenPosts: XPostArtifact[] | null = null;
    const res = await removeSource('case-a', 'bob', {
      readPosts: async () => posts,
      writePosts: async (_c, p) => { writtenPosts = p; },
      readNetworks: async () => [],
      writeNetworks: async () => {},
    });
    expect(res.removedPosts).toBe(1);
    expect(writtenPosts!.map((p) => p.id)).toEqual(['2']);
  });

  it('matches @-insensitively and case-insensitively', async () => {
    const posts = [
      mkPost({ id: '1', channelId: '@Alice', authorHandle: 'Alice' }),
      mkPost({ id: '2', channelId: 'carol', authorHandle: 'carol' }),
    ];
    let writtenPosts: XPostArtifact[] | null = null;
    const res = await removeSource('case-a', 'alice', {
      readPosts: async () => posts,
      writePosts: async (_c, p) => { writtenPosts = p; },
      readNetworks: async () => [],
      writeNetworks: async () => {},
    });
    expect(res.removedPosts).toBe(1);
    expect(writtenPosts!.map((p) => p.id)).toEqual(['2']);
  });

  it('cascades to network artifacts whose target matches', async () => {
    const nets = [mkNet('@alice', 'followers'), mkNet('alice', 'following'), mkNet('carol')];
    let writtenNets: XNetworkArtifact[] | null = null;
    const res = await removeSource('case-a', 'alice', {
      readPosts: async () => [],
      writePosts: async () => {},
      readNetworks: async () => nets,
      writeNetworks: async (_c, n) => { writtenNets = n; },
    });
    expect(res.removedNetworks).toBe(2);
    expect(writtenNets!.map((n) => n.target)).toEqual(['carol']);
  });

  it('a key matching nothing is a harmless no-op that still rewrites the unchanged lists', async () => {
    const posts = [mkPost({ id: '1', channelId: 'alice', authorHandle: 'alice' })];
    const writePosts = vi.fn(async () => {});
    const writeNetworks = vi.fn(async () => {});
    const res = await removeSource('case-a', 'nobody', {
      readPosts: async () => posts,
      writePosts,
      readNetworks: async () => [],
      writeNetworks,
    });
    expect(res).toEqual({ removedPosts: 0, removedNetworks: 0 });
    expect(writePosts).toHaveBeenCalledWith('case-a', posts);
    expect(writeNetworks).toHaveBeenCalledWith('case-a', []);
  });

  it('rejects a blank source key before touching the store', async () => {
    const readPosts = vi.fn(async () => []);
    await expect(
      removeSource('case-a', '   @  ', {
        readPosts,
        writePosts: async () => {},
        readNetworks: async () => [],
        writeNetworks: async () => {},
      }),
    ).rejects.toThrow(/source key/i);
    expect(readPosts).not.toHaveBeenCalled();
  });
});
