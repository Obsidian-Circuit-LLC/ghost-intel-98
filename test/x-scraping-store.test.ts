/**
 * W4 Task 5: X Intel + GhostScrape persist into the x scraping store.
 *
 * Two behaviours are asserted:
 *
 *  (A) X item/job persistence (the x-namespace prod exports of socmint/store.ts —
 *      upsertXItems/listXItems/recordXJob/listXJobs) resolves under
 *        <dataRoot>/scraping-cases/x/<id>/
 *      through secure-fs (encrypt-at-rest choke-point), and NOT under the socmint
 *      scraping store nor the main investigation case dir.
 *
 *  (B) GhostScrape "save to case" writes its artifact under the x scraping case
 *      (scrapingCaseArtifactFile('x', id, name)), through secure-fs — never the main
 *      case notes dir. The scrapingCases.saveArtifact handler validates the store
 *      discriminator + id + filename before any path is built.
 *
 * electron is stubbed so the real paths arithmetic runs; secure-fs is mocked with an
 * in-memory map that records every path handed to secureWriteFile / secureReadFile,
 * proving the at-rest choke-point (never the plain fs bypass) is used.
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

const mkXItem = (messageId: string): HarvestedItem => ({
  id: `sha256-x-${messageId}`,
  platform: 'x',
  authorHandle: 'someuser',
  authorId: 'u1',
  text: `tweet ${messageId}`,
  channelId: 'query-term',
  channelLabel: 'Query',
  messageId,
  publishedAt: '2026-06-26T10:00:00.000Z',
  harvestedAt: '2026-06-26T10:00:01.000Z',
  url: 'https://x.com/someuser/status/1',
  provenance: { collectorVersion: 'x-v1', jobId: 'job-x', caseId: 'case-x' },
});

const mkJob = (jobId: string): SocmintJob => ({
  jobId,
  caseId: 'case-x',
  startedAt: '2026-06-26T10:00:00.000Z',
  runtime: 'twscrape',
});

describe('W4-T5(A): X items + jobs persist under scraping-cases/x/<id>/', () => {
  beforeEach(() => {
    files.clear();
    vi.clearAllMocks();
  });

  it('writes X items + jobs under scrapingCaseDir(x, id), not socmint nor the main case dir', async () => {
    const { upsertXItems, recordXJob } = await import('../src/main/socmint/store');
    const { scrapingCaseDir, caseDir } = await import('../src/main/storage/paths');
    const { join } = await import('node:path');

    await upsertXItems('case-x', [mkXItem('1')]);
    await recordXJob('case-x', mkJob('job-x'));

    const wrote = [...files.keys()];
    const expectedItems = join(scrapingCaseDir('x', 'case-x'), 'x-items.json');
    const expectedJobs = join(scrapingCaseDir('x', 'case-x'), 'x-jobs.json');

    expect(wrote).toContain(expectedItems);
    expect(wrote).toContain(expectedJobs);

    // NOT under the socmint scraping store.
    const socmintDir = scrapingCaseDir('socmint', 'case-x');
    expect(wrote.some((p) => p.startsWith(socmintDir))).toBe(false);
    // NOT under the main investigation case dir.
    const mainDir = caseDir('case-x');
    expect(wrote.some((p) => p.startsWith(mainDir))).toBe(false);
  });

  it('round-trips through the x scraping store (list reads back what upsert wrote)', async () => {
    const { upsertXItems, listXItems, recordXJob, listXJobs } = await import(
      '../src/main/socmint/store'
    );

    await upsertXItems('case-x', [mkXItem('1'), mkXItem('2')]);
    await recordXJob('case-x', mkJob('job-x'));

    expect((await listXItems('case-x')).map((i) => i.id)).toEqual(['sha256-x-1', 'sha256-x-2']);
    expect((await listXJobs('case-x')).map((j) => j.jobId)).toEqual(['job-x']);
  });
});

describe('W4-T5(B): GhostScrape save-to-case writes its artifact into the x scraping store', () => {
  beforeEach(() => {
    files.clear();
    vi.clearAllMocks();
  });

  it('saveScrapingArtifact writes under scrapingCaseArtifactFile(x, id, name) via secure-fs', async () => {
    const { saveScrapingArtifact } = await import('../src/main/storage/scraping-cases');
    const { scrapingCaseArtifactFile, caseNotesDir } = await import('../src/main/storage/paths');

    const id = '44444444-4444-4444-8444-444444444444';
    const name = 'ghostscrape-someuser-1751000000000.json';
    const content = JSON.stringify({ captured: 2 });

    const saved = await saveScrapingArtifact('x', id, name, content);
    expect(saved).toBe(name);

    const wrote = [...files.keys()];
    expect(wrote).toContain(scrapingCaseArtifactFile('x', id, name));

    // Must NOT have written into the main investigation case notes dir.
    const notesDir = caseNotesDir(id);
    expect(wrote.some((p) => p.startsWith(notesDir))).toBe(false);
  });
});

describe('W4-T5(B): scrapingCases.saveArtifact handler validates before writing', () => {
  it('routes a valid store/id/name to the injected artifact writer; rejects hostile input', async () => {
    const { createScrapingCasesHandlers } = await import('../src/main/scraping-cases/ipc');
    const saveArtifact = vi.fn(async () => 'ok.json');
    const handlers = createScrapingCasesHandlers({
      getStore: () => {
        throw new Error('getStore must not be reached by saveArtifact');
      },
      importToCase: async () => ({ imported: 0 }),
      saveArtifact,
    });

    const id = '44444444-4444-4444-8444-444444444444';
    await handlers.saveArtifact('x', id, 'ghostscrape-x.json', '{}');
    expect(saveArtifact).toHaveBeenCalledWith('x', id, 'ghostscrape-x.json', '{}');

    saveArtifact.mockClear();
    // Bogus store discriminator throws before any write.
    await expect(handlers.saveArtifact('cases', id, 'a.json', '{}')).rejects.toThrow();
    // Non-UUID case id throws (path-traversal guard).
    await expect(handlers.saveArtifact('x', '../../etc', 'a.json', '{}')).rejects.toThrow();
    // Filename with a path separator throws.
    await expect(handlers.saveArtifact('x', id, '../evil.json', '{}')).rejects.toThrow();
    // Non-string content throws.
    await expect(handlers.saveArtifact('x', id, 'a.json', 123 as unknown as string)).rejects.toThrow();
    expect(saveArtifact).not.toHaveBeenCalled();
  });
});
