// test/eyespy-tree.test.ts
import { describe, it, expect } from 'vitest';
import { buildTree } from '../src/renderer/modules/eyespy/tree';
import { filterTree, matchStream } from '../src/renderer/modules/eyespy/tree';
import { findNode } from '../src/renderer/modules/eyespy/tree';
import type { CameraStream } from '../src/shared/post-mvp-types';
import { countryFlag, citiesOf } from '../src/renderer/modules/eyespy/tree';

const s = (id: string, geo: Partial<CameraStream>): CameraStream => ({
  id, label: id, url: `https://cam/${id}.m3u8`, kind: 'hls', caseId: null, addedAt: '', notes: '', ...geo
});

describe('buildTree', () => {
  it('nests US three-level (country→region→city) and UK two-level (country→city)', () => {
    const tree = buildTree([
      s('a', { country: 'United States', region: 'Texas', city: 'Dallas' }),
      s('b', { country: 'United States', region: 'Texas', city: 'Austin' }),
      s('c', { country: 'United Kingdom', city: 'London' })
    ]);
    const us = tree.find((n) => n.label === 'United States')!;
    expect(us.level).toBe('country');
    expect(us.count).toBe(2);
    const tx = us.children.find((n) => n.label === 'Texas')!;
    expect(tx.level).toBe('region');
    expect(tx.children.map((c) => c.label)).toEqual(['Austin', 'Dallas']);
    const uk = tree.find((n) => n.label === 'United Kingdom')!;
    expect(uk.children.map((c) => c.label)).toEqual(['London']);
    expect(uk.children[0].level).toBe('city');
  });

  it('rolls counts up and buckets country-less streams under Ungeocoded (always last)', () => {
    const tree = buildTree([
      s('a', { country: 'France', city: 'Paris' }),
      s('z', {})
    ]);
    expect(tree.map((n) => n.label)).toEqual(['France', 'Ungeocoded']);
    expect(tree.find((n) => n.label === 'Ungeocoded')!.count).toBe(1);
  });

  it('a node streamIds includes every stream at or below it', () => {
    const tree = buildTree([
      s('a', { country: 'US', region: 'Texas', city: 'Dallas' }),
      s('b', { country: 'US', region: 'Texas' })
    ]);
    const us = tree.find((n) => n.label === 'US')!;
    expect([...us.streamIds].sort()).toEqual(['a', 'b']);
    const tx = us.children.find((n) => n.label === 'Texas')!;
    expect([...tx.streamIds].sort()).toEqual(['a', 'b']);
    expect(tx.children.map((c) => c.label)).toEqual(['Dallas']);
  });
});

describe('filterTree', () => {
  const streams = [
    s('a', { country: 'United States', region: 'Texas', city: 'Dallas' }),
    s('b', { country: 'United Kingdom', city: 'London' })
  ];
  const tree = buildTree(streams);

  it('empty query returns the tree unchanged', () => {
    expect(filterTree(tree, streams, '')).toBe(tree);
  });
  it('prunes to branches matching on city/region/country/url, case-insensitive', () => {
    const r = filterTree(tree, streams, 'dallas');
    expect(r.map((n) => n.label)).toEqual(['United States']);
    expect(r[0].children[0].label).toBe('Texas');
  });
  it('matchStream hits label/city/region/country/url', () => {
    expect(matchStream(streams[1], 'london')).toBe(true);
    expect(matchStream(streams[1], 'cam/b')).toBe(true);
    expect(matchStream(streams[1], 'texas')).toBe(false);
  });
});

describe('node geo fields + key safety', () => {
  it('city node carries country/region/city; UK city has no region; Ungeocoded has no country', () => {
    const tree = buildTree([
      s('a', { country: 'United States', region: 'Texas', city: 'Dallas' }),
      s('b', { country: 'United Kingdom', city: 'London' }),
      s('z', {})
    ]);
    const dallas = findNode(tree, tree.find((n) => n.label === 'United States')!.children[0].children[0].key)!;
    expect({ country: dallas.country, region: dallas.region, city: dallas.city }).toEqual({ country: 'United States', region: 'Texas', city: 'Dallas' });
    const london = buildTree([s('b', { country: 'United Kingdom', city: 'London' })])[0].children[0];
    expect(london.country).toBe('United Kingdom');
    expect(london.region).toBeUndefined();
    expect(tree.find((n) => n.label === 'Ungeocoded')!.country).toBeUndefined();
  });
  it('a country name containing a slash does not corrupt its node geo', () => {
    const tree = buildTree([s('a', { country: 'Bosnia/Herzegovina', city: 'Sarajevo' })]);
    expect(tree[0].country).toBe('Bosnia/Herzegovina');
    expect(tree[0].children[0].city).toBe('Sarajevo');
  });
  it('findNode locates a nested node by key', () => {
    const tree = buildTree([s('a', { country: 'US', region: 'Texas', city: 'Dallas' })]);
    const tx = tree[0].children[0];
    expect(findNode(tree, tx.key)).toBe(tx);
  });
});

describe('finder helpers', () => {
  const mk = (id: string, geo: Partial<CameraStream>): CameraStream => ({ id, label: id, url: `https://c/${id}`, kind: 'hls', caseId: null, addedAt: '', notes: '', ...geo });
  it('countryFlag maps known names (case-insensitive) to emoji, unknown to empty', () => {
    expect(countryFlag('United Kingdom')).toBe('🇬🇧');
    expect(countryFlag('united states')).toBe('🇺🇸');
    expect(countryFlag('Ungeocoded')).toBe('');
    expect(countryFlag(undefined)).toBe('');
  });
  it('citiesOf returns a flat, deduped, alpha-sorted city list with counts', () => {
    const cities = citiesOf([
      mk('a', { country: 'United States', region: 'Texas', city: 'Dallas' }),
      mk('b', { country: 'United States', region: 'Texas', city: 'Dallas' }),
      mk('c', { country: 'United Kingdom', city: 'London' }),
      mk('d', {})
    ]);
    expect(cities.map((c) => c.city)).toEqual(['Dallas', 'London']);
    expect(cities[0].count).toBe(2);
    expect(cities[1].country).toBe('United Kingdom');
  });
});
