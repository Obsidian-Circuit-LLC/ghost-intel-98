/**
 * ReliefWeb humanitarian threat layer (GeoINT reimagine R10; UN OCHA). Stateless: fetch the public
 * ReliefWeb disasters API (current disaster declarations) and map it to GeoItem[]. NOT persisted to
 * the secure-fs cache — threat layers are on-demand/ephemeral, held only in renderer state while
 * their toggle is on. Egress is gated by the IPC handler (settings.geoint.networkEnabled); the
 * dispatcher/handler call this only when on. This is a FREE, no-user-key layer (the appname is a
 * fixed app constant the operator registers with ReliefWeb, NOT a per-user secret) — so it sits in
 * the free tier alongside USGS/GDACS, not the keyed tier.
 *
 * APPNAME (since 1 Nov 2025 ReliefWeb requires a PRE-APPROVED appname): RELIEFWEB_APPNAME below is a
 * fixed constant 'dcs98' that the OPERATOR registers with ReliefWeb separately. Until that
 * registration is approved a live fetch returns HTTP 403 ("You are not using an approved appname");
 * fetchReliefWeb handles that gracefully by returning [] rather than throwing.
 *
 * SCHEMA SOURCE — built to the PUBLISHED docs (apidoc.reliefweb.int), NOT live-verified, because the
 * appname is pending operator registration. Confirmed 2026-06-16:
 *   - apidoc.reliefweb.int/ — v1 is DECOMMISSIONED (HTTP 410); the current version is v2. Base URL:
 *     https://api.reliefweb.int/v2/{content-type}?appname={appname}. Max 1000 entries / 1000 calls/day.
 *   - apidoc.reliefweb.int/fields-tables (disasters) — id (int), name (string), status
 *     ('current'|'alert'|'past'), glide (string), date {created, changed, event} (ISO 8601),
 *     country [{ id, iso3, name, shortname, primary:bool }] (an ARRAY; NO lat/lon exposed),
 *     primary_type { id, name }, url, url_alias.
 *   - apidoc.reliefweb.int/result-structure — wrapper { href, time, links, totalCount, count,
 *     data: [ { id, score, href, fields: {...requested fields...} } ] }.
 * Live fetch attempted 2026-06-16 with appname=dcs98: HTTP 403 (appname not yet approved), as
 * expected. So: schema from docs; not live-verified (appname pending operator registration).
 *
 * GEO GRANULARITY (labelled honestly in the renderer): disasters carry NO per-point lat/lon — only a
 * tagged country array. We take the PRIMARY country (country[].primary === true, else the first
 * entry's name) and resolve that NAME to a COUNTRY CENTROID via the bundled GeoINT gazetteer (same
 * approach GDELT-DOC uses). This is country-level, NOT precise disaster location. A disaster whose
 * country cannot be resolved is DROPPED — never a fake (0,0)/off-globe pin (coordinate-integrity rule).
 *
 * LICENCE / ATTRIBUTION: ReliefWeb aggregates partner-contributed, third-party-copyrighted material
 * ("respect the intellectual property rights of the original source"). This is NOT a clean
 * redistribution licence, so this layer is LINK-OUT ONLY: we store a title + a link to the ReliefWeb
 * disaster page, and NEVER store or redisplay any report body. Renderer attribution:
 * "ReliefWeb — UN OCHA (links to source reports)". Source: research-wiki prior-art §9.
 */

import type { GeoItem } from '@shared/post-mvp-types';
import { inRange } from '../feeds';
import { geocoder } from '../gazetteer';
import { safeFetch } from '../../net/safe-fetch';
import { readTextCapped } from '../../net/limits';

/** Fixed app constant the OPERATOR registers with ReliefWeb (apidoc.reliefweb.int/parameters#appname).
 *  NOT a per-user secret — it is a public, shared application identifier. Until ReliefWeb approves
 *  this appname, live fetches 403 and fetchReliefWeb returns [] gracefully. */
export const RELIEFWEB_APPNAME = 'dcs98';

// Cap mapped items so a pathological feed can't bloat renderer state (mirrors feeds.ts MAX_FEED_ITEMS).
const MAX_RW_ITEMS = 2000;
const MAX_FIELD = 8000;
const clip = (s: string): string => (s.length > MAX_FIELD ? s.slice(0, MAX_FIELD) : s);

/** A country-name → {lat,lon,name} resolver. Mirrors the gazetteer geocoder signature so the pure
 *  parser can be unit-tested with a mock (no gazetteer file / IO). */
type CountryGeocoder = (name: string) => { lat: number; lon: number; name: string } | null;

interface RwCountry { name?: unknown; primary?: unknown }
interface RwDate { created?: unknown; changed?: unknown; event?: unknown }
interface RwFields {
  name?: unknown;
  country?: unknown;
  date?: RwDate | null;
  url?: unknown;
  url_alias?: unknown;
  status?: unknown;
  primary_type?: { name?: unknown } | null;
}
interface RwItem { id?: unknown; fields?: RwFields | null }
interface RwResponse { data?: unknown }

