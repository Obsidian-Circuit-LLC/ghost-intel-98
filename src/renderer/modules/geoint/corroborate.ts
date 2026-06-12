import type { GeoItem } from '@shared/post-mvp-types';

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371, d = Math.PI / 180;
  const dLat = (bLat - aLat) * d, dLon = (bLon - aLon) * d;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * d) * Math.cos(bLat * d) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Once an item's distinct-other-source Set reaches this many, stop scanning its candidates.
 *  The halo only needs the count up to a small max, so capping bounds the worst case (a genuine
 *  mega-cluster of thousands of co-located distinct sources) without changing any count <= cap. */
const SRC_CAP = 16;

/** For each located item, the count of DISTINCT other sources reporting within radiusKm and windowHours
 *  (capped at SRC_CAP). count >= 1 ⇒ corroborated by that many *other* sources (so a ring shows for
 *  count>=1). Items with an undated `published` are not time-gated (proximity alone).
 *
 *  Implementation: items are bucketed into a lat/lon grid with cell size ≈ the search radius, so each
 *  item is only compared against the (at most 9) cells in its 3×3 neighborhood. A radius-sized cell plus
 *  its 8 neighbors fully covers a circle of radius R at any latitude this app handles, and the exact
 *  haversine test still runs on every candidate — bucketing only prunes the candidate set, it never
 *  changes the result. This turns the old O(n²) double-loop into near-linear for dispersed data; SRC_CAP
 *  bounds the dense-cluster case. */
export function corroborate(
  items: GeoItem[],
  opts: { radiusKm?: number; windowHours?: number } = {}
): Map<string, number> {
  const R = opts.radiusKm ?? 25, W = (opts.windowHours ?? 48) * 3600_000;
  // Finite-coordinate filter: excludes null/undefined AND NaN/Infinity (which would otherwise pass a
  // `!= null` check and, since `NaN > R` is false, get counted as "within radius" of every item).
  const located = items.filter((i) => Number.isFinite(i.lat) && Number.isFinite(i.lon));
  const t = (i: GeoItem): number | null => { const p = i.published ? Date.parse(i.published) : NaN; return Number.isNaN(p) ? null : p; };

  // Spatial grid: cell side ≈ R in degrees of latitude (≈111 km/deg). Key = "floor(lat/cellDeg),floor(lon/cellDeg)".
  const cellDeg = R / 111;
  const grid = new Map<string, GeoItem[]>();
  const cellKey = (lat: number, lon: number): string =>
    `${Math.floor(lat / cellDeg)},${Math.floor(lon / cellDeg)}`;
  for (const i of located) {
    const k = cellKey(i.lat!, i.lon!);
    const cell = grid.get(k);
    if (cell) cell.push(i); else grid.set(k, [i]);
  }

  const out = new Map<string, number>();
  for (const a of located) {
    const srcs = new Set<string>();
    const cx = Math.floor(a.lat! / cellDeg), cy = Math.floor(a.lon! / cellDeg);
    const ta = t(a);
    // Each lon cell spans ≈ R*cos(lat) km east-west (degrees of longitude shrink toward the poles),
    // so a ±1 lon sweep can miss true neighbors at higher latitudes. Widen the lon sweep to as many
    // cells as are needed to cover R km, +1 for the item's edge position. (Latitude cells are always
    // ≈R km tall, so ±1 suffices for lat.) Clamped to keep the sweep sane near the poles. The exact
    // haversine still runs on every candidate, so widening only enlarges the candidate set — never the
    // result. cos near 0 ⇒ cos→ small; guard against division blow-up with a floor.
    const cosLat = Math.max(Math.cos((a.lat! * Math.PI) / 180), 1e-6);
    const lonSpan = Math.min(180, Math.ceil(1 / cosLat) + 1);
    let capped = false;
    for (let dx = -1; dx <= 1 && !capped; dx++) {
      for (let dy = -lonSpan; dy <= lonSpan && !capped; dy++) {
        const cell = grid.get(`${cx + dx},${cy + dy}`);
        if (!cell) continue;
        for (const b of cell) {
          if (b.id === a.id || b.sourceId === a.sourceId) continue;
          if (srcs.has(b.sourceId)) continue; // already counted this source — skip the haversine
          if (haversineKm(a.lat!, a.lon!, b.lat!, b.lon!) > R) continue;
          const tb = t(b);
          if (ta != null && tb != null && Math.abs(ta - tb) > W) continue;
          srcs.add(b.sourceId);
          if (srcs.size >= SRC_CAP) { capped = true; break; } // early-exit: count is bounded
        }
      }
    }
    out.set(a.id, srcs.size);
  }
  return out;
}
