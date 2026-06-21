// test/sat-tle.test.ts
import { describe, it, expect } from 'vitest';
import { parseTleText, validateTlePair } from '../src/renderer/modules/geoint/satellites/tle';

const ISS_L1 = '1 25544U 98067A   24079.07757601  .00016717  00000-0  30532-3 0  9993';
const ISS_L2 = '2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.49815308434500';

describe('parseTleText', () => {
  it('parses a 3-line (named) TLE block into one record', () => {
    const recs = parseTleText(`ISS (ZARYA)\n${ISS_L1}\n${ISS_L2}\n`);
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ name: 'ISS (ZARYA)', noradId: 25544, type: 'station', source: 'celestrak', active: true });
    expect(recs[0].line1).toBe(ISS_L1);
    expect(recs[0].id).toBe('sat-25544');
  });
  it('parses a 2-line (unnamed) block, name falls back to the catalog number', () => {
    const recs = parseTleText(`${ISS_L1}\n${ISS_L2}`);
    expect(recs).toHaveLength(1);
    expect(recs[0].noradId).toBe(25544);
    expect(recs[0].name).toBe('25544');
  });
  it('skips malformed blocks without throwing', () => {
    expect(parseTleText('garbage\nnot a tle\n')).toEqual([]);
    expect(parseTleText('')).toEqual([]);
  });
});

describe('validateTlePair', () => {
  it('accepts a well-formed pair', () => {
    const r = validateTlePair('ISS', ISS_L1, ISS_L2);
    expect(r.ok).toBe(true);
  });
  it('rejects lines that do not start with 1 / 2', () => {
    const r = validateTlePair('X', 'nope', 'nope');
    expect(r).toEqual({ ok: false, error: expect.stringContaining('TLE') });
  });
});
