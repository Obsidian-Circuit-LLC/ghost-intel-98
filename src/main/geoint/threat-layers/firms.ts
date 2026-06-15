/**
 * NASA FIRMS active-fire threat layer (KEYED). Stateless: fetch the public FIRMS area CSV endpoint
 * and map it to GeoItem[]. NOT persisted to the secure-fs cache — threat layers are on-demand/
 * ephemeral, held only in renderer state while their toggle is on. Egress is gated by the IPC
 * handler (settings.geoint.networkEnabled); additionally KEY-gated — the MAP_KEY is read main-side
 * from secretStore and the fetch refuses (returns []) if absent.
 *
 * Endpoint: https://firms.modaps.eosdis.nasa.gov/api/area/csv/{MAP_KEY}/{SOURCE}/{AREA}/{DAY_RANGE}
 *   SOURCE  default VIIRS_SNPP_NRT (allowlisted set below — interpolated into the path so it MUST
 *           be allowlisted; an arbitrary token is path injection into the URL).
 *   AREA    default "world" (or a "west,south,east,north" bbox).
 *   DAY_RANGE default 1 (1..5 per docs).
 *
 * SCHEMA SOURCE — built to NASA's published VIIRS active-fire attribute table; NOT live-verified
 * with a key (we have no MAP_KEY). Docs read 2026-06-15:
 *   - Endpoint format + SOURCE list + AREA/"world" + DAY_RANGE 1..5:
 *       https://firms.modaps.eosdis.nasa.gov/api/area/
 *   - VIIRS 375m attribute names (Latitude, Longitude, Bright_ti4, Scan, Track, Acq_Date, Acq_Time,
 *     Satellite, Confidence, Version, Bright_ti5, FRP, DayNight):
 *       https://www.earthdata.nasa.gov/data/tools/firms/active-fire-data-attributes-modis-viirs
 *     (The live NRT CSV export header is lowercased and includes an `instrument` column between
 *      `satellite` and `confidence`; VIIRS NRT `confidence` is the letter scheme l/n/h. We index by
 *      HEADER NAME, not position, so an extra/absent column doesn't misalign the parse.)
 * Licence: NASA FIRMS — open, cite-on-use. Attribution surfaced in the renderer as "NASA FIRMS".
 */

import type { GeoItem } from '@shared/post-mvp-types';
import { strictNum, inRange } from '../feeds';
import { safeFetch } from '../../net/safe-fetch';
import { readTextCapped } from '../../net/limits';

// Cap mapped items so a pathological feed can't bloat renderer state (mirrors feeds.ts MAX_FEED_ITEMS).
const MAX_FIRMS_ITEMS = 2000;

/** Allowlisted FIRMS SOURCE (sensor) tokens. The token is interpolated into the endpoint path, so
 *  it MUST be allowlisted — an arbitrary token is path injection into the URL. */
export const FIRMS_SOURCES = [
  'VIIRS_SNPP_NRT', 'VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT',
  'MODIS_NRT', 'LANDSAT_NRT'
] as const;
export type FirmsSource = (typeof FIRMS_SOURCES)[number];
export const DEFAULT_FIRMS_SOURCE: FirmsSource = 'VIIRS_SNPP_NRT';

/** True iff `source` is an allowlisted FIRMS sensor token. */
export function isFirmsSource(source: unknown): source is FirmsSource {
  return typeof source === 'string' && (FIRMS_SOURCES as readonly string[]).includes(source);
}

/** Split one CSV line, honouring double-quoted fields (RFC-4180-ish: "" is an escaped quote). FIRMS
 *  rows are plain numeric/short-token fields, but quoting the splitter keeps a comma inside a quoted
 *  field (defensive) from shifting every later column. No external CSV dep in the main bundle. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQ = false; }
      } else { cur += ch; }
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ',') {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/** FIRMS confidence → severity. VIIRS NRT uses letters l/n/h; MODIS uses a 0..100 number. High
 *  confidence (h / >=80) → high; nominal (n / 30..79) → medium; low (l / <30) / missing → low. */
function severityForConfidence(conf: string): GeoItem['severity'] {
  const s = conf.trim().toLowerCase();
  if (s === 'h' || s === 'high') return 'high';
  if (s === 'n' || s === 'nominal') return 'medium';
  if (s === 'l' || s === 'low') return 'low';
  const n = strictNum(s);
  if (Number.isFinite(n)) {
    if (n >= 80) return 'high';
    if (n >= 30) return 'medium';
  }
  return 'low';
}

/** Pure parse: FIRMS area CSV text → GeoItem[]. No IO, so unit-testable without network/key. Indexes
 *  columns BY HEADER NAME (case-insensitive) so an extra/absent column (e.g. MODIS has no `instrument`)
 *  never misaligns lat/lon. Drops rows with out-of-range/NaN coordinates (no silent (0,0) pins). */
