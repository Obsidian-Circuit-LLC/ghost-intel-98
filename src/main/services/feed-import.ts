/**
 * EyeSpy bulk feed import — parses a camera-feed list (JSON array, CSV, or a plain
 * one-URL-per-line text file) into normalized {label, url, kind, …optional geo} entries.
 * Pure: no IO.
 *
 * `kind` is inferred from the URL when not given; `label` is derived from the host when
 * not given. Entries without a recognizable URL are dropped. Deduped by URL.
 *
 * Optional geo metadata (country/region/city/lat/lon/source) is read from JSON objects AND from a
 * header-mapped CSV: when the first line is a header that names a URL column, columns are mapped by
 * name (alias-aware, order-independent) so geo columns import too. A header-less list (plain URLs or
 * positional CSV) stays geo-unaware — it can't reliably attribute unlabeled columns. Geo keys are
 * only emitted when actually present.
 */

import type { CameraStream, StreamKind } from '@shared/post-mvp-types';

export interface ParsedFeed {
  label: string;
  url: string;
  kind: StreamKind;
  // Optional geo metadata, present only when the source row supplied it. Absent keys are never
  // emitted, so a geo-less feed stays exactly { label, url, kind }.
  country?: string;
  region?: string;
  city?: string;
  lat?: number;
  lon?: number;
  source?: string;
}

const KINDS: readonly StreamKind[] = ['hls', 'mjpeg', 'rtsp', 'http', 'mp4'];
const URLISH = /^[a-z][a-z0-9+.-]*:\/\//i;

