import { describe, it, expect } from 'vitest';
import { parseDohA, parseDohPtr, parseIpRdap } from '../src/main/services/hostinfo/parse';

describe('parseDohA', () => {
  it('returns A-record IPs (type 1) and ignores other types', () => {
    expect(parseDohA({ Answer: [{ type: 1, data: '1.2.3.4' }, { type: 5, data: 'cname.example.' }, { type: 1, data: '5.6.7.8' }] })).toEqual(['1.2.3.4', '5.6.7.8']);
  });
  it('returns [] for no Answer / malformed', () => {
    expect(parseDohA({})).toEqual([]);
    expect(parseDohA('nope')).toEqual([]);
  });
});

describe('parseDohPtr', () => {
  it('returns the first PTR (type 12) hostname with the trailing dot stripped', () => {
    expect(parseDohPtr({ Answer: [{ type: 12, data: 'host149.telecom.com.ar.' }] })).toBe('host149.telecom.com.ar');
  });
  it('returns undefined when no PTR present', () => {
    expect(parseDohPtr({ Answer: [{ type: 1, data: '1.2.3.4' }] })).toBeUndefined();
    expect(parseDohPtr('nope')).toBeUndefined();
  });
});

describe('parseIpRdap', () => {
  it('extracts org (vcard fn), country, range, and asn', () => {
    const json = {
      handle: '190.210.0.0 - 190.210.255.255',
      startAddress: '190.210.0.0', endAddress: '190.210.255.255',
      country: 'AR',
      arin_originas0_originautnums: [7303],
      entities: [{ roles: ['registrant'], vcardArray: ['vcard', [['version', {}, 'text', '4.0'], ['fn', {}, 'text', 'Telecom Argentina S.A.']]] }]
    };
    expect(parseIpRdap(json)).toEqual({ org: 'Telecom Argentina S.A.', asn: 'AS7303', country: 'AR', range: '190.210.0.0 - 190.210.255.255' });
  });
  it('omits fields it cannot find; never throws on malformed input', () => {
    expect(parseIpRdap({})).toEqual({});
    expect(parseIpRdap('nope')).toEqual({});
  });
  it('derives range from start/end when handle is absent', () => {
    expect(parseIpRdap({ startAddress: '5.0.0.0', endAddress: '5.0.0.255' }).range).toBe('5.0.0.0 - 5.0.0.255');
  });
});