/** status → severity. 'alert' (active emergency) → high, 'current' (ongoing) → medium, 'past' or
 *  unknown/missing → low. ReliefWeb status enum: 'current' | 'alert' | 'past'. */
function severityForStatus(status: unknown): GeoItem['severity'] {
  const s = typeof status === 'string' ? status.trim().toLowerCase() : '';
  if (s === 'alert') return 'high';
  if (s === 'current') return 'medium';
  return 'low';
}

/** Pick the PRIMARY country name from a disaster's country array (country[].primary === true), else
 *  the first entry's name. Returns '' when no usable country name is present. */
function primaryCountryName(country: unknown): string {
  if (!Array.isArray(country) || country.length === 0) return '';
  const arr = country as RwCountry[];
  const primary = arr.find((c) => c?.primary === true);
  const chosen = primary ?? arr[0];
  return typeof chosen?.name === 'string' ? chosen.name.trim() : '';
}

/** Pure parse: ReliefWeb v2 disasters JSON → GeoItem[]. No network IO — the country→coord resolution
 *  is injected so this is unit-testable with a mock geocoder. Drops disasters whose primary country
 *  is missing or unresolvable (no silent (0,0) pin); country centroids only (not precise locations).
 *  LINK-OUT ONLY: maps title + the ReliefWeb page url, never any report body. */
export function parseReliefWeb(json: unknown, geocode: CountryGeocoder): GeoItem[] {
  const resp = (json ?? {}) as RwResponse;
  const data = Array.isArray(resp.data) ? (resp.data as RwItem[]) : [];
  const out: GeoItem[] = [];
  for (const it of data) {
    if (out.length >= MAX_RW_ITEMS) break;
    const idRaw = it?.id;
    const id = typeof idRaw === 'string' || typeof idRaw === 'number' ? String(idRaw) : '';
    if (!id) continue; // no stable id ⇒ skip (id collisions/merge would be unsafe)
    const f = (it?.fields ?? {}) as RwFields;
    const countryName = primaryCountryName(f.country);
    if (!countryName) continue; // no geo signal at all → drop (disasters have no per-point lat/lon)
    const g = geocode(countryName);
    if (!g || !inRange(g.lat, g.lon)) continue; // unresolvable country → drop, never (0,0)
    const title = clip(typeof f.name === 'string' && f.name.trim() ? f.name.trim() : 'ReliefWeb disaster');
    const d = (f.date ?? {}) as RwDate;
    const created = typeof d.created === 'string' && d.created ? d.created : '';
    const changed = typeof d.changed === 'string' && d.changed ? d.changed : '';
    const published = created || changed || undefined;
    // LINK-OUT: the ReliefWeb disaster page only (never a report body).
    const link = typeof f.url === 'string' && f.url ? f.url
      : (typeof f.url_alias === 'string' && f.url_alias ? f.url_alias : undefined);
    out.push({
      id: 'reliefweb:' + id,
      sourceId: 'threat:reliefweb',
      title,
      link,
      published,
      lat: g.lat,
      lon: g.lon,
      located: 'geo', // country centroid — country-level, labelled honestly in the renderer
      category: 'disaster',
      severity: severityForStatus(f.status)
    });
  }
  return out;
}

/** Build the ReliefWeb v2 disasters URL. The appname is the fixed RELIEFWEB_APPNAME constant (not
 *  renderer-supplied); limit/sort/fields are fixed app-side, so there is no injection surface. */
export function buildReliefWebUrl(): string {
  const params = new URLSearchParams();
  params.set('appname', RELIEFWEB_APPNAME);
  params.set('limit', String(MAX_RW_ITEMS > 1000 ? 1000 : MAX_RW_ITEMS)); // ReliefWeb caps at 1000/call
  params.append('sort[]', 'date:desc');
  for (const field of ['name', 'country', 'date', 'url', 'url_alias', 'status', 'primary_type']) {
    params.append('fields[include][]', field);
  }
  return `https://api.reliefweb.int/v2/disasters?${params.toString()}`;
}

/** Fetch + parse the ReliefWeb disasters feed, resolving the primary country → centroid via the
 *  bundled gazetteer. APPNAME-PENDING behaviour: while the appname is not yet approved by ReliefWeb
 *  the request 403s; we return [] gracefully (the layer simply shows nothing) rather than throwing
 *  an uncaught error. Other non-OK statuses also degrade to [] so a humanitarian-feed outage never
 *  breaks the map. Takes no renderer options — the disasters query is fixed app-side. */
export async function fetchReliefWeb(_opts: object): Promise<GeoItem[]> {
  const url = buildReliefWebUrl();
  let res: Awaited<ReturnType<typeof safeFetch>>;
  try {
    res = await safeFetch(url, 4, { Accept: 'application/json' });
  } catch {
    return []; // network failure (incl. appname not yet routable) → degrade gracefully
  }
  if (!res.ok) return []; // 403 (appname pending) / 410 / 5xx → [] rather than throw
  let json: unknown;
  try { json = JSON.parse(await readTextCapped(res)); } catch { return []; }
  return parseReliefWeb(json, geocoder());
}
