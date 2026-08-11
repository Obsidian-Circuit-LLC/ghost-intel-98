/**
 * Task 10 — Highlight presets: save/remove/run (local search), ported from quarantine
 * `evaluatePreset` / `rebuildMatchesForPosts` (`main.cjs:1731-1768`).
 *
 * `presets.read`/`presets.write`/`presets.save` (pure upsert-by-id) already shipped with the
 * Task 1 store expansion and are covered by `x-listening-store.test.ts`; `presetsRead`/
 * `presetsSave` IPC channels already shipped with Task 6 (`x-listening-ipc-seam.test.ts`).
 * This file covers what Task 10 ADDS:
 *
 *  1. `evaluatePreset` (pure): keyword/mode/caseSensitive/profileIds matching over ONE post —
 *     a direct, fixture-based port of the quarantine function.
 *  2. `runPreset` (IPC orchestration): evaluates a saved preset against a case's captured
 *     posts and returns the matches for local highlight-search — never persisted (derived-
 *     on-read, same discipline as `computeNetworkAnalysis`/`aggregateEntities`), and a
 *     `synthetic` (demo/seeded) post is excluded (honesty, defense-in-depth).
 *  3. `removePreset` (IPC orchestration): upsert-by-id already exists (`presets.save`); this
 *     is the missing delete, read+filter+write like `removeNote`.
 */
import { describe, it, expect, vi } from 'vitest';

import { evaluatePreset, runPreset, removePreset } from '../src/main/x-listening/ipc';
import type { XPreset, XPostArtifact } from '../src/main/x-listening/store';

const mkPreset = (overrides: Partial<XPreset> = {}): XPreset => ({
  id: 'p1',
  name: 'Test preset',
  keywords: ['wallet'],
  mode: 'any',
  caseSensitive: false,
  profileIds: [],
  enabled: true,
  updatedAt: '2026-08-11T00:00:00.000Z',
  ...overrides,
});

const mkPost = (overrides: Partial<XPostArtifact> = {}): XPostArtifact => ({
  id: 'post-1',
  platform: 'x',
  authorHandle: '@target',
  authorId: 'target',
  text: 'check out my new wallet address',
  channelId: 'target',
  channelLabel: '@target',
  messageId: 'm1',
  publishedAt: '2026-08-11T00:00:00.000Z',
  harvestedAt: '2026-08-11T00:00:00.000Z',
  url: 'https://x.com/target/status/1',
  provenance: { collectorVersion: 'x-listening/1.0.0', jobId: 'job-1', caseId: 'case-a' },
  kind: 'post',
  parentPostId: null,
  metrics: { replies: 0, reposts: 0, likes: 0, views: 0 },
  metricsRaw: {},
  evidenceHash: 'hash-1',
  ...overrides,
});

// ---- 1. evaluatePreset (pure) -------------------------------------------

describe('evaluatePreset (pure keyword match)', () => {
  it('matches a post whose text contains the keyword (case-insensitive by default)', () => {
    const preset = mkPreset({ keywords: ['Wallet'] });
    expect(evaluatePreset(preset, mkPost({ text: 'my wallet is empty' }))).toEqual(['Wallet']);
  });

  it('returns [] when no keyword is present', () => {
    const preset = mkPreset({ keywords: ['bitcoin'] });
    expect(evaluatePreset(preset, mkPost({ text: 'unrelated text' }))).toEqual([]);
  });

  it('caseSensitive:true requires an exact-case match', () => {
    const preset = mkPreset({ keywords: ['Wallet'], caseSensitive: true });
    expect(evaluatePreset(preset, mkPost({ text: 'my wallet is empty' }))).toEqual([]);
    expect(evaluatePreset(preset, mkPost({ text: 'my Wallet is empty' }))).toEqual(['Wallet']);
  });

  it("mode:'any' (default) matches on ANY one keyword and returns only the matched ones", () => {
    const preset = mkPreset({ keywords: ['wallet', 'bitcoin'], mode: 'any' });
    expect(evaluatePreset(preset, mkPost({ text: 'my wallet address' }))).toEqual(['wallet']);
  });

  it("mode:'all' requires EVERY keyword to match, else []", () => {
    const preset = mkPreset({ keywords: ['wallet', 'bitcoin'], mode: 'all' });
    expect(evaluatePreset(preset, mkPost({ text: 'my wallet address' }))).toEqual([]);
    expect(evaluatePreset(preset, mkPost({ text: 'my wallet holds bitcoin' }))).toEqual([
      'wallet',
      'bitcoin',
    ]);
  });

  it('profileIds, when non-empty, restricts matching to posts from those targets (post.channelId)', () => {
    const preset = mkPreset({ profileIds: ['other-target'] });
    expect(evaluatePreset(preset, mkPost({ channelId: 'target' }))).toEqual([]);
    expect(
      evaluatePreset(mkPreset({ profileIds: ['target'] }), mkPost({ channelId: 'target' })),
    ).toEqual(['wallet']);
  });

  it('an empty profileIds list means "any target" (no restriction)', () => {
    const preset = mkPreset({ profileIds: [] });
    expect(evaluatePreset(preset, mkPost({ channelId: 'whatever' }))).toEqual(['wallet']);
  });

  it('trims blank keywords out before matching', () => {
    const preset = mkPreset({ keywords: ['  ', 'wallet'] });
    expect(evaluatePreset(preset, mkPost({ text: 'my wallet' }))).toEqual(['wallet']);
  });
});

