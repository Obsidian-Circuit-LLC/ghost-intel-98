import { describe, it, expect } from 'vitest';
import { makeGeocoder, type GazEntry } from '../src/main/geoint/geocode';

// The gazetteer is now city-rich (GeoNames cities5000 + country centroids, see
// scripts/gen-gazetteer.cjs). The geocoder is a phrase-index lookup that scales to
// ~50k entries while preserving longest-place-name-wins, whole-word, deterministic,
// no-network semantics.
const gaz: GazEntry[] = [
  { name: 'Mariupol', lat: 47.1, lon: 37.5 },
  { name: 'York', lat: 53.96, lon: -1.08 },
  { name: 'New York', lat: 40.71, lon: -74.0 },
  { name: "Coeur d'Alene", lat: 47.68, lon: -116.78 },
  { name: 'France', lat: 46, lon: 2 }
];
const geocode = makeGeocoder(gaz);

describe('geocode (phrase-index gazetteer match)', () => {
  it('matches a city named in free text', () => {
    expect(geocode('protests in Mariupol today')).toEqual({ lat: 47.1, lon: 37.5, name: 'Mariupol' });
  });

  it('prefers the longer name when both "York" and "New York" are entries', () => {
    expect(geocode('unrest in New York overnight')).toEqual({ lat: 40.71, lon: -74.0, name: 'New York' });
  });

  it('plain "York" still resolves to York', () => {
    expect(geocode('flooding near York city centre')).toEqual({ lat: 53.96, lon: -1.08, name: 'York' });
  });

  it("matches an apostrophe name (Coeur d'Alene)", () => {
    expect(geocode("wildfire near Coeur d'Alene Idaho")).toEqual({
      lat: 47.68,
      lon: -116.78,
      name: "Coeur d'Alene"
    });
  });

  it('is whole-word (no substring false hits)', () => {
    // "France" must not be matched inside a longer letter-run.
    expect(geocode('the francewood mill')).toBeNull();
  });

  it('returns null when nothing matches', () => {
    expect(geocode('local weather update')).toBeNull();
  });

  it('returns null on empty / whitespace input', () => {
    expect(geocode('')).toBeNull();
    expect(geocode('   ')).toBeNull();
  });

  it('is deterministic across calls', () => {
    expect(geocode('clashes in Mariupol')).toEqual(geocode('clashes in Mariupol'));
  });

  it('scales: 50k entries, geocode call well under 5ms (avg < 1ms over 100 calls)', () => {
    const big: GazEntry[] = [];
    for (let i = 0; i < 50000; i++) {
      big.push({ name: `SynthetTown${i}`, lat: (i % 180) - 90, lon: (i % 360) - 180 });
    }
    // Include a multi-word entry near the end so maxWords > 1 is exercised at scale.
    big.push({ name: 'New York', lat: 40.71, lon: -74.0 });
    const g = makeGeocoder(big);
    const text =
      'Breaking: officials in New York and several other places reported activity ' +
      'overnight while analysts reviewed the situation in detail this morning today.';
    // warm-up
    g(text);
    const N = 100;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) g(text);
    const avgMs = (performance.now() - t0) / N;
    expect(g(text)).toEqual({ lat: 40.71, lon: -74.0, name: 'New York' });
    expect(avgMs).toBeLessThan(1);
  });
});
