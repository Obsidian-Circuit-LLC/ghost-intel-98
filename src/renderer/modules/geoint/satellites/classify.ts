// src/renderer/modules/geoint/satellites/classify.ts
import type { SatelliteType } from './types';

/** Heuristic type from the satellite's catalogue name (CelesTrak names are stable, uppercase).
 *  Order matters: most specific first. NORAD id is reserved for future refinement. */
export function classifyByName(name: string, _noradId: number | null): SatelliteType {
  const n = name.toUpperCase();
  if (n.startsWith('STARLINK')) return 'starlink';
  if (n.includes('NAVSTAR') || /\bGPS\b/.test(n)) return 'gps';
  if (n.includes('NOAA') || n.includes('GOES') || n.includes('METEOR') || n.includes('METOP') || n.includes('DMSP')) return 'weather';
  if (n.includes('ISS') || n.includes('ZARYA') || n.includes('CSS') || n.includes('TIANHE') || n.includes('TIANGONG')) return 'station';
  if (n.includes('IRIDIUM') || n.includes('ONEWEB') || n.includes('INTELSAT') || n.includes('SES') || n.includes('GLOBALSTAR')) return 'comms';
  if (n.includes('LANDSAT') || n.includes('SENTINEL') || n.includes('TERRA') || n.includes('AQUA') || n.includes('WORLDVIEW')) return 'earth-obs';
  if (n.includes('HUBBLE') || n.includes('HST') || n.includes('TESS') || n.includes('SWIFT')) return 'scientific';
  return 'other';
}
