/** Pure AISStream PositionReport parser + vessel prune. Never throws. Position lives under
 *  Message.PositionReport (capitalized Latitude/Longitude/Sog/Cog); MMSI/ShipName under MetaData.
 *  Ship type is NOT in PositionReport (it's in ShipStaticData) → type defaults to 'other' in v1. */
import type { ShipPos } from './types';

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export function parseAisMessage(raw: unknown, now: number): ShipPos | null {
  const m = raw as Record<string, unknown>;
  if (!m || m.MessageType !== 'PositionReport') return null;
  const pr = (m.Message as { PositionReport?: Record<string, unknown> })?.PositionReport;
  const meta = m.MetaData as Record<string, unknown> | undefined;
  if (!pr || !meta) return null;
  const lat = pr.Latitude, lon = pr.Longitude;
  if (!finite(lat) || lat < -90 || lat > 90 || !finite(lon) || lon < -180 || lon > 180) return null;
  if (meta.MMSI === undefined || meta.MMSI === null) return null;
  const name = typeof meta.ShipName === 'string' && meta.ShipName.trim() ? meta.ShipName.trim() : null;
  return {
    id: String(meta.MMSI), name, lat, lon,
    sogKt: finite(pr.Sog) ? pr.Sog : null,
    cogDeg: finite(pr.Cog) ? pr.Cog : null,
    type: 'other',
    lastSeen: now
  };
}

export function pruneVessels(map: Map<string, ShipPos>, now: number, maxAgeMs = 10 * 60_000): void {
  for (const [k, v] of map) if (now - v.lastSeen > maxAgeMs) map.delete(k);
}
