/** Shared livefeeds types — duplicated from renderer/modules/geoint/livefeeds/types.ts so that
 *  main-process services can import without crossing the main/renderer tsconfig boundary.
 *  Keep in sync with the renderer copy; the renderer is the canonical UI consumer.  */

export interface Bounds { west: number; south: number; east: number; north: number; }

export type AltBand = 'ground' | 'low' | 'mid' | 'high';

export interface AircraftPos {
  id: string;            // ICAO hex
  callsign: string | null;
  lat: number; lon: number;
  altFt: number | null;  // null when on ground
  gsKt: number | null;
  trackDeg: number | null;
  band: AltBand;
}

export type ShipType = 'cargo' | 'tanker' | 'passenger' | 'fishing' | 'tug' | 'pleasure' | 'other';

export interface ShipPos {
  id: string;            // MMSI (string)
  name: string | null;
  lat: number; lon: number;
  sogKt: number | null;
  cogDeg: number | null;
  type: ShipType;        // 'other' in v1 (no ShipStaticData join yet)
  lastSeen: number;      // epoch ms
}
