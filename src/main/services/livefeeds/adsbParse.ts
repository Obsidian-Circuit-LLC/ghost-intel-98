/** Pure parser for the adsb.lol /v2 radius response (ADSBExchange-v2 schema). Never throws.
 *  Duplicated from renderer/modules/geoint/livefeeds/adsbParse.ts so that main-process
 *  services can import without crossing the main/renderer tsconfig boundary.
 *  Keep in sync with the renderer copy. */
import type { AircraftPos, AltBand } from './types';

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const goodLat = (n: unknown): n is number => finite(n) && n >= -90 && n <= 90;
const goodLon = (n: unknown): n is number => finite(n) && n >= -180 && n <= 180;

function band(altFt: number | null): AltBand {
  if (altFt === null) return 'ground';
  if (altFt < 10000) return 'low';
  if (altFt <= 30000) return 'mid';
  return 'high';
}

export function parseAdsb(json: unknown): AircraftPos[] {
  const ac = (json as { ac?: unknown })?.ac;
  if (!Array.isArray(ac)) return [];
  const out: AircraftPos[] = [];
  for (const r of ac) {
    const a = r as Record<string, unknown>;
    if (!goodLat(a.lat) || !goodLon(a.lon) || typeof a.hex !== 'string') continue;
    const altFt = a.alt_baro === 'ground' ? null : finite(a.alt_baro) ? a.alt_baro : null;
    const trackDeg = finite(a.track) ? a.track : finite(a.true_heading) ? a.true_heading : null;
    out.push({
      id: a.hex,
      callsign: typeof a.flight === 'string' && a.flight.trim() ? a.flight.trim() : null,
      lat: a.lat, lon: a.lon,
      altFt,
      gsKt: finite(a.gs) ? a.gs : null,
      trackDeg,
      band: band(altFt)
    });
  }
  return out;
}
