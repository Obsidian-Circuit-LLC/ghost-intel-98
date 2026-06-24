import { describe, it, expect } from 'vitest';
import { parseMaigretData, buildProbeUrl, toCatalog, validateImportedSites } from '@shared/searchlight/sites';
import type { MaigretSiteEntry } from '@shared/searchlight/types';

const site = (over: Partial<MaigretSiteEntry> = {}): MaigretSiteEntry => ({
  name: 'GitHub', url: 'https://github.com/{username}', urlMain: 'https://github.com', urlProbe: '',
  category: 'coding', tags: ['coding'], checkType: 'status_code', presenseStrs: [], absenceStrs: [],
  alexaRank: 1, headers: {}, usernameClaimed: 'torvalds', ...over
});

describe('parseMaigretData', () => {
  it('maps a maigret object to entries and ignores regexCheck', () => {
    const json = { GitHub: { url: 'https://github.com/{username}', urlMain: 'https://github.com', tags: ['coding'], checkType: 'status_code', regexCheck: '^[a-z]+$' } };
    const out = parseMaigretData(json);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('GitHub');
    expect((out[0] as Record<string, unknown>).regexCheck).toBeUndefined();
  });
  it('accepts the {sites:{...}} envelope and skips disabled entries', () => {
    const json = { sites: { A: { url: 'https://a/{username}' }, B: { url: 'https://b/{username}', disabled: true } } };
    expect(parseMaigretData(json).map((s) => s.name)).toEqual(['A']);
  });
});

describe('buildProbeUrl', () => {
  it('substitutes and url-encodes the username', () => {
    expect(buildProbeUrl('a b', site()).url).toBe('https://github.com/a%20b');
  });
  it('uses urlProbe when present', () => {
    const r = buildProbeUrl('x', site({ urlProbe: 'https://api.github.com/users/{username}' }));
    expect(r.probeUrl).toBe('https://api.github.com/users/x');
    expect(r.url).toBe('https://github.com/x');
  });
});

describe('toCatalog', () => {
  it('projects name/category/tags/checkType only', () => {
    expect(toCatalog([site()])[0]).toEqual({ name: 'GitHub', category: 'coding', tags: ['coding'], checkType: 'status_code' });
  });
});

describe('validateImportedSites', () => {
  it('rejects non-https, missing {username}, and junk; keeps valid', () => {
    const raw = {
      Good: { url: 'https://good/{username}', tags: ['x'] },
      NoHttps: { url: 'http://bad/{username}' },
      NoToken: { url: 'https://bad/profile' },
      NotObj: 42
    };
    const { sites, rejected } = validateImportedSites(raw);
    expect(sites.map((s) => s.name)).toEqual(['Good']);
    expect(rejected).toBe(3);
  });
  it('caps total sites', () => {
    const raw: Record<string, unknown> = {};
    for (let i = 0; i < 10; i++) raw[`S${i}`] = { url: `https://s${i}/{username}` };
    const r = validateImportedSites(raw, 4);
    expect(r.sites).toHaveLength(4);
    expect(r.rejected).toBe(6);
  });
});
