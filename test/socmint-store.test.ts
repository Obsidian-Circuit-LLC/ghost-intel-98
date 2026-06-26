/**
 * Tests for src/main/socmint/store.ts — in-memory fs injection seam; no electron/vault needed.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { makeSocmintStore, type SocmintStoreDeps } from '../src/main/socmint/store';
import type { HarvestedItem, SocmintJob } from '../src/shared/socmint/types';

// ---- in-memory fs adapter ----------------------------------------

function memDeps(): SocmintStoreDeps {
  const store = new Map<string, string>();
  const enoent = (p: string): Error => {
    const e = new Error(`ENOENT: ${p}`);
    (e as NodeJS.ErrnoException).code = 'ENOENT';
    return e;
  };
  return {
    readFile: async (p) => {
      if (!store.has(p)) throw enoent(p);
      return Buffer.from(store.get(p)!, 'utf8');
    },
    writeFile: async (p, d) => { store.set(p, d); },
    itemsPath: (caseId) => `cases/${caseId}/socmint-items.json`,
    jobsPath:  (caseId) => `cases/${caseId}/socmint-jobs.json`,
  };
}

// ---- fixtures -------------------------------------------------------

const mkItem = (messageId: string, overrides: Partial<HarvestedItem> = {}): HarvestedItem => ({
  id: `sha256-${messageId}`,
  platform: 'telegram',
  authorHandle: '@user',
  authorId: 'u1',
  text: `message ${messageId}`,
  channelId: '-100channel1',
  channelLabel: 'Channel 1',
  messageId,
  publishedAt: '2026-06-26T10:00:00.000Z',
  harvestedAt: '2026-06-26T10:00:01.000Z',
  url: 'https://t.me/c/100channel1/1',
  provenance: { collectorVersion: '1.0.0', jobId: 'job-1', caseId: 'case-a' },
  ...overrides,
});

const mkJob = (jobId: string): SocmintJob => ({
  jobId,
  caseId: 'case-a',
  startedAt: '2026-06-26T10:00:00.000Z',
  model: 'nomic-embed-text',
  runtime: 'ollama',
  quantization: 'Q4_K_M',
});

// ---- tests ----------------------------------------------------------

describe('makeSocmintStore: upsertItems', () => {
  let store: ReturnType<typeof makeSocmintStore>;

  beforeEach(() => {
    store = makeSocmintStore(memDeps());
  });

  it('returns added:1, skipped:0 for a new item', async () => {
    const result = await store.upsertItems('case-a', [mkItem('1')]);
    expect(result).toEqual({ added: 1, skipped: 0 });
  });

  it('persists items and listItems returns them', async () => {
    await store.upsertItems('case-a', [mkItem('1'), mkItem('2')]);
    const items = await store.listItems('case-a');
    expect(items).toHaveLength(2);
    expect(items[0].id).toBe('sha256-1');
    expect(items[1].id).toBe('sha256-2');
  });

  it('is idempotent: re-upsert same ids returns added:0, skipped:n', async () => {
    await store.upsertItems('case-a', [mkItem('1'), mkItem('2')]);
    const second = await store.upsertItems('case-a', [mkItem('1'), mkItem('2')]);
    expect(second).toEqual({ added: 0, skipped: 2 });

    // items count must stay the same
    const items = await store.listItems('case-a');
    expect(items).toHaveLength(2);
  });

  it('handles a mix of new and already-seen ids', async () => {
    await store.upsertItems('case-a', [mkItem('1')]);
    const result = await store.upsertItems('case-a', [mkItem('1'), mkItem('2')]);
    expect(result).toEqual({ added: 1, skipped: 1 });
    expect(await store.listItems('case-a')).toHaveLength(2);
  });

  it('preserves append order in listItems', async () => {
    await store.upsertItems('case-a', [mkItem('1'), mkItem('2'), mkItem('3')]);
    const items = await store.listItems('case-a');
    expect(items.map((i) => i.id)).toEqual(['sha256-1', 'sha256-2', 'sha256-3']);
  });

  it('is case-scoped: items from different cases are independent', async () => {
    await store.upsertItems('case-a', [mkItem('1')]);
    await store.upsertItems('case-b', [mkItem('1'), mkItem('2')]);

    expect(await store.listItems('case-a')).toHaveLength(1);
    expect(await store.listItems('case-b')).toHaveLength(2);
  });

  it('listItems returns empty array when no items have been upserted', async () => {
    expect(await store.listItems('case-empty')).toEqual([]);
  });
});

describe('makeSocmintStore: recordJob / listJobs', () => {
  let store: ReturnType<typeof makeSocmintStore>;

  beforeEach(() => {
    store = makeSocmintStore(memDeps());
  });

  it('round-trips a single job', async () => {
    await store.recordJob('case-a', mkJob('job-1'));
    const jobs = await store.listJobs('case-a');
    expect(jobs).toHaveLength(1);
    expect(jobs[0].jobId).toBe('job-1');
  });

  it('preserves multiple jobs in append order', async () => {
    await store.recordJob('case-a', mkJob('job-1'));
    await store.recordJob('case-a', mkJob('job-2'));
    const jobs = await store.listJobs('case-a');
    expect(jobs.map((j) => j.jobId)).toEqual(['job-1', 'job-2']);
  });

  it('listJobs returns empty array when no jobs have been recorded', async () => {
    expect(await store.listJobs('case-empty')).toEqual([]);
  });

  it('job fields are preserved faithfully (model, runtime, quantization)', async () => {
    const j = mkJob('job-x');
    await store.recordJob('case-a', j);
    const [saved] = await store.listJobs('case-a');
    expect(saved).toEqual(j);
  });

  it('jobs are case-scoped', async () => {
    await store.recordJob('case-a', mkJob('job-1'));
    await store.recordJob('case-b', mkJob('job-2'));
    expect(await store.listJobs('case-a')).toHaveLength(1);
    expect(await store.listJobs('case-b')).toHaveLength(1);
  });
});
