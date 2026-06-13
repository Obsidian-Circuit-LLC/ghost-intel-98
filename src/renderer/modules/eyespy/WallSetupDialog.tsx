import { useState } from 'react';

/** A wall's location category config, as entered in the dialog. */
export interface WallSetupCfg {
  name: string;
  country: string;
  region: string;
  city: string;
}

/** Derive a board name from the location when the user left Name blank. */
function deriveName(country: string, region: string, city: string): string {
  const fromLoc = [city, region, country].filter(Boolean).join(' · ');
  return fromLoc || 'Untitled wall';
}

/**
 * Wall Setup dialog — used by both "New" and "Rename". Replaces the old window.prompt flow (which
 * Electron's renderer does not support: prompt() returns null → silent no-op). The board is named
 * and scoped by location (Country → State/Region → City); from here the user can also import an
 * entire CCTV feed file directly into that category. Mirrors SetLocationDialog's Win98 style.
 */
export function WallSetupDialog({ initial, title, onSubmit, onImportHere, onClose }: {
  initial?: { name?: string; country?: string; region?: string; city?: string };
  title: string;
  onSubmit: (cfg: WallSetupCfg) => void;
  onImportHere?: (cfg: WallSetupCfg) => void;
  onClose: () => void;
}): JSX.Element {
  const [name, setName] = useState(initial?.name ?? '');
  const [country, setCountry] = useState(initial?.country ?? '');
  const [region, setRegion] = useState(initial?.region ?? '');
  const [city, setCity] = useState(initial?.city ?? '');

  // Name falls back to the location label (or 'Untitled wall') when left blank.
  const cfg = (): WallSetupCfg => {
    const c = country.trim(), r = region.trim(), ci = city.trim();
    return { name: name.trim() || deriveName(c, r, ci), country: c, region: r, city: ci };
  };

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <fieldset style={{ background: '#c0c0c0', minWidth: 300 }}>
        <legend>{title}</legend>
        <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 4 }}>
          <label>Wall name:</label><input className="ga98-text" value={name} onChange={(e) => setName(e.target.value)} placeholder="(derived from location if blank)" />
          <label>Country:</label><input className="ga98-text" value={country} onChange={(e) => setCountry(e.target.value)} placeholder="United Kingdom" />
          <label>State/Region:</label><input className="ga98-text" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="(optional)" />
          <label>City:</label><input className="ga98-text" value={city} onChange={(e) => setCity(e.target.value)} placeholder="London" />
        </div>
        <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button onClick={() => onSubmit(cfg())}>{title === 'New wall' ? 'Create' : 'Save'}</button>
          {onImportHere && <button onClick={() => onImportHere(cfg())}>Import CCTV file into this category…</button>}
          <button onClick={onClose}>Cancel</button>
        </div>
      </fieldset>
    </div>
  );
}
