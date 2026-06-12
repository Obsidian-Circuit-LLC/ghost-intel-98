// test/eyespy-tree.test.ts
import { describe, it, expect } from 'vitest';
import { buildTree } from '../src/renderer/modules/eyespy/tree';
import { filterTree, matchStream } from '../src/renderer/modules/eyespy/tree';
import type { CameraStream } from '../src/shared/post-mvp-types';

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
