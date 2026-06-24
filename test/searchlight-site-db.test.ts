import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DATA = mkdtempSync(join(tmpdir(), 'sl-db-'));
vi.mock('electron', () => ({ app: { getPath: () => DATA, getAppPath: () => DATA } }));

import * as db from '../src/main/searchlight/site-db';
import { parseMaigretData } from '../src/shared/searchlight/sites';

const BUNDLED = { GitHub: { url: 'https://github.com/{username}', tags: ['coding'] }, X: { url: 'https://x.com/{username}', tags: ['social'] } };

beforeEach(() => db._resetForTest());

describe('site-db', () => {
  it('loadBundled parses the injected JSON', () => {
    expect(db.loadBundled(() => BUNDLED).map((s) => s.name).sort()).toEqual(['GitHub', 'X']);
  });
  it('importCustomSites validates and merges; catalog reflects merge', async () => {
    // seed bundled via injection by stubbing loadBundled is not needed: importing custom + reading back
    const res = await db.importCustomSites(JSON.stringify({ MySite: { url: 'https://mysite/{username}' }, Bad: { url: 'http://no/{username}' } }));
    expect(res).toEqual({ added: 1, rejected: 1 });
    const full = await db.fullSites();
    expect(full.some((s) => s.name === 'MySite')).toBe(true);
  });

  it('importCustomSites returns {0,0} on non-JSON input without throwing', async () => {
    await expect(db.importCustomSites('not json{')).resolves.toEqual({ added: 0, rejected: 0 });
  });

  it('persists custom sites across a cache reset (secure-fs round-trip)', async () => {
    await db.importCustomSites(JSON.stringify({ Persisted: { url: 'https://persisted/{username}' } }));
    db._resetForTest();
    const full = await db.fullSites();
    expect(full.some((s) => s.name === 'Persisted')).toBe(true);
  });

  it('custom site overrides a bundled site of the same name', async () => {
    db.loadBundled(() => ({ Dup: { url: 'https://bundled/{username}' } }));
    await db.importCustomSites(JSON.stringify({ Dup: { url: 'https://custom/{username}' } }));
    const full = await db.fullSites();
    const dup = full.filter((s) => s.name === 'Dup');
    expect(dup).toHaveLength(1);
    expect(dup[0].url).toBe('https://custom/{username}');
  });
});

describe('bundled Maigret DB', () => {
  it('parses the full bundled DB to a large engine-resolved catalog', () => {
    const raw = JSON.parse(readFileSync(join(process.cwd(), 'resources/searchlight/maigret_sites.json'), 'utf8'));
    expect(raw.engines).toBeTruthy(); // envelope preserved
    const sites = parseMaigretData(raw);
    expect(sites.length).toBeGreaterThan(2000); // far above the old ~1,433 subset
    // engine-backed sites resolved (no checkType defaulted away to status_code en masse):
    const messageSites = sites.filter((s) => s.checkType === 'message');
    expect(messageSites.length).toBeGreaterThan(200);
  });
});
