import { describe, it, expect, afterEach, vi } from 'vitest';

// __setProfileFacadeDepsForTest lazily builds real defaults for any dep it isn't given (see
// index.ts), which touches dataRoot()/app.getPath — mock electron so that path never needs a
// real Electron runtime, matching the convention used throughout test/*.
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/ga98-memory-profile-facade-test' } }));

import {
  recallProfile,
  learnFromConversation,
  profileSummaries,
  profileWipe,
  __setProfileFacadeDepsForTest,
  __resetProfileFacadeForTest
} from '../src/main/services/memory/profile/index';
import { createProfileStore, type ProfileStoreIO } from '../src/main/services/memory/profile/profile-store';
import { normalizeItemText, type MemoryItem } from '../src/main/services/memory/profile/types';
import type { ExtractorClient } from '../src/main/services/memory/profile/extractor';
import type { SummarizerClient } from '../src/main/services/memory/profile/summarizer';

function makeFakeStoreIO(initial: MemoryItem[] = []): ProfileStoreIO {
  let text: string | null = initial.length ? JSON.stringify(initial) : null;
  return {
    async read() { return text; },
    async write(t: string) { text = t; }
  };
}

function makeFakeSummaryIO(initial: Record<string, string> = {}) {
  let text: string | null = Object.keys(initial).length ? JSON.stringify(initial) : null;
  return {
    async read() { return text; },
    async write(t: string) { text = t; }
  };
}

function item(over: Partial<MemoryItem>): MemoryItem {
  return {
    id: 'i1',
    scope: 'global',
    text: 'Prefers Tor-only egress',
    normalized: normalizeItemText('Prefers Tor-only egress'),
    provenance: ['note:foo'],
    confidence: 0.5,
    createdAt: 1000,
    lastSeenAt: 1000,
    pinned: false,
    source: 'extractor',
    ...over
  };
}

function idFactory(prefix = 'new'): () => string {
  let n = 0;
  return () => `${prefix}-${n++}`;
}

const noopSummarizer: SummarizerClient = { complete: async () => '' };

afterEach(() => {
  __resetProfileFacadeForTest();
});

describe('learnFromConversation', () => {
  it('extracts, reconciles, and persists candidates from a fake extractor', async () => {
    const store = createProfileStore(makeFakeStoreIO());
    const extractorClient: ExtractorClient = { complete: async () => '["Uses Tor-only egress"]' };
    __setProfileFacadeDepsForTest({
      store,
      extractorClient,
      summarizerClient: noopSummarizer,
      summaryIo: makeFakeSummaryIO(),
      now: () => 1000,
      newId: idFactory()
    });

    await learnFromConversation('convo-1', 'user: I only use Tor.\nassistant: noted.', ['global']);

    const all = await store.all();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      scope: 'global',
      text: 'Uses Tor-only egress',
      provenance: ['conversation:convo-1'],
      source: 'extractor'
    });
  });

  it('scopes new candidates to the most specific (last) scope', async () => {
    const store = createProfileStore(makeFakeStoreIO());
    const extractorClient: ExtractorClient = { complete: async () => '["Works the night shift"]' };
    __setProfileFacadeDepsForTest({
      store,
      extractorClient,
      summarizerClient: noopSummarizer,
      summaryIo: makeFakeSummaryIO(),
      now: () => 1000,
      newId: idFactory()
    });

    await learnFromConversation('convo-1', 'turns', ['global', 'case:c1']);

    const all = await store.all();
    expect(all).toHaveLength(1);
    expect(all[0].scope).toBe('case:c1');
  });

  it('a throwing extractor client leaves the store unchanged and does not reject', async () => {
    const preExisting = [item({ id: 'a', lastSeenAt: 1000 })];
    const store = createProfileStore(makeFakeStoreIO(preExisting));
    const extractorClient: ExtractorClient = {
      complete: async () => {
        throw new Error('ollama unreachable');
      }
    };
    __setProfileFacadeDepsForTest({
      store,
      extractorClient,
      summarizerClient: noopSummarizer,
      summaryIo: makeFakeSummaryIO(),
      now: () => 1000, // same clock as preExisting.lastSeenAt → zero decay, so "unchanged" is exact
      newId: idFactory()
    });

    await expect(learnFromConversation('convo-1', 'turns', ['global'])).resolves.toBeUndefined();

    const all = await store.all();
    expect(all).toEqual(preExisting);
  });

  it('a throwing store also does not reject (fully best-effort)', async () => {
    const brokenIO: ProfileStoreIO = {
      read: async () => { throw new Error('disk unreadable'); },
      write: async () => { throw new Error('disk unwritable'); }
    };
    const store = createProfileStore(brokenIO);
    const extractorClient: ExtractorClient = { complete: async () => '["Some fact"]' };
    __setProfileFacadeDepsForTest({
      store,
      extractorClient,
      summarizerClient: noopSummarizer,
      summaryIo: makeFakeSummaryIO(),
      now: () => 1000,
      newId: idFactory()
    });

    await expect(learnFromConversation('convo-1', 'turns', ['global'])).resolves.toBeUndefined();
  });

  it('does not re-decay an unreinforced item on repeated calls with no real time elapsed', async () => {
    // Reproduces the compounding-decay bug: a multi-turn chat auto-saves (and so re-triggers
    // learnFromConversation) many times per session, with the real clock barely moving. Decay
    // must be anchored to real elapsed time since the last checkpoint, not re-applied on every
    // call regardless of the clock.
    const DAY_MS = 24 * 60 * 60 * 1000;
    const fixedNow = 5 * DAY_MS; // item is "5 days stale" exactly once
    const preExisting = [item({ id: 'a', confidence: 1.0, lastSeenAt: 0 })];
    const store = createProfileStore(makeFakeStoreIO(preExisting));
    // No candidate ever matches/reinforces this item.
    const extractorClient: ExtractorClient = { complete: async () => '[]' };
    __setProfileFacadeDepsForTest({
      store,
      extractorClient,
      summarizerClient: noopSummarizer,
      summaryIo: makeFakeSummaryIO(),
      now: () => fixedNow, // same instant on every call — no real time passes between calls
      newId: idFactory()
    });

    for (let i = 0; i < 10; i++) {
      await learnFromConversation('convo-1', 'turns', ['global']);
    }

    const all = await store.all();
    expect(all).toHaveLength(1); // still present — must NOT have decayed past the expiry floor
    // decayPerDay defaults to 0.02: exactly one day's worth of decay (5 days * 0.02) should have
    // been applied once, not once per call.
    expect(all[0].confidence).toBeCloseTo(1.0 - 0.02 * 5, 5);
  });

  it('rolls the scope summary forward via the summarizer client', async () => {
    const store = createProfileStore(makeFakeStoreIO());
    const summaryIo = makeFakeSummaryIO({ global: 'Prior summary.' });
    __setProfileFacadeDepsForTest({
      store,
      extractorClient: { complete: async () => '[]' },
      summarizerClient: { complete: async () => 'New distilled fact.' },
      summaryIo,
      now: () => 1000,
      newId: idFactory()
    });

    await learnFromConversation('convo-1', 'turns', ['global']);

    const { summary } = await recallProfile('anything', ['global']);
    expect(summary).toContain('Prior summary.');
    expect(summary).toContain('New distilled fact.');
  });
});

