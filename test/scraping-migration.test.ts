import { describe, it, expect } from 'vitest';

import { migrateScrapingData } from '../src/main/storage/scraping-migration';
import type { ScrapingMigrationDeps } from '../src/main/storage/scraping-migration';
import type { ScrapingCaseNs } from '../src/main/storage/paths';

/**
 * In-memory fs + path seam. The migration logic (marker guard, platform split, backup-before-
 * remove ordering) lives entirely in migrateScrapingData; the test drives it against a Map so it
 * can assert on exactly what landed in the socmint store, the x store, and the backup dir.
 */
interface Harness {
  deps: ScrapingMigrationDeps;
  files: Map<string, Buffer>;
}

const CASES = '/data/cases';
const SCRAPE = '/data/scraping';

function enoent(): NodeJS.ErrnoException {
  const e = new Error('ENOENT') as NodeJS.ErrnoException;
  e.code = 'ENOENT';
  return e;
}

function makeHarness(overrides: Partial<ScrapingMigrationDeps['fs']> = {}): Harness {
  const files = new Map<string, Buffer>();
  let seq = 0;
  let clock = 1_000;

  const baseFs: ScrapingMigrationDeps['fs'] = {
    async readFile(path) {
      const b = files.get(path);
      if (!b) throw enoent();
      return b;
    },
    async writeFile(path, data) {
      files.set(path, Buffer.from(data, 'utf8'));
    },
    async copyFile(src, dst) {
      const b = files.get(src);
      if (!b) throw enoent();
      files.set(dst, Buffer.from(b)); // byte-faithful copy
    },
    async rm(path) {
      files.delete(path);
    },
    async readdir(path) {
      const prefix = path.endsWith('/') ? path : `${path}/`;
      const names = new Set<string>();
      for (const key of files.keys()) {
        if (key.startsWith(prefix)) names.add(key.slice(prefix.length).split('/')[0]);
      }
      if (names.size === 0) throw enoent();
      return [...names];
    },
    async exists(path) {
      return files.has(path);
    },
    async stampMarker(path) {
      files.set(path, Buffer.from('migrated', 'utf8'));
    },
  };

  const deps: ScrapingMigrationDeps = {
    fs: { ...baseFs, ...overrides },
    paths: {
      casesDir: () => CASES,
      mainCaseFile: (id) => `${CASES}/${id}/case.json`,
      legacyItemsFile: (id) => `${CASES}/${id}/socmint-items.json`,
      legacyJobsFile: (id) => `${CASES}/${id}/socmint-jobs.json`,
      scrapingCaseFile: (ns, id) => `${SCRAPE}/${ns}/${id}/case.json`,
      scrapingItemsFile: (ns, id) => `${SCRAPE}/${ns}/${id}/${ns}-items.json`,
      scrapingJobsFile: (ns, id) => `${SCRAPE}/${ns}/${id}/${ns}-jobs.json`,
      backupFile: (caseId, basename) => `${SCRAPE}/backup/${caseId}/${basename}`,
      markerFile: () => `${SCRAPE}/.migrated-v3.27.0`,
    },
    now: () => clock++,
    uuid: () => `id-${++seq}`,
  };

  return { deps, files };
}

function item(id: string, platform: string): Record<string, unknown> {
  return { id, platform, text: `t-${id}`, channelId: 'c', messageId: id };
}

function readJson(files: Map<string, Buffer>, path: string): unknown {
  const b = files.get(path);
  if (!b) throw new Error(`missing ${path}`);
  return JSON.parse(b.toString('utf8'));
}

/** Seed a main case with a name + mixed legacy socmint items/jobs. */
function seedCaseA(files: Map<string, Buffer>): void {
  files.set(`${CASES}/case-A/case.json`, Buffer.from(JSON.stringify({ id: 'case-A', title: 'Alpha Case' }), 'utf8'));
  files.set(
    `${CASES}/case-A/socmint-items.json`,
    Buffer.from(JSON.stringify([item('a1', 'telegram'), item('a2', 'x'), item('a3', 'whatsapp')]), 'utf8'),
  );
  files.set(
    `${CASES}/case-A/socmint-jobs.json`,
    Buffer.from(JSON.stringify([{ jobId: 'j1', caseId: 'case-A', startedAt: '2026-01-01T00:00:00Z' }]), 'utf8'),
  );
}

