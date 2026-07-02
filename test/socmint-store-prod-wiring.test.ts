/**
 * Production-wiring test for src/main/socmint/store.ts.
 *
 * The pure factory (makeSocmintStore) is exercised by socmint-store.test.ts.
 * Here we assert the *production-wired* top-level exports resolve their sidecar
 * paths against scrapingCaseDir('socmint', id) — i.e. under
 *   <dataRoot>/scraping-cases/socmint/<id>/
 * and NOT under the main investigation case dir <dataRoot>/cases/<id>/.
 *
 * electron is stubbed so the real paths.ts arithmetic runs; secure-fs is mocked
 * with an in-memory map that records every path handed to secureWriteFile /
 * secureReadFile, proving the at-rest choke-point (never the plain bypass) is used.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { HarvestedItem, SocmintJob } from '../src/shared/socmint/types';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: (name: string) => `/mock/${name}`,
    getAppPath: () => '/mock/appPath',
  },
}));

// In-memory secure-fs: records paths + round-trips bytes so upsert/list works.
const files = new Map<string, Buffer>();
vi.mock('../src/main/storage/secure-fs', () => ({
  secureReadFile: vi.fn(async (p: string): Promise<Buffer> => {
    if (!files.has(p)) {
      const e = new Error(`ENOENT: ${p}`) as NodeJS.ErrnoException;
      e.code = 'ENOENT';
      throw e;
    }
    return files.get(p)!;
  }),
  secureWriteFile: vi.fn(async (p: string, d: Buffer | string): Promise<void> => {
    files.set(p, typeof d === 'string' ? Buffer.from(d, 'utf8') : d);
  }),
}));

const mkItem = (messageId: string): HarvestedItem => ({
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
});

const mkJob = (jobId: string): SocmintJob => ({
  jobId,
  caseId: 'case-a',
  startedAt: '2026-06-26T10:00:00.000Z',
  model: 'nomic-embed-text',
  runtime: 'ollama',
  quantization: 'Q4_K_M',
});

describe('socmint store: production wiring persists under scraping-cases/socmint', () => {
  beforeEach(() => {
    files.clear();
    vi.clearAllMocks();
  });

  it('writes items + jobs under scrapingCaseDir(socmint, id), not caseDir(id)', async () => {
    const { upsertItems, recordJob } = await import('../src/main/socmint/store');
    const { scrapingCaseDir, caseDir } = await import('../src/main/storage/paths');
    const { join } = await import('node:path');

    await upsertItems('case-a', [mkItem('1')]);
    await recordJob('case-a', mkJob('job-1'));

    const wrote = [...files.keys()];
    const expectedItems = join(scrapingCaseDir('socmint', 'case-a'), 'socmint-items.json');
    const expectedJobs = join(scrapingCaseDir('socmint', 'case-a'), 'socmint-jobs.json');

    expect(wrote).toContain(expectedItems);
    expect(wrote).toContain(expectedJobs);

    // Must NOT have written under the main investigation case dir.
    const mainDir = caseDir('case-a');
    expect(wrote.some((p) => p.startsWith(mainDir))).toBe(false);
  });

  it('round-trips through the scraping store (list reads back what upsert wrote)', async () => {
    const { upsertItems, listItems, recordJob, listJobs } = await import(
      '../src/main/socmint/store'
    );

    await upsertItems('case-a', [mkItem('1'), mkItem('2')]);
    await recordJob('case-a', mkJob('job-1'));

    expect((await listItems('case-a')).map((i) => i.id)).toEqual(['sha256-1', 'sha256-2']);
    expect((await listJobs('case-a')).map((j) => j.jobId)).toEqual(['job-1']);
  });
});
