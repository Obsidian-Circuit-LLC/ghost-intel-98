import { useState } from 'react';
import type { CameraStream } from '@shared/post-mvp-types';

export function SetLocationDialog({ targets, onApply, onClose }: {
  targets: CameraStream[];
  onApply: (geo: { country: string; region: string; city: string }) => void;
  onClose: () => void;
}): JSX.Element {
  const seed = targets[0] ?? {};
  const [country, setCountry] = useState(seed.country ?? '');
  const [region, setRegion] = useState(seed.region ?? '');
  const [city, setCity] = useState(seed.city ?? '');
  return (
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <fieldset style={{ background: '#c0c0c0', minWidth: 280 }}>
        <legend>Set location ({targets.length} feed{targets.length === 1 ? '' : 's'})</legend>
        <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr', gap: 4 }}>
          <label>Country:</label><input className="ga98-text" value={country} onChange={(e) => setCountry(e.target.value)} placeholder="United Kingdom" />
          <label>State/Region:</label><input className="ga98-text" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="(optional)" />
          <label>City:</label><input className="ga98-text" value={city} onChange={(e) => setCity(e.target.value)} placeholder="London" />
        </div>
        <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
          <button onClick={() => onApply({ country: country.trim(), region: region.trim(), city: city.trim() })}>Apply</button>
          <button onClick={onClose}>Cancel</button>
        </div>
      </fieldset>
    </div>
  );
}