describe('summary governance (inspect + erase)', () => {
  it('profileSummaries exposes the per-scope rolling summaries for inspection', async () => {
    __setProfileFacadeDepsForTest({
      store: createProfileStore(makeFakeStoreIO()),
      summaryIo: makeFakeSummaryIO({ global: 'A general summary.', 'case:c1': 'A case summary.' }),
      now: () => 1000,
      newId: idFactory()
    });

    expect(await profileSummaries()).toEqual({ global: 'A general summary.', 'case:c1': 'A case summary.' });
  });

  it('profileSummaries returns {} when no summary file exists', async () => {
    __setProfileFacadeDepsForTest({
      store: createProfileStore(makeFakeStoreIO()),
      summaryIo: makeFakeSummaryIO(),
      now: () => 1000,
      newId: idFactory()
    });

    expect(await profileSummaries()).toEqual({});
  });

  it('scoped profileWipe erases that scope summary AND its items but leaves other scopes intact', async () => {
    const store = createProfileStore(makeFakeStoreIO([item({ id: 'a', scope: 'global' }), item({ id: 'b', scope: 'case:c1' })]));
    const summaryIo = makeFakeSummaryIO({ global: 'General summary.', 'case:c1': 'Case summary.' });
    __setProfileFacadeDepsForTest({ store, summaryIo, now: () => 1000, newId: idFactory() });

    await profileWipe('case:c1');

    expect(await profileSummaries()).toEqual({ global: 'General summary.' });
    expect((await store.all()).map((i) => i.id)).toEqual(['a']);
    // The surviving summary must still be injected on recall.
    const { summary } = await recallProfile('anything', ['global']);
    expect(summary).toContain('General summary.');
  });

  it('wipe-all (no scope) erases every summary as well as every item — nothing learned survives', async () => {
    const store = createProfileStore(makeFakeStoreIO([item({ id: 'a', scope: 'global' })]));
    const summaryIo = makeFakeSummaryIO({ global: 'General summary.', 'case:c1': 'Case summary.' });
    __setProfileFacadeDepsForTest({ store, summaryIo, now: () => 1000, newId: idFactory() });

    await profileWipe();

    expect(await profileSummaries()).toEqual({});
    expect(await store.all()).toEqual([]);
    const { summary, block } = await recallProfile('anything', ['global', 'case:c1']);
    expect(summary).toBe('');
    expect(block).toBe('');
  });
});

describe('recallProfile', () => {
  it("returns block === '' when the store is empty", async () => {
    __setProfileFacadeDepsForTest({
      store: createProfileStore(makeFakeStoreIO()),
      summaryIo: makeFakeSummaryIO(),
      now: () => 1000,
      newId: idFactory()
    });

    const out = await recallProfile('anything', ['global']);
    expect(out.items).toEqual([]);
    expect(out.summary).toBe('');
    expect(out.block).toBe('');
  });

  it('returns the in-scope items and a non-empty block when the profile has content', async () => {
    const existing = [item({ id: 'a', scope: 'global' }), item({ id: 'b', scope: 'case:other' })];
    __setProfileFacadeDepsForTest({
      store: createProfileStore(makeFakeStoreIO(existing)),
      summaryIo: makeFakeSummaryIO(),
      now: () => 1000,
      newId: idFactory()
    });

    const out = await recallProfile('anything', ['global']);
    expect(out.items.map((i) => i.id)).toEqual(['a']);
    expect(out.block).not.toBe('');
  });
});
