// src/renderer/modules/geoint/satellites/propagate.ts
/** SGP4 propagation wrapper. satellite.js (MIT) is the engine; callers never touch it directly so it
 *  could be swapped for a vendored SGP4 later. Pure given (records, date): no Date.now() inside — the
 *  caller supplies the instant (real-time motion is the caller's setInterval, a documented exception). */
import * as satellite from 'satellite.js';
import type { SatelliteRecord, PropagatedSat } from './types';

interface Prepared { rec: SatelliteRecord; satrec: satellite.SatRec; inclinationDeg: number; }
export interface Propagator { propagateAt(date: Date): PropagatedSat[]; }

const RAD2DEG = 180 / Math.PI;

export function makePropagator(records: SatelliteRecord[]): Propagator {
  const prepared: Prepared[] = [];
  for (const rec of records) {
    try {
      const satrec = satellite.twoline2satrec(rec.line1, rec.line2);
      if (satrec.error && satrec.error !== 0) continue;
      prepared.push({ rec, satrec, inclinationDeg: satrec.inclo * RAD2DEG });
    } catch { /* unparseable TLE — drop */ }
  }

  return {
    propagateAt(date: Date): PropagatedSat[] {
      const gmst = satellite.gstime(date);
      const out: PropagatedSat[] = [];
      for (const p of prepared) {
        const pv = satellite.propagate(p.satrec, date);
        const pos = pv.position;
        const vel = pv.velocity;
        if (!pos || typeof pos === 'boolean' || !vel || typeof vel === 'boolean') continue;
        if (![pos.x, pos.y, pos.z].every(Number.isFinite)) continue;
        const geo = satellite.eciToGeodetic(pos, gmst);
        out.push({
          id: p.rec.id, name: p.rec.name, noradId: p.rec.noradId, type: p.rec.type,
          lat: satellite.degreesLat(geo.latitude),
          lon: satellite.degreesLong(geo.longitude),
          altKm: geo.height,
          velocityKmS: Math.hypot(vel.x, vel.y, vel.z),
          inclinationDeg: p.inclinationDeg,
          active: p.rec.active
        });
      }
      return out;
    }
  };
}
