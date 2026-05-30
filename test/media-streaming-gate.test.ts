import { describe, it, expect } from 'vitest';
import { resolveSource, isHlsUrl } from '../src/renderer/modules/media/resolveSource';
import { ensureStationInput, ensureMediaRoot } from '../src/main/security/validate';

describe('streaming gate (app-layer)', () => {
  it('blocks remote URLs when streaming is off', () => {
    expect(resolveSource({ url: 'http://radio/stream' }, false)).toBeNull();
  });
  it('allows remote URLs when streaming is on', () => {
    expect(resolveSource({ url: 'https://radio/s' }, true)).toEqual({ kind: 'stream', src: 'https://radio/s' });
  });
  it('always allows local tracks (never egress), regardless of the toggle', () => {
    expect(resolveSource({ path: '/m/a.mp3' }, false)).toEqual({ kind: 'local', src: 'ga98media://track/%2Fm%2Fa.mp3' });
  });
  it('detects HLS manifests', () => {
    expect(isHlsUrl('https://x/y/stream.m3u8')).toBe(true);
    expect(isHlsUrl('https://x/y/stream.mp3')).toBe(false);
  });
});

describe('station + root validators', () => {
  it('accepts http/https with a bounded label', () => {
    expect(ensureStationInput({ label: 'SomaFM', url: 'https://ice.somafm.com/x' }).url).toMatch(/^https?:/);
  });
  it('rejects non-http schemes', () => {
    expect(() => ensureStationInput({ label: 'x', url: 'file:///etc/passwd' })).toThrow();
    expect(() => ensureStationInput({ label: 'x', url: 'javascript:alert(1)' })).toThrow();
  });
  it('rejects empty/oversized labels', () => {
    expect(() => ensureStationInput({ label: '', url: 'http://a/b' })).toThrow();
    expect(() => ensureStationInput({ label: 'z'.repeat(200), url: 'http://a/b' })).toThrow();
  });
  it('ensureMediaRoot rejects non-strings', () => {
    expect(() => ensureMediaRoot(42)).toThrow();
    expect(ensureMediaRoot('/music')).toBe('/music');
  });
});
