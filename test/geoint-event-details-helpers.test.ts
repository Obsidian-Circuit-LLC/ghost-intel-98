import { describe, it, expect } from 'vitest';
import { resolveEventFields, deriveTags } from '../src/renderer/modules/geoint/event-details';
import type { GeoItem } from '../src/shared/post-mvp-types';

// Event Details Phase 1 — Task 3: pure display + tag helpers.
// These back the Overview dossier. HONESTY (charter): every field is a deterministic derivation of
// real item data — no fabricated numbers, no laundered provenance. `confidence` is surfaced as-is
// (never rewritten into an apparent-authority label); severity/color are transparent functions of
// the item's own `severity`/`category`/`eventType`.

// A war-tracker high-confidence strike (category stays 'chatter' — the low-authority signal is
// preserved; severity + military event-type drive the red/SEVERE, NOT a fabricated 'conflict' label).
const strike: GeoItem = {
  id: 'wartracker:1',
  sourceId: 'threat:wartracker',
  title: 'Coordinated strike near Mosul',
  located: 'geo',
  category: 'chatter',
  severity: 'high',
  eventType: 'Military Strike',
  detail: 'A coordinated airstrike was reported across three districts; missile impacts near the airport.',
  confidence: 'HIGH',
  country: 'IQ'
};

// A politics RSS item: no eventType/confidence/detail; category drives the label + color, low severity.
const politics: GeoItem = {
  id: 'rss:42',
  sourceId: 'feed:bbc',
  title: 'Cabinet reshuffle after election',
  located: 'gazetteer',
  place: 'London',
  country: 'GB',
  category: 'politics',
  severity: 'low',
  summary: 'The minister announced a reshuffle following the election.'
};

// The real category color map (mirrors MapGL CATEGORY_COLOR).
const RED = '#c0392b';
const POLITICS_COLOR = '#2980b9';

describe('resolveEventFields', () => {
  it('war-tracker high-confidence strike → red badge, SEVERE, event-type/detail/confidence surfaced', () => {
    const r = resolveEventFields(strike);
    expect(r.eventType).toBe('Military Strike');
    expect(r.detail).toBe(strike.detail);
    expect(r.severityLabel).toBe('SEVERE');
    expect(r.confidenceLabel).toBe('HIGH');
    expect(r.badgeColor).toBe(RED);
    expect(r.badgeLabel).toBe('MILITARY STRIKE');
  });

  it('politics RSS → category color, LOW, category-derived event type, summary fallback for detail', () => {
    const r = resolveEventFields(politics);
    expect(r.eventType).toBe('Politics');
    expect(r.detail).toBe(politics.summary);
    expect(r.severityLabel).toBe('LOW');
    expect(r.confidenceLabel).toBe('');
    expect(r.badgeColor).toBe(POLITICS_COLOR);
    expect(r.badgeLabel).toBe('POLITICS');
  });

  it('medium severity maps to MEDIUM; high non-conflict maps to HIGH (not SEVERE)', () => {
    const med = resolveEventFields({ ...politics, severity: 'medium' });
    expect(med.severityLabel).toBe('MEDIUM');
    // high severity but a non-military politics item → HIGH, and (high) → red badge.
    const highPolitics = resolveEventFields({ ...politics, severity: 'high' });
    expect(highPolitics.severityLabel).toBe('HIGH');
    expect(highPolitics.badgeColor).toBe(RED);
  });

  it('bare item (no eventType/category/detail) → EVENT badge, LOW, empty detail, neutral color', () => {
    const bare: GeoItem = { id: 'x', sourceId: 's', title: 'Untitled', located: 'none' };
    const r = resolveEventFields(bare);
    expect(r.badgeLabel).toBe('EVENT');
    expect(r.severityLabel).toBe('LOW');
    expect(r.detail).toBe('');
    expect(r.confidenceLabel).toBe('');
    // no category → neutral grey fallback, never red (severity undefined).
    expect(r.badgeColor).toBe('#7f8c8d');
  });
});

describe('deriveTags', () => {
  it('war-tracker strike → includes event-type words, matched vocab, and country (lowercased, deduped, capped)', () => {
    const tags = deriveTags(strike);
    expect(tags).toContain('military');
    expect(tags).toContain('strike');
    expect(tags).toContain('iq');
    // matched conflict vocab from the detail
    expect(tags).toContain('airstrike');
    // all lowercase, no dupes, capped at 8
    expect(tags.every((t) => t === t.toLowerCase())).toBe(true);
    expect(new Set(tags).size).toBe(tags.length);
    expect(tags.length).toBeLessThanOrEqual(8);
  });

  it('politics RSS → includes category + matched vocab + country', () => {
    const tags = deriveTags(politics);
    expect(tags).toContain('politics');
    expect(tags).toContain('election');
    expect(tags).toContain('gb');
  });

  it('bare item yields no tags', () => {
    expect(deriveTags({ id: 'x', sourceId: 's', title: 'Untitled', located: 'none' })).toEqual([]);
  });
});
