import type { Bounds } from './types';

const NM_PER_DEG_LAT = 60; // 1° latitude ≈ 60 NM
const MAX_RADIUS_NM = 250; // adsb.lol hard cap

/** Center of the box + a radius (NM) covering its half-diagonal, capped at adsb.lol's 250 NM. */
export function boundsToRadius(b: Bounds): { lat: number; lon: number; radiusNm: number } {
  const lat = (b.north + b.south) / 2;
  const lon = (b.east + b.west) / 2;
  const dLat = (b.north - b.south) / 2;
  const dLon = (b.east - b.west) / 2;
  const nmLat = dLat * NM_PER_DEG_LAT;
  const nmLon = dLon * NM_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  const radiusNm = Math.min(MAX_RADIUS_NM, Math.max(1, Math.round(Math.hypot(nmLat, nmLon))));
  return { lat, lon, radiusNm };
}

/** AISStream BoundingBoxes shape: an array of boxes, each box two [lat,lon] corners. */
export function boundsToAisSubscription(b: Bounds): [[[number, number], [number, number]]] {
  return [[[b.north, b.west], [b.south, b.east]]];
}
