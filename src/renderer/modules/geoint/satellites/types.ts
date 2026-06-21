// src/renderer/modules/geoint/satellites/types.ts
/** Space-satellite domain types. TLE lines are the canonical orbital input to SGP4. */
export type SatelliteType =
  | 'starlink' | 'gps' | 'weather' | 'comms' | 'earth-obs' | 'station' | 'scientific' | 'other';

export interface SatelliteRecord {
  id: string;                 // noradId when known (`sat-<norad>`), else `sat-<hash>`
  name: string;
  noradId: number | null;
  line1: string;              // TLE line 1
  line2: string;              // TLE line 2
  type: SatelliteType;
  source: 'snapshot' | 'celestrak' | 'user';
  tag?: string;
  notes?: string;
  active: boolean;            // drawn only when true (user sats default true on add)
  addedAt: string;            // ISO
}

export interface PropagatedSat {
  id: string;
  name: string;
  noradId: number | null;
  type: SatelliteType;
  lat: number;                // degrees
  lon: number;                // degrees
  altKm: number;
  velocityKmS: number;
  inclinationDeg: number;
  active: boolean;
}

/** CelesTrak GROUP ids offered in the data-source dropdown. 'active' is the default catalogue. */
export const SAT_GROUPS: { id: string; label: string }[] = [
  { id: 'active', label: 'Active Satellites' },
  { id: 'stations', label: 'Space Stations' },
  { id: 'starlink', label: 'Starlink' },
  { id: 'gps-ops', label: 'GPS Operational' },
  { id: 'weather', label: 'Weather' },
  { id: 'science', label: 'Science' }
];