// ---- 2. runPreset (IPC orchestration, derived-on-read) -------------------

describe('runPreset (derived-on-read highlight search)', () => {
  it('returns a match per post whose text satisfies the preset', async () => {
    const preset = mkPreset({ id: 'p1', keywords: ['wallet'] });
    const posts = [
      mkPost({ id: 'a', text: 'my wallet address is...' }),
      mkPost({ id: 'b', text: 'nothing relevant here' }),
      mkPost({ id: 'c', text: 'another wallet post' }),
    ];
    const res = await runPreset('case-a', 'p1', {
      readPresets: async () => [preset],
      readPosts: async () => posts,
    });
    expect(res.matches).toEqual([
      { postId: 'a', matchedKeywords: ['wallet'] },
      { postId: 'c', matchedKeywords: ['wallet'] },
    ]);
  });

  it('excludes synthetic/demo posts from matches (honesty, defense-in-depth)', async () => {
    const preset = mkPreset({ keywords: ['wallet'] });
    const posts = [
      mkPost({ id: 'real', text: 'my wallet address' }),
      mkPost({ id: 'fake', text: 'demo wallet address', synthetic: true }),
    ];
    const res = await runPreset('case-a', 'p1', {
      readPresets: async () => [preset],
      readPosts: async () => posts,
    });
    expect(res.matches).toEqual([{ postId: 'real', matchedKeywords: ['wallet'] }]);
  });

  it('throws when the preset id does not exist in the case', async () => {
    await expect(
      runPreset('case-a', 'missing', { readPresets: async () => [], readPosts: async () => [] }),
    ).rejects.toThrow(/not found/i);
  });

  it('returns no matches when nothing in the case satisfies the preset', async () => {
    const preset = mkPreset({ keywords: ['nonexistent-term'] });
    const res = await runPreset('case-a', 'p1', {
      readPresets: async () => [preset],
      readPosts: async () => [mkPost()],
    });
    expect(res.matches).toEqual([]);
  });
});

// ---- 3. removePreset (IPC orchestration) ---------------------------------

describe('removePreset (IPC orchestration)', () => {
  it('removes the preset with the given id and returns the remaining presets', async () => {
    const kept = mkPreset({ id: 'p2', name: 'Keep me' });
    let written: XPreset[] | null = null;
    const res = await removePreset('case-a', 'p1', {
      readPresets: async () => [mkPreset({ id: 'p1' }), kept],
      writePresets: async (_caseId, presets) => { written = presets; },
    });
    expect(res.presets).toEqual([kept]);
    expect(written).toEqual([kept]);
  });

  it('removing an id with no preset is a harmless no-op', async () => {
    const existing = [mkPreset({ id: 'p1' })];
    const write = vi.fn(async () => {});
    const res = await removePreset('case-a', 'does-not-exist', {
      readPresets: async () => existing,
      writePresets: write,
    });
    expect(res.presets).toEqual(existing);
    expect(write).toHaveBeenCalledWith('case-a', existing);
  });

  it('end-to-end through the real pure store: save, remove, verify gone', async () => {
    const { makeXStore } = await import('../src/main/x-listening/store');
    const memDeps = () => {
      const store = new Map<string, string>();
      const enoent = (p: string): Error => {
        const e = new Error(`ENOENT: ${p}`);
        (e as NodeJS.ErrnoException).code = 'ENOENT';
        return e;
      };
      return {
        readFile: async (p: string) => {
          if (!store.has(p)) throw enoent(p);
          return Buffer.from(store.get(p)!, 'utf8');
        },
        writeFile: async (p: string, d: string) => { store.set(p, d); },
        itemsPath: (caseId: string) => `x/${caseId}/x-items.json`,
        notesPath: (caseId: string) => `x/${caseId}/x-notes.json`,
        networksPath: (caseId: string) => `x/${caseId}/x-networks.json`,
        archiveStatePath: (caseId: string) => `x/${caseId}/x-archive-state.json`,
        postsPath: (caseId: string) => `x/${caseId}/x-posts.json`,
        presetsPath: (caseId: string) => `x/${caseId}/x-presets.json`,
        entitiesCachePath: (caseId: string) => `x/${caseId}/x-entities-cache.json`,
      };
    };
    const xStore = makeXStore(memDeps());
    await xStore.presets.save('case-a', mkPreset({ id: 'p1' }));
    await xStore.presets.save('case-a', mkPreset({ id: 'p2', name: 'Other' }));

    const res = await removePreset('case-a', 'p1', {
      readPresets: (caseId) => xStore.presets.read(caseId),
      writePresets: (caseId, presets) => xStore.presets.write(caseId, presets),
    });

    expect(res.presets.map((p) => p.id)).toEqual(['p2']);
    expect((await xStore.presets.read('case-a')).map((p) => p.id)).toEqual(['p2']);
  });
});
