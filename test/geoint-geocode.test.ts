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

// FIX 2 regression set. The gen-time blocklist (scripts/gen-gazetteer.cjs) drops common
// single-token English words ("Reading", "Best", "Most", "Male", "Police", "Split", "Nice",
// "March"). Defense-in-depth: even if such a word survives, the matcher's capitalization gate
// requires a single-token match to be Capitalized in the ORIGINAL text (a proper-noun signal),
// so lowercase common words in ordinary prose never geocode. These entries simulate a residual
// survivor ("Reading") and a clean multi-token name to prove the gate's case-sensitivity.
const capGaz: GazEntry[] = [
  { name: 'Reading', lat: 51.45, lon: -0.97 },
  { name: 'Mariupol', lat: 47.1, lon: 37.5 },
  { name: 'New York', lat: 40.71, lon: -74.0 }
];
const capGeocode = makeGeocoder(capGaz);

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

  describe('capitalization gate (FIX 2): single-token match must be Capitalized in original text', () => {
    it('lowercase common word does NOT geocode ("officials were reading the report")', () => {
      // Red-team false positive: "reading" lowercase is prose, not the city Reading.
      expect(capGeocode('officials were reading the report')).toBeNull();
    });

    it('lowercase "male" does NOT geocode ("the suspect is a male")', () => {
      // Even with a "Male" survivor, lowercase usage is rejected; here no entry so null anyway.
      expect(capGeocode('the suspect is a male')).toBeNull();
    });

    it('Capitalized single-token survivor DOES geocode ("Reading was shelled")', () => {
      expect(capGeocode('Reading was shelled overnight')).toEqual({ lat: 51.45, lon: -0.97, name: 'Reading' });
    });

    it('a genuine city still resolves ("shelling in Mariupol")', () => {
      expect(capGeocode('shelling in Mariupol')).toEqual({ lat: 47.1, lon: 37.5, name: 'Mariupol' });
    });

    it('lowercase genuine single-token city in prose is rejected by the gate', () => {
      // "mariupol" lowercase is not a proper-noun signal; gate rejects single-token.
      expect(capGeocode('we drove through mariupol yesterday')).toBeNull();
    });

    it('multi-token names skip the cap-gate (lowercase "new york" still resolves)', () => {
      expect(capGeocode('unrest in new york overnight')).toEqual({ lat: 40.71, lon: -74.0, name: 'New York' });
    });
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
