/**
 * EyeSpy bulk feed import — parses a camera-feed list (JSON array, CSV, or a plain
 * one-URL-per-line text file) into normalized {label, url, kind} entries. Pure: no IO.
 *
 * `kind` is inferred from the URL when not given; `label` is derived from the host when
 * not given. Entries without a recognizable URL are dropped. Deduped by URL.
 */

import type { CameraStream, StreamKind } from '@shared/post-mvp-types';

export interface ParsedFeed { label: string; url: string; kind: StreamKind }

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
      out.push(toFeed(url, label, kind));
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

/** Build a CameraStream upsert payload from a parsed feed (id assigned by the store). */
export function feedToUpsert(f: ParsedFeed): Pick<CameraStream, 'label' | 'url' | 'kind'> {
  return { label: f.label, url: f.url, kind: f.kind };
}
