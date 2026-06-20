import { useState } from 'react';
import type { CameraStream } from '@shared/post-mvp-types';
import { toast } from '../../state/toasts';

export type CoordParse = { ok: true; lat?: number; lon?: number } | { ok: false; error: string };

/** Validate the lat/lon text pair for a single feed. Both blank ⇒ ok with no coords (clears).
 *  Exactly one blank ⇒ error. Non-numeric or out-of-range ⇒ error. Pure (unit-tested). */
export function parseCoordPair(latStr: string, lonStr: string): CoordParse {
  const a = latStr.trim();
  const b = lonStr.trim();
  if (a === '' && b === '') return { ok: true };
  if (a === '' || b === '') return { ok: false, error: 'Enter both latitude and longitude, or leave both blank.' };
  const lat = Number(a);
  const lon = Number(b);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { ok: false, error: 'Latitude and longitude must be numbers.' };
  if (lat < -90 || lat > 90) return { ok: false, error: 'Latitude must be between -90 and 90.' };
  if (lon < -180 || lon > 180) return { ok: false, error: 'Longitude must be between -180 and 180.' };
  return { ok: true, lat, lon };
}

export interface SetLocationApply {
  country: string;
  region: string;
  city: string;
  /** Present only for a single-target edit; when present it is authoritative (set or clear).
   *  Absent for multi-target, so existing per-camera coordinates are preserved. */
  coords?: { lat?: number; lon?: number };
}

export function SetLocationDialog({ targets, onApply, onClose }: {
  targets: CameraStream[];
  onApply: (geo: SetLocationApply) => void;
  onClose: () => void;
}): JSX.Element {
  const seed = targets[0] ?? {};
  const single = targets.length === 1;
  const [country, setCountry] = useState(seed.country ?? '');
  const [region, setRegion] = useState(seed.region ?? '');
  const [city, setCity] = useState(seed.city ?? '');
  const [lat, setLat] = useState(seed.lat != null ? String(seed.lat) : '');
  const [lon, setLon] = useState(seed.lon != null ? String(seed.lon) : '');

  function apply(): void {
    const base: SetLocationApply = { country: country.trim(), region: region.trim(), city: city.trim() };
    if (single) {
      const c = parseCoordPair(lat, lon);
      if (!c.ok) { toast.error(c.error); return; }
      base.coords = { lat: c.lat, lon: c.lon }; // both undefined ⇒ clear
    }
    onApply(base);
  }

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <fieldset style={{ background: '#c0c0c0', minWidth: 280 }}>
        <legend>Set location ({targets.length} feed{targets.length === 1 ? '' : 's'})</legend>
        <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 4 }}>
          <label>Country:</label><input className="ga98-text" value={country} onChange={(e) => setCountry(e.target.value)} placeholder="United Kingdom" />
          <label>State/Region:</label><input className="ga98-text" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="(optional)" />
          <label>City:</label><input className="ga98-text" value={city} onChange={(e) => setCity(e.target.value)} placeholder="London" />
          {single && <>
            <label>Latitude:</label><input className="ga98-text" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="-90 … 90 (optional)" />
            <label>Longitude:</label><input className="ga98-text" inputMode="decimal" value={lon} onChange={(e) => setLon(e.target.value)} placeholder="-180 … 180 (optional)" />
          </>}
        </div>
        {single && <div style={{ fontSize: 10, opacity: 0.65, marginTop: 4 }}>Set both to drop a map pin; clear both to remove it.</div>}
        <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
          <button onClick={apply}>Apply</button>
          <button onClick={onClose}>Cancel</button>
        </div>
      </fieldset>
    </div>
  );
}
