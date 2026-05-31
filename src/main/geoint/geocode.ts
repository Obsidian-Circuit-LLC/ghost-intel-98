/**
 * Offline gazetteer geocoder for GeoINT. Matches the LONGEST gazetteer place name that
 * occurs as a whole word (case-insensitive) in the given text. Deterministic: entries
 * are pre-sorted by descending name length, ties broken by name, so the same input always
 * yields the same coordinate. No network, no geocoding service.
 */

export interface GazEntry { name: string; lat: number; lon: number }
export type Geocoder = (text: string) => { lat: number; lon: number; name: string } | null;

export function makeGeocoder(entries: GazEntry[]): Geocoder {
  const sorted = [...entries].sort((a, b) => b.name.length - a.name.length || a.name.localeCompare(b.name));
  const prepared = sorted.map((e) => ({
    e,
    // Whole-word match (Unicode letter boundaries) so "Mali" does not match "malimba".
    re: new RegExp(`(?:^|[^\\p{L}])${e.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}])`, 'iu')
  }));
  return (text: string) => {
    if (!text) return null;
    for (const { e, re } of prepared) {
      if (re.test(text)) return { lat: e.lat, lon: e.lon, name: e.name };
    }
    return null;
  };
}
