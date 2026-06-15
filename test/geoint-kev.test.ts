import { describe, it, expect } from 'vitest';
import { parseKev } from '../src/main/geoint/kev';

const catalog = {
  title: 'CISA Catalog of Known Exploited Vulnerabilities',
  catalogVersion: '2026.06.16',
  dateReleased: '2026-06-16T12:00:00.000Z',
  count: 3,
  vulnerabilities: [
    {
      cveID: 'CVE-2026-1111',
      vendorProject: 'Acme',
      product: 'Gadget',
      vulnerabilityName: 'Acme Gadget RCE',
      dateAdded: '2026-06-10',
      shortDescription: 'Remote code execution in Acme Gadget.',
      requiredAction: 'Patch.',
      dueDate: '2026-07-01',
      knownRansomwareCampaignUse: 'Known',
      notes: 'x',
      cwes: ['CWE-94']
    },
    {
      cveID: 'CVE-2026-2222',
      vendorProject: 'Globex',
      product: 'Widget',
      vulnerabilityName: 'Globex Widget Auth Bypass',
      dateAdded: '2026-06-15',
      shortDescription: 'Auth bypass.',
      knownRansomwareCampaignUse: 'Unknown'
    },
    {
      // Missing most fields — must be tolerated and defaulted to ''.
      cveID: 'CVE-2026-3333',
      dateAdded: '2026-06-01'
    },
    {
      // No cveID — must be dropped (unusable for the advisory list).
      vendorProject: 'NoCve',
      dateAdded: '2026-06-20'
    }
  ]
};

describe('parseKev', () => {
  it('maps fields, drops entries without a cveID, and tolerates missing fields', () => {
    const out = parseKev(catalog);
    expect(out).toHaveLength(3); // the no-cveID entry is dropped
    const byId = new Map(out.map((e) => [e.cveID, e]));
    expect(byId.get('CVE-2026-1111')).toMatchObject({
      vendorProject: 'Acme',
      product: 'Gadget',
      vulnerabilityName: 'Acme Gadget RCE',
      knownRansomwareCampaignUse: 'Known'
    });
    expect(byId.get('CVE-2026-3333')).toMatchObject({
      vendorProject: '',
      product: '',
      vulnerabilityName: '',
      shortDescription: '',
      knownRansomwareCampaignUse: ''
    });
  });

  it('flags ransomware use via the knownRansomwareCampaignUse string', () => {
    const out = parseKev(catalog);
    expect(out.find((e) => e.cveID === 'CVE-2026-1111')?.knownRansomwareCampaignUse).toBe('Known');
    expect(out.find((e) => e.cveID === 'CVE-2026-2222')?.knownRansomwareCampaignUse).toBe('Unknown');
  });

  it('sorts by dateAdded descending (newest first)', () => {
    const out = parseKev(catalog);
    expect(out.map((e) => e.cveID)).toEqual(['CVE-2026-2222', 'CVE-2026-1111', 'CVE-2026-3333']);
  });

  it('caps the entry count', () => {
    const big = { vulnerabilities: Array.from({ length: 2500 }, (_, i) => ({ cveID: `CVE-X-${i}`, dateAdded: '2026-01-01' })) };
    expect(parseKev(big).length).toBe(2000);
  });

  it('returns [] for a missing/garbage vulnerabilities array', () => {
    expect(parseKev({})).toEqual([]);
    expect(parseKev({ vulnerabilities: 'nope' })).toEqual([]);
    expect(parseKev(null)).toEqual([]);
  });

  it('never emits coordinates (KEV has no geography)', () => {
    const out = parseKev(catalog);
    for (const e of out) {
      expect(e).not.toHaveProperty('lat');
      expect(e).not.toHaveProperty('lon');
      expect(e).not.toHaveProperty('located');
    }
    // Field set is exactly the trimmed KevEntry view.
    expect(Object.keys(out[0]).sort()).toEqual(
      ['cveID', 'dateAdded', 'knownRansomwareCampaignUse', 'product', 'shortDescription', 'vendorProject', 'vulnerabilityName'].sort()
    );
  });
});
