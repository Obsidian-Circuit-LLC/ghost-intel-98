/**
 * EyeSpy bulk feed import — parses a camera-feed list (JSON array, CSV, or a plain
 * one-URL-per-line text file) into normalized {label, url, kind, …optional geo} entries.
 * Pure: no IO.
 *
 * `kind` is inferred from the URL when not given; `label` is derived from the host when
 * not given. Entries without a recognizable URL are dropped. Deduped by URL.
 *
 * Optional geo metadata (country/region/city/lat/lon/source) is read from JSON objects only —
 * the heuristic CSV/plain-text path can't reliably attribute unlabeled columns to geo fields,
 * so it stays geo-unaware. A geo-aware, header-mapped CSV reader can come later once the corpus
 * format is known. Geo keys are only emitted when actually present.
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

function parseLines(text: string): ParsedFeed[] {
  const out: ParsedFeed[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    // Skip a header row like "label,url,kind".
    if (/^label\s*,/i.test(line) && !URLISH.test(line)) continue;
    const feed = fieldsToFeed(splitCsvLine(line));
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
  const feeds = /^[[{]/.test(trimmed) ? parseJson(text) : parseLines(text);
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
  f: ParsedFeed
): Pick<CameraStream, 'label' | 'url' | 'kind' | 'country' | 'region' | 'city' | 'lat' | 'lon' | 'source'> {
  return { ...f };
}
