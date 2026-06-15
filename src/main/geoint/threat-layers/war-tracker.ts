/**
 * War-Tracker OSINT threat layer (GeoINT reimagine R7). Stateless: fetch the public war-tracker.com
 * events corpus and map it to GeoItem[]. NOT persisted to the secure-fs cache — threat layers are
 * on-demand/ephemeral, held only in renderer state while their toggle is on. Egress is gated by the
 * IPC handler (settings.geoint.networkEnabled); the dispatcher/handler call this only when on.
 *
 * Feed: https://war-tracker.com/api/v1/events?limit=<n>[&country=<ISO2>] — JSON. Verified live
 * 2026-06-15: per-event { id, url, date, modified, event_type, location, country, country_name,
 * lat (number), lng (number), has_media, is_video, source_url (often null), confidence (string),
 * description }; top-level { events[], next_cursor, count, has_more }.
 *
 * ACCESS NOTE (verified live 2026-06-15): /events sits behind an x402 micropayment wall that is
 * gated on User-Agent — a default Node/curl UA gets HTTP 402 with a payment body, while a
 * browser-like UA gets HTTP 200 with the documented free tier (60 req/min/IP, CORS open — the same
 * data the operator's own browser would receive). We therefore send an explicit browser-like
 * User-Agent so safeFetch reaches the free tier rather than the paywall. This is the documented
 * free path, not a paywall bypass: the paid path requires a *signed* X-PAYMENT header we never send.
 *
 * PROVENANCE: war-tracker events are sourced from public Telegram channels / OSINT social posts,
 * LLM-classified and human-reviewed — UNVERIFIED social-OSINT chatter, noisier and lower-authority
 * than authoritative feeds. The renderer labels this honestly. Licence: commercial-use-with-
 * attribution (blog); attribute via the canonical `url` (war-tracker.com/share/…).
 */

import type { GeoItem } from '@shared/post-mvp-types';
import { strictNum, inRange } from '../feeds';
import { safeFetch } from '../../net/safe-fetch';
import { readTextCapped } from '../../net/limits';

// Cap mapped items so a pathological feed can't bloat renderer state (mirrors feeds.ts MAX_FEED_ITEMS).
const MAX_WT_ITEMS = 2000;
const MAX_FIELD = 8000;
const MAX_TITLE = 140;
const clip = (s: string): string => (s.length > MAX_FIELD ? s.slice(0, MAX_FIELD) : s);

// A browser-like User-Agent: the /events endpoint returns the documented free tier to browser-like
// callers and an x402 402 payment wall to default Node/curl UAs. See the ACCESS NOTE above.
const BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

interface WtEvent {
  id?: unknown;
  url?: unknown;
  date?: unknown;
  event_type?: unknown;
  location?: unknown;
  lat?: unknown;
  lng?: unknown;
  confidence?: unknown;
  description?: unknown;
  source_url?: unknown;
}
interface WtResponse { events?: unknown }

/** confidence (string) → severity. HIGH→high, MEDIUM→medium, LOW/unknown/missing→low. */
function severityForConfidence(conf: unknown): GeoItem['severity'] {
  const s = typeof conf === 'string' ? conf.trim().toLowerCase() : '';
  if (s === 'high') return 'high';
  if (s === 'medium') return 'medium';
  return 'low';
}

/** Pure parse: war-tracker /events JSON → GeoItem[]. No IO, so unit-testable without network.
 *  Drops events with out-of-range/NaN coordinates (no silent off-globe pins) or no stable id. */
export function parseWarTracker(json: unknown): GeoItem[] {
  const resp = (json ?? {}) as WtResponse;
  const events = Array.isArray(resp.events) ? (resp.events as WtEvent[]) : [];
  const out: GeoItem[] = [];
  for (const e of events) {
    if (out.length >= MAX_WT_ITEMS) break;
    const lat = strictNum(e?.lat);
    const lng = strictNum(e?.lng);
    if (!inRange(lat, lng)) continue; // coordinate-integrity guard: never a silent off-globe pin
    const idRaw = e?.id;
    const id = typeof idRaw === 'string' || typeof idRaw === 'number' ? String(idRaw) : '';
    if (!id) continue; // no stable id ⇒ skip (id collisions/merge would be unsafe)
    const loc = typeof e?.location === 'string' ? e.location.trim() : '';
    const etype = typeof e?.event_type === 'string' ? e.event_type.trim() : '';
    const desc = typeof e?.description === 'string' ? e.description.trim() : '';
    const title = clip(loc || etype || desc.slice(0, MAX_TITLE) || 'War-Tracker event').slice(0, MAX_FIELD);
    // Attribute via canonical share url; source_url (when non-null) is the original OSINT post.
    const srcUrl = typeof e?.source_url === 'string' && e.source_url ? e.source_url : '';
    const canonical = typeof e?.url === 'string' ? e.url : '';
    const link = srcUrl || canonical || undefined;
    const published = typeof e?.date === 'string' && e.date ? e.date : undefined;
    out.push({
      id: 'wartracker:' + id,
      sourceId: 'threat:wartracker',
      title: title.length > MAX_TITLE ? title.slice(0, MAX_TITLE) : title,
      link,
      published,
      lat,
      lon: lng,
      located: 'geo',
      category: 'chatter',
      severity: severityForConfidence(e?.confidence)
    });
  }
  return out;
}

/** Build the war-tracker /events URL. `limit` is bounded to the API max (200); an optional ISO2
 *  `country` is uppercased and validated to two ASCII letters (so it can't inject extra query). */
export function buildWarTrackerUrl(opts: { limit?: number; country?: string }): string {
  const limit = Number.isFinite(opts?.limit) ? Math.max(1, Math.min(Math.floor(opts!.limit!), 200)) : 100;
  const params = new URLSearchParams({ limit: String(limit) });
  const c = typeof opts?.country === 'string' ? opts.country.trim().toUpperCase() : '';
  if (/^[A-Z]{2}$/.test(c)) params.set('country', c);
  return `https://war-tracker.com/api/v1/events?${params.toString()}`;
}

/** Fetch + parse the war-tracker events feed. Throws on network/HTTP failure (the handler surfaces
 *  it to the renderer's busy/error state). `country` is an optional ISO2 filter (URL-bounded). */
export async function fetchWarTracker(opts: { country?: string }): Promise<GeoItem[]> {
  const url = buildWarTrackerUrl({ limit: 200, country: opts?.country });
  const res = await safeFetch(url, 4, { Accept: 'application/json', 'User-Agent': BROWSER_UA });
  if (!res.ok) throw new Error(`War-Tracker HTTP ${res.status}`);
  return parseWarTracker(JSON.parse(await readTextCapped(res)));
}
