/**
 * Offline gazetteer geocoder for GeoINT. Phrase-index lookup: the text is tokenized into
 * Unicode letter-runs, and every contiguous run of up to maxWords tokens is probed against
 * a normalized place-name index. Matches the LONGEST gazetteer place name that occurs as a
 * whole word (case-insensitive) in the text. Deterministic (first index insertion wins on a
 * normalized collision; longest phrase wins overall). No network, no geocoding service.
 *
 * O(words · maxWords) per call instead of O(entries) — scales to ~50k entries, unlike the
 * previous per-entry RegExp scan.
 */

export interface GazEntry { name: string; lat: number; lon: number }
export type Geocoder = (text: string) => { lat: number; lon: number; name: string } | null;

function norm(s: string): string { return (s.toLowerCase().match(/\p{L}+/gu) ?? []).join(' '); }

export function makeGeocoder(entries: GazEntry[]): Geocoder {
  const index = new Map<string, GazEntry>();
  let maxWords = 1;
  for (const e of entries) {
    const key = norm(e.name);
    if (!key) continue;
    if (!index.has(key)) index.set(key, e);
    const w = key.split(' ').length;
    if (w > maxWords) maxWords = w;
  }
  return (text) => {
    const words = text ? (text.toLowerCase().match(/\p{L}+/gu) ?? []) : [];
    let best: GazEntry | null = null; let bestLen = 0;
    for (let i = 0; i < words.length; i++) {
      for (let n = Math.min(maxWords, words.length - i); n >= 1; n--) {
        const phrase = words.slice(i, i + n).join(' ');
        const hit = index.get(phrase);
        if (hit) { if (phrase.length > bestLen) { best = hit; bestLen = phrase.length; } break; }
      }
    }
    return best ? { lat: best.lat, lon: best.lon, name: best.name } : null;
  };
}
