import { describe, it, expect } from 'vitest';
import type { GeoItem } from '../src/shared/post-mvp-types';

// Event Details Phase 1 — Task 1: the GeoItem model carries the (optional, additive) dossier
// fields that the war-tracker feed already fetches and currently discards. This is a compile/shape
// test: the real gate is `pnpm typecheck` (esbuild strips types at runtime, so the assertions below
// only confirm the values round-trip). Before the fields exist on GeoItem, typecheck FAILS.
describe('GeoItem event-details fields (optional, additive)', () => {
  it('carries detail/eventType/confidence/country/hasMedia/isVideo when present', () => {
    const full: GeoItem = {
      id: 'wartracker:1',
      sourceId: 'threat:wartracker',
      title: 'Coordinated strike near Mosul',
      located: 'geo',
      detail: 'A coordinated strike was reported across three districts.',
      eventType: 'Military Strike',
      confidence: 'HIGH',
      country: 'IQ',
      hasMedia: true,
      isVideo: true
    };
    expect(full.detail).toBe('A coordinated strike was reported across three districts.');
    expect(full.eventType).toBe('Military Strike');
    expect(full.confidence).toBe('HIGH');
    expect(full.country).toBe('IQ');
    expect(full.hasMedia).toBe(true);
    expect(full.isVideo).toBe(true);
  });

  it('remains back-compatible: an item without any new field compiles and renders', () => {
    const minimal: GeoItem = {
      id: 'rss:42',
      sourceId: 'feed:bbc',
      title: 'Politics headline',
      located: 'none'
    };
    expect(minimal.detail).toBeUndefined();
    expect(minimal.eventType).toBeUndefined();
    expect(minimal.confidence).toBeUndefined();
    expect(minimal.country).toBeUndefined();
    expect(minimal.hasMedia).toBeUndefined();
    expect(minimal.isVideo).toBeUndefined();
  });
});
