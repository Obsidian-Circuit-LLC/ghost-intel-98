import { describe, it, expect } from 'vitest';
import { parseMaigretData, buildProbeUrl, toCatalog, validateImportedSites } from '@shared/searchlight/sites';
import type { MaigretSiteEntry } from '@shared/searchlight/types';

describe('parseMaigretData engine resolution', () => {
  const db = {
    engines: {
      engine404: { name: 'engine404', site: { checkType: 'status_code' } },
      engine404message: { name: 'engine404message', site: { checkType: 'message', absenceStrs: ['Not Found'] } },
    },
    tags: { social: 'Social' },
    sites: {
      Upwork: { engine: 'engine404', urlMain: 'https://upwork.com', url: 'https://upwork.com/fl/{username}', tags: ['freelance'] },
      Foo: { engine: 'engine404message', url: 'https://foo.test/{username}' },
      Override: { engine: 'engine404', checkType: 'message', url: 'https://o.test/{username}', presenseStrs: ['hi'] },
      Unknown: { engine: 'nope', url: 'https://u.test/{username}' },
      Dead: { engine: 'engine404', disabled: true, url: 'https://d.test/{username}' },
      Inline: { checkType: 'message', url: 'https://i.test/{username}', absenceStrs: ['gone'] },
    },
  };

  it('resolves engine checkType and strings, lets site override, drops disabled, excludes engines/tags keys', () => {
    const sites = parseMaigretData(db);
    const byName = Object.fromEntries(sites.map((s) => [s.name, s]));
    expect(byName.Upwork.checkType).toBe('status_code');
    expect(byName.Foo.checkType).toBe('message');
    expect(byName.Foo.absenceStrs).toEqual(['Not Found']);
    expect(byName.Override.checkType).toBe('message'); // site overrides engine's status_code
    expect(byName.Override.presenseStrs).toEqual(['hi']);
    expect(byName.Unknown.checkType).toBe('status_code'); // unknown engine -> coerce default
    expect(byName.Dead).toBeUndefined();
    expect(byName.Inline.checkType).toBe('message');
    expect(sites.find((s) => s.name === 'engine404')).toBeUndefined();
    expect(sites.find((s) => s.name === 'social')).toBeUndefined();
  });

  it('carries ignore403 from engine or site', () => {
    const sites = parseMaigretData({
      engines: { e: { site: { checkType: 'message', ignore403: true } } },
      sites: { A: { engine: 'e', url: 'https://a.test/{username}' }, B: { url: 'https://b.test/{username}', ignore403: true } },
    });
    const byName = Object.fromEntries(sites.map((s) => [s.name, s]));
    expect(byName.A.ignore403).toBe(true);
    expect(byName.B.ignore403).toBe(true);
  });
});

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
