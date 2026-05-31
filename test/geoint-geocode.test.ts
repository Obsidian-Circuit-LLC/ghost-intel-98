import { describe, it, expect } from 'vitest';
import { makeGeocoder } from '../src/main/geoint/geocode';

// v1 gazetteer is country-level (see scripts/gen-gazetteer.cjs). South Sudan/Sudan
// exercise the longest-name rule on real data shapes.
const gaz = [
  { name: 'Sudan', lat: 15, lon: 30 },
  { name: 'South Sudan', lat: 7, lon: 30 },
  { name: 'Mali', lat: 17, lon: -4 },
  { name: 'France', lat: 46, lon: 2 }
];
const geocode = makeGeocoder(gaz);

describe('geocode (gazetteer match)', () => {
  it('matches a place name in free text', () => {
    expect(geocode('Unrest reported across France today')).toEqual({ lat: 46, lon: 2, name: 'France' });
  });
  it('prefers the longest name match (South Sudan over Sudan)', () => {
    expect(geocode('clashes in South Sudan today')).toEqual({ lat: 7, lon: 30, name: 'South Sudan' });
  });
  it('is whole-word + case-insensitive (no substring false hits)', () => {
    expect(geocode('the malimba festival')).toBeNull(); // "Mali" must not match inside "malimba"
    expect(geocode('news from MALI')).toEqual({ lat: 17, lon: -4, name: 'Mali' });
  });
  it('returns null when nothing matches', () => {
    expect(geocode('local weather update')).toBeNull();
  });
  it('is deterministic across calls', () => {
    expect(geocode('clashes in South Sudan')).toEqual(geocode('clashes in South Sudan'));
  });
});