export function parseFirms(csv: string): GeoItem[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const col = (name: string): number => header.indexOf(name);
  const iLat = col('latitude');
  const iLon = col('longitude');
  const iDate = col('acq_date');
  const iTime = col('acq_time');
  const iConf = col('confidence');
  const iFrp = col('frp');
  if (iLat < 0 || iLon < 0) return []; // unrecognised schema → no silent mislocation
  const out: GeoItem[] = [];
  for (let r = 1; r < lines.length; r++) {
    if (out.length >= MAX_FIRMS_ITEMS) break;
    const cells = splitCsvLine(lines[r]);
    const lat = strictNum(cells[iLat]);
    const lon = strictNum(cells[iLon]);
    if (!inRange(lat, lon)) continue; // coordinate-integrity guard: never a silent (0,0)/off-globe pin
    const acqDate = iDate >= 0 ? (cells[iDate] ?? '').trim() : '';
    const acqTime = iTime >= 0 ? (cells[iTime] ?? '').trim() : '';
    // FIRMS detections have no per-row id; the stable key is (lat,lon,date,time) — the same detection
    // re-fetched yields the same id (safe de-dupe). Coords are already finite + on-globe here.
    const id = `firms:${lat},${lon},${acqDate},${acqTime}`;
    // acq_time is "HHMM" (UTC) — compose an ISO-ish published string when both date+time present.
    let published: string | undefined;
    if (acqDate) {
      if (/^\d{3,4}$/.test(acqTime)) {
        const hhmm = acqTime.padStart(4, '0');
        published = `${acqDate}T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00Z`;
      } else {
        published = acqDate;
      }
    }
    const conf = iConf >= 0 ? (cells[iConf] ?? '') : '';
    // FRP (fire radiative power, MW) escalates a nominal detection — a very energetic fire is high.
    const frp = iFrp >= 0 ? strictNum(cells[iFrp]) : NaN;
    let severity = severityForConfidence(conf);
    if (Number.isFinite(frp) && frp >= 100) severity = 'high';
    out.push({
      id,
      sourceId: 'threat:firms',
      title: 'Active fire',
      published,
      lat,
      lon,
      located: 'geo',
      category: 'disaster',
      severity
    });
  }
  return out;
}

/** Build the FIRMS area CSV URL. `source` is allowlisted (path injection guard); `area` is "world"
 *  or a validated "w,s,e,n" bbox; `dayRange` is bounded to 1..5. The MAP_KEY is interpolated into
 *  the path — callers MUST pass a non-empty key (never logged). */
export function buildFirmsUrl(mapKey: string, opts: { source?: string; area?: string; dayRange?: number }): string {
  const source: FirmsSource = isFirmsSource(opts?.source) ? opts.source : DEFAULT_FIRMS_SOURCE;
  const dr = Number.isFinite(opts?.dayRange) ? Math.max(1, Math.min(Math.floor(opts!.dayRange!), 5)) : 1;
  // AREA: "world", or a bounding box of four finite numbers "west,south,east,north". Anything else
  // falls back to "world" so a hostile value can't inject extra path segments.
  let area = 'world';
  const raw = typeof opts?.area === 'string' ? opts.area.trim() : '';
  if (raw && raw.toLowerCase() !== 'world') {
    const parts = raw.split(',');
    if (parts.length === 4 && parts.every((p) => Number.isFinite(strictNum(p)))) {
      area = parts.map((p) => strictNum(p)).join(',');
    }
  }
  // MAP_KEY is a FIRMS-issued alphanumeric token; encodeURIComponent is belt-and-braces against any
  // stray path char. The other segments are allowlisted/validated above.
  const key = encodeURIComponent(mapKey);
  return `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/${source}/${area}/${dr}`;
}

/** Fetch + parse one FIRMS area CSV. `mapKey` is read main-side from secretStore by the caller and
 *  MUST be non-empty (the handler refuses absent keys before calling this). Throws on network/HTTP
 *  failure. The MAP_KEY is never logged — it lives only in the URL string passed to safeFetch. */
export async function fetchFirms(mapKey: string, opts: { source?: string; area?: string; dayRange?: number }): Promise<GeoItem[]> {
  if (!mapKey) return []; // key-gate (defence in depth; the handler also gates)
  const url = buildFirmsUrl(mapKey, opts);
  const res = await safeFetch(url, 4, { Accept: 'text/csv' });
  if (!res.ok) throw new Error(`FIRMS HTTP ${res.status}`);
  return parseFirms(await readTextCapped(res));
}
