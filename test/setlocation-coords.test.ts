import { describe, it, expect } from 'vitest';
import { parseCoordPair } from '../src/renderer/modules/eyespy/SetLocationDialog';

describe('parseCoordPair', () => {
  it('both blank ⇒ ok with no coords (clears)', () => {
    expect(parseCoordPair('', '')).toEqual({ ok: true });
    expect(parseCoordPair('   ', '  ')).toEqual({ ok: true });
  });
  it('exactly one blank ⇒ error', () => {
    expect(parseCoordPair('33.8', '').ok).toBe(false);
    expect(parseCoordPair('', '151.2').ok).toBe(false);
  });
  it('valid pair ⇒ ok with numbers', () => {
    expect(parseCoordPair('-33.86785', '151.20732')).toEqual({ ok: true, lat: -33.86785, lon: 151.20732 });
  });
  it('non-numeric ⇒ error', () => {
    expect(parseCoordPair('north', '151').ok).toBe(false);
  });
  it('lat out of range ⇒ error', () => {
    expect(parseCoordPair('500', '10').ok).toBe(false);
  });
  it('lon out of range ⇒ error', () => {
    expect(parseCoordPair('10', '999').ok).toBe(false);
  });
  it('trims surrounding whitespace', () => {
    expect(parseCoordPair('  10 ', ' 20 ')).toEqual({ ok: true, lat: 10, lon: 20 });
  });
  it('accepts the inclusive boundaries ±90 / ±180', () => {
    expect(parseCoordPair('90', '180')).toEqual({ ok: true, lat: 90, lon: 180 });
    expect(parseCoordPair('-90', '-180')).toEqual({ ok: true, lat: -90, lon: -180 });
  });
  it('rejects values just past the boundaries', () => {
    expect(parseCoordPair('90.0001', '0').ok).toBe(false);
    expect(parseCoordPair('-90.0001', '0').ok).toBe(false);
    expect(parseCoordPair('0', '180.0001').ok).toBe(false);
    expect(parseCoordPair('0', '-180.0001').ok).toBe(false);
  });
});
