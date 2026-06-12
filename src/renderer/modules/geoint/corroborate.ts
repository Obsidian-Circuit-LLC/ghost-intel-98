import type { GeoItem } from '@shared/post-mvp-types';

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371, d = Math.PI / 180;
  const dLat = (bLat - aLat) * d, dLon = (bLon - aLon) * d;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * d) * Math.cos(bLat * d) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** For each located item, the count of DISTINCT other sources reporting within radiusKm and windowHours.
 *  count >= 1 ⇒ corroborated by that many *other* sources (so a ring shows for count>=1). Items with an
 *  undated `published` are not time-gated (proximity alone). */
export function corroborate(
  items: GeoItem[],
  opts: { radiusKm?: number; windowHours?: number } = {}
): Map<string, number> {
  const R = opts.radiusKm ?? 25, W = (opts.windowHours ?? 48) * 3600_000;
  const located = items.filter((i) => i.lat != null && i.lon != null);
  const t = (i: GeoItem): number | null => { const p = i.published ? Date.parse(i.published) : NaN; return Number.isNaN(p) ? null : p; };
  const out = new Map<string, number>();
  for (const a of located) {
    const srcs = new Set<string>();
    for (const b of located) {
      if (b.id === a.id || b.sourceId === a.sourceId) continue;
      if (haversineKm(a.lat!, a.lon!, b.lat!, b.lon!) > R) continue;
      const ta = t(a), tb = t(b);
      if (ta != null && tb != null && Math.abs(ta - tb) > W) continue;
      srcs.add(b.sourceId);
    }
    out.set(a.id, srcs.size);
  }
  return out;
}
