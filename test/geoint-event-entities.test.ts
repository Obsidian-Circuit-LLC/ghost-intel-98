import { describe, it, expect } from 'vitest';
import { deriveEntities } from '../src/renderer/modules/geoint/event-details';
import type { GeoItem } from '../src/shared/post-mvp-types';

const mk = (o: Partial<GeoItem> & { id: string }): GeoItem =>
  ({ sourceId: 's', title: o.id, located: 'none', ...o } as GeoItem);

describe('deriveEntities', () => {
  it('lists place then country, deduped', () => {
    const e = deriveEntities(mk({ id: 'T', title: 'x', place: 'Kyiv', country: 'Ukraine' }));
    expect(e.places).toEqual(['Kyiv', 'Ukraine']);
  });

  it('extracts multi-word proper nouns, dropping a leading start-stopword', () => {
    const e = deriveEntities(mk({ id: 'T', title: 'Report', detail: 'The United Nations condemned the attack.' }));
    expect(e.mentions).toContain('United Nations');
    expect(e.mentions).not.toContain('The United Nations');
  });

  it('drops a sentence-initial single capitalized word but keeps a mid-sentence one', () => {
    const e = deriveEntities(mk({ id: 'T', title: 'x', detail: 'Strikes hit Mariupol overnight.' }));
    expect(e.mentions).toContain('Mariupol');
    expect(e.mentions).not.toContain('Strikes');
  });

  it('excludes mentions already listed as places and caps at 10', () => {
    const body = Array.from({ length: 14 }, (_, n) => `sentence ${n} mentions Alpha${String.fromCharCode(65 + n)}`).join('. ');
    const e = deriveEntities(mk({ id: 'T', title: 'x', place: 'Kyiv', detail: `Near Kyiv, ${body}.` }));
    expect(e.mentions).not.toContain('Kyiv');            // already a place
    expect(e.mentions.length).toBeLessThanOrEqual(10);
  });

  it('is deterministic', () => {
    const item = mk({ id: 'T', title: 'x', detail: 'Forces near Bakhmut and Soledar advanced.' });
    expect(deriveEntities(item)).toEqual(deriveEntities(item));
  });

  it('does NOT turn a Title-Case / ALL-CAPS headline into one bogus entity (title excluded)', () => {
    const e = deriveEntities(mk({ id: 'T', title: 'US Military Strike Near The Airport', detail: 'Forces advanced near Bakhmut.' }));
    expect(e.mentions).not.toContain('US Military Strike Near The Airport');
    expect(e.mentions).toContain('Bakhmut');   // real proper noun from prose still surfaces
  });

  it('skips an over-long capitalized run rather than emitting a fabricated compound', () => {
    const e = deriveEntities(mk({ id: 'T', title: 'x', detail: 'Then Alpha Bravo Charlie Delta Echo Foxtrot moved.' }));
    expect(e.mentions.every((m) => m.split(' ').length <= 5)).toBe(true);
  });
});