export function inferKind(url: string): StreamKind {
  const u = url.toLowerCase();
  if (u.startsWith('rtsp://')) return 'rtsp';
  if (u.includes('.m3u8')) return 'hls';
  if (u.includes('.mp4')) return 'mp4';
  if (/\.(jpg|jpeg|png|gif|bmp)(\?|#|$)/.test(u)) return 'http'; // single still image
  return 'mjpeg'; // most http(s) camera feeds are MJPEG
}

export function deriveLabel(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname || url;
  } catch {
    return url;
  }
}

function toFeed(rawUrl: string, label?: string, kind?: string): ParsedFeed {
  const url = rawUrl.trim();
  const k = kind && KINDS.includes(kind.toLowerCase() as StreamKind) ? (kind.toLowerCase() as StreamKind) : inferKind(url);
  return { url, kind: k, label: (label && label.trim()) || deriveLabel(url) };
}

/** Split one CSV line into fields, honoring double-quoted fields (with "" escapes). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else { field += c; }
    } else if (c === '"') { inQuotes = true; }
    else if (c === ',') { out.push(field); field = ''; }
    else { field += c; }
  }
  out.push(field);
  return out.map((f) => f.trim());
}

/** A trimmed non-empty string, else undefined. */
function asStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

/** A finite number from a number or a numeric string, else undefined (drops NaN/Infinity/''). */
function asNum(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** Pull optional geo metadata from a JSON feed object, accepting common key aliases. */
function extractGeo(o: Record<string, unknown>): Partial<ParsedFeed> {
  const g: Partial<ParsedFeed> = {};
  const country = asStr(o['country']);
  const region = asStr(o['region']) ?? asStr(o['state']);
  const city = asStr(o['city']);
  const lat = asNum(o['lat']) ?? asNum(o['latitude']);
  const lon = asNum(o['lon']) ?? asNum(o['lng']) ?? asNum(o['longitude']);
  const source = asStr(o['source']);
  if (country) g.country = country;
  if (region) g.region = region;
  if (city) g.city = city;
  if (lat !== undefined) g.lat = lat;
  if (lon !== undefined) g.lon = lon;
  if (source) g.source = source;
  return g;
}

/** From a row's fields, locate the URL, an optional explicit kind, and a label. */
function fieldsToFeed(fields: string[]): ParsedFeed | null {
  const url = fields.find((f) => URLISH.test(f));
  if (!url) return null;
  const kind = fields.find((f) => KINDS.includes(f.toLowerCase() as StreamKind));
  const label = fields.find((f) => f && f !== url && f !== kind);
  return toFeed(url, label, kind);
}

// Header-column aliases. Names are matched case-insensitively; the first column whose name is an
// alias of a field wins. `url` aliases mirror the JSON reader (url/URL/src/stream); the rest mirror
// extractGeo's geo aliases plus the label/kind names the positional path already understands.
type FeedColumn = 'url' | 'label' | 'kind' | 'country' | 'region' | 'city' | 'lat' | 'lon' | 'source';
const COLUMN_ALIASES: Record<FeedColumn, readonly string[]> = {
  url: ['url', 'src', 'stream', 'link', 'address'],
  label: ['label', 'name', 'title'],
  kind: ['kind', 'type', 'protocol'],
  country: ['country'],
  region: ['region', 'state', 'province'],
  city: ['city', 'town'],
  lat: ['lat', 'latitude'],
  lon: ['lon', 'lng', 'long', 'longitude'],
  source: ['source', 'provider', 'dataset']
};
type ColumnMap = Partial<Record<FeedColumn, number>>;

/** If `line` is a header row (no field is itself a URL) that names a URL column, return its
 *  name→index map (alias-aware, first match wins, order-independent). Otherwise null, so the caller
 *  falls back to the positional heuristic. */
function parseHeaderRow(line: string): ColumnMap | null {
  const names = splitCsvLine(line).map((f) => f.toLowerCase());
  if (names.some((n) => URLISH.test(n))) return null; // a real URL ⇒ this is data, not a header
  const map: ColumnMap = {};
  names.forEach((name, i) => {
    for (const col of Object.keys(COLUMN_ALIASES) as FeedColumn[]) {
      if (map[col] === undefined && COLUMN_ALIASES[col].includes(name)) { map[col] = i; break; }
    }
  });
  return map.url !== undefined ? map : null;
}

/** Build a feed from a CSV data row using a header column map; geo comes from the named columns and
 *  is emitted only when present + well-formed (asStr/asNum drop blanks and non-finite lat/lon). */
function mappedRowToFeed(fields: string[], map: ColumnMap): ParsedFeed | null {
  const at = (c: FeedColumn): string | undefined => {
    const i = map[c];
    return i !== undefined ? fields[i] : undefined;
  };
  const rawUrl = at('url');
  if (!rawUrl || !URLISH.test(rawUrl.trim())) return null;
  const feed = toFeed(rawUrl, at('label'), at('kind'));
  const geo: Partial<ParsedFeed> = {};
  const country = asStr(at('country')); if (country) geo.country = country;
  const region = asStr(at('region')); if (region) geo.region = region;
  const city = asStr(at('city')); if (city) geo.city = city;
  const lat = asNum(at('lat')); if (lat !== undefined) geo.lat = lat;
  const lon = asNum(at('lon')); if (lon !== undefined) geo.lon = lon;
  const source = asStr(at('source')); if (source) geo.source = source;
  return { ...feed, ...geo };
}

/** Parse CSV / plain-text. A header naming a URL column ⇒ a geo-aware header-mapped parse; otherwise
 *  the positional heuristic (URL/kind/label by shape), which stays geo-unaware. Skips #-comments and
 *  blank lines. A positional header row drops itself naturally (no field is a URL). */
function parseCsvOrText(text: string): ParsedFeed[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (lines.length === 0) return [];
  const header = parseHeaderRow(lines[0]);
  const rows = header ? lines.slice(1) : lines;
  const out: ParsedFeed[] = [];
  for (const line of rows) {
    const fields = splitCsvLine(line);
    const feed = header ? mappedRowToFeed(fields, header) : fieldsToFeed(fields);
    if (feed) out.push(feed);
  }
  return out;
}

function parseJson(text: string): ParsedFeed[] {
  const data = JSON.parse(text) as unknown;
  const arr = Array.isArray(data) ? data : [data];
  const out: ParsedFeed[] = [];
  for (const item of arr) {
    if (typeof item === 'string') {
      if (URLISH.test(item)) out.push(toFeed(item));
    } else if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>;
      const url = [o['url'], o['URL'], o['src'], o['stream']].find((v) => typeof v === 'string' && URLISH.test(v)) as string | undefined;
      if (!url) continue;
      const label = [o['label'], o['name'], o['title']].find((v) => typeof v === 'string') as string | undefined;
      const kind = typeof o['kind'] === 'string' ? (o['kind'] as string) : undefined;
      out.push({ ...toFeed(url, label, kind), ...extractGeo(o) });
    }
  }
  return out;
}

/** Parse a feed list (auto-detecting JSON vs CSV/plain-text), deduped by URL. */
export function parseFeedList(text: string): ParsedFeed[] {
  const trimmed = text.trim();
  const feeds = /^[[{]/.test(trimmed) ? parseJson(text) : parseCsvOrText(text);
  const seen = new Set<string>();
  const deduped: ParsedFeed[] = [];
  for (const f of feeds) {
    const key = f.url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(f);
  }
  return deduped;
}

/**
 * Build a CameraStream upsert payload from a parsed feed (id assigned by the store). Carries the
 * optional geo fields through; the store's pickGeo drops anything malformed. A shallow copy keeps
 * only the keys ParsedFeed actually set, so geo-less feeds stay { label, url, kind }.
 */
export function feedToUpsert(
  f: ParsedFeed,
  stamp?: { country?: string; region?: string; city?: string }
): Pick<CameraStream, 'label' | 'url' | 'kind' | 'country' | 'region' | 'city' | 'lat' | 'lon' | 'source'> {
  const base: Partial<CameraStream> = {};
  if (stamp?.country) base.country = stamp.country;
  if (stamp?.region) base.region = stamp.region;
  if (stamp?.city) base.city = stamp.city;
  return { ...base, ...f };
}