describe('migrateScrapingData', () => {
  it('splits mixed SOCMINT+X items into the two stores and preserves jobs', async () => {
    const { deps, files } = makeHarness();
    seedCaseA(files);

    const res = await migrateScrapingData(deps);
    expect(res).toEqual({ migrated: 1, skipped: false });

    // case-A: uuid id-1 (socmint, created first), id-2 (x).
    const socItems = readJson(files, `${SCRAPE}/socmint/id-1/socmint-items.json`) as Array<{ id: string; platform: string }>;
    expect(socItems.map((i) => i.id)).toEqual(['a1', 'a3']); // telegram + whatsapp, order preserved
    expect(socItems.every((i) => i.platform !== 'x')).toBe(true);

    const xItems = readJson(files, `${SCRAPE}/x/id-2/x-items.json`) as Array<{ id: string; platform: string }>;
    expect(xItems.map((i) => i.id)).toEqual(['a2']);
    expect(xItems.every((i) => i.platform === 'x')).toBe(true);

    // Both scraping cases are named after the source main case record.
    expect((readJson(files, `${SCRAPE}/socmint/id-1/case.json`) as { name: string }).name).toBe('Alpha Case');
    expect((readJson(files, `${SCRAPE}/x/id-2/case.json`) as { name: string }).name).toBe('Alpha Case');

    // Jobs (no platform field) are preserved in the socmint store.
    const jobs = readJson(files, `${SCRAPE}/socmint/id-1/socmint-jobs.json`) as Array<{ jobId: string }>;
    expect(jobs.map((j) => j.jobId)).toEqual(['j1']);
  });

  it('backs up the originals faithfully BEFORE removing them from the main case', async () => {
    const { deps, files } = makeHarness();
    seedCaseA(files);
    const origItems = files.get(`${CASES}/case-A/socmint-items.json`)!.toString('utf8');
    const origJobs = files.get(`${CASES}/case-A/socmint-jobs.json`)!.toString('utf8');

    await migrateScrapingData(deps);

    // Backup exists and is byte-faithful (reversible).
    expect(files.get(`${SCRAPE}/backup/case-A/socmint-items.json`)!.toString('utf8')).toBe(origItems);
    expect(files.get(`${SCRAPE}/backup/case-A/socmint-jobs.json`)!.toString('utf8')).toBe(origJobs);

    // Originals removed from the main case dir only after the backup + store copy.
    expect(files.has(`${CASES}/case-A/socmint-items.json`)).toBe(false);
    expect(files.has(`${CASES}/case-A/socmint-jobs.json`)).toBe(false);
  });

  it('does NOT remove originals if the backup copy fails (ordering: copy before delete)', async () => {
    const { deps, files } = makeHarness({
      async copyFile() {
        throw new Error('disk full');
      },
    });
    seedCaseA(files);

    await migrateScrapingData(deps);

    // Backup failed → originals must survive, and the marker must not be stamped (retry next launch).
    expect(files.has(`${CASES}/case-A/socmint-items.json`)).toBe(true);
    expect(files.has(`${CASES}/case-A/socmint-jobs.json`)).toBe(true);
    expect(files.has(`${SCRAPE}/.migrated-v3.27.0`)).toBe(false);
  });

  it('is a no-op on the second run (marker guard)', async () => {
    const { deps, files } = makeHarness();
    seedCaseA(files);

    const first = await migrateScrapingData(deps);
    expect(first.skipped).toBe(false);
    expect(files.has(`${SCRAPE}/.migrated-v3.27.0`)).toBe(true);

    // Re-seed a fresh legacy file; the marker must make the second run ignore it entirely.
    files.set(`${CASES}/case-A/socmint-items.json`, Buffer.from(JSON.stringify([item('z9', 'telegram')]), 'utf8'));
    const snapshot = new Map([...files.entries()].map(([k, v]) => [k, v.toString('utf8')]));

    const second = await migrateScrapingData(deps);
    expect(second).toEqual({ migrated: 0, skipped: true });

    // Nothing changed.
    const after = new Map([...files.entries()].map(([k, v]) => [k, v.toString('utf8')]));
    expect(after).toEqual(snapshot);
  });

  it('falls back to the case id as the scraping-case name when the main case record is unreadable', async () => {
    const { deps, files } = makeHarness();
    // No case.json — only legacy x items.
    files.set(`${CASES}/case-C/socmint-items.json`, Buffer.from(JSON.stringify([item('c1', 'x'), item('c2', 'x')]), 'utf8'));

    await migrateScrapingData(deps);

    expect((readJson(files, `${SCRAPE}/x/id-1/case.json`) as { name: string }).name).toBe('case-C');
    const xItems = readJson(files, `${SCRAPE}/x/id-1/x-items.json`) as Array<{ id: string }>;
    expect(xItems.map((i) => i.id)).toEqual(['c1', 'c2']);
  });

  it('is deterministic: identical fixtures + injected clock/uuid produce identical store contents', async () => {
    const run = async (): Promise<Map<string, string>> => {
      const { deps, files } = makeHarness();
      seedCaseA(files);
      files.set(`${CASES}/case-B/case.json`, Buffer.from(JSON.stringify({ id: 'case-B', title: 'Bravo' }), 'utf8'));
      files.set(`${CASES}/case-B/socmint-items.json`, Buffer.from(JSON.stringify([item('b1', 'x')]), 'utf8'));
      await migrateScrapingData(deps);
      const out = new Map<string, string>();
      for (const [k, v] of files.entries()) {
        if (k.startsWith(`${SCRAPE}/socmint/`) || k.startsWith(`${SCRAPE}/x/`)) out.set(k, v.toString('utf8'));
      }
      return out;
    };

    const a = await run();
    const b = await run();
    expect(a).toEqual(b);
    expect(a.size).toBeGreaterThan(0);
  });
});
