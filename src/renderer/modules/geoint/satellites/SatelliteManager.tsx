// src/renderer/modules/geoint/satellites/SatelliteManager.tsx
import { useState } from 'react';
import type { SatelliteType } from './types';
import { validateTlePair, parseTleText } from './tle';

const TYPES: SatelliteType[] = ['starlink', 'gps', 'weather', 'comms', 'earth-obs', 'station', 'scientific', 'other'];

export function SatelliteManager({ onAdded }: { onAdded: () => void }): JSX.Element {
  const [tab, setTab] = useState<'add' | 'import'>('add');
  const [name, setName] = useState(''); const [type, setType] = useState<SatelliteType>('other');
  const [tag, setTag] = useState(''); const [l1, setL1] = useState(''); const [l2, setL2] = useState('');
  const [active, setActive] = useState(true); const [err, setErr] = useState<string | null>(null);
  const [bulk, setBulk] = useState(''); const [msg, setMsg] = useState<string | null>(null);

  const add = async (): Promise<void> => {
    const v = validateTlePair(name, l1.trim(), l2.trim());
    if (!v.ok) { setErr(v.error); return; }
    setErr(null);
    await window.api.satellites.upsert({ name: name.trim() || String(v.record.noradId ?? 'UNKNOWN'), noradId: v.record.noradId, line1: l1.trim(), line2: l2.trim(), type, tag: tag.trim() || undefined, active });
    setName(''); setL1(''); setL2(''); setTag(''); onAdded();
  };

  const importBulk = async (): Promise<void> => {
    const recs = parseTleText(bulk);
    if (!recs.length) { setMsg('No valid TLE blocks found.'); return; }
    for (const r of recs) await window.api.satellites.upsert({ name: r.name, noradId: r.noradId, line1: r.line1, line2: r.line2, type: r.type, active: true });
    setMsg(`Imported ${recs.length} satellite(s).`); setBulk(''); onAdded();
  };

  return (
    <fieldset style={{ marginTop: 6 }}>
      <legend>Space Satellite Manager</legend>
      <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
        <button data-active={tab === 'add'} onClick={() => setTab('add')}>Add New Satellite</button>
        <button data-active={tab === 'import'} onClick={() => setTab('import')}>Import (TLE)</button>
      </div>
      {tab === 'add' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>
          <input className="ga98-text" placeholder="Name / Designation" value={name} onChange={(e) => setName(e.target.value)} />
          <select className="ga98-text" value={type} onChange={(e) => setType(e.target.value as SatelliteType)}>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
          <textarea className="ga98-text" rows={2} placeholder="TLE line 1 (1 …)" value={l1} onChange={(e) => setL1(e.target.value)} />
          <textarea className="ga98-text" rows={2} placeholder="TLE line 2 (2 …)" value={l2} onChange={(e) => setL2(e.target.value)} />
          <input className="ga98-text" placeholder="Optional tag / notes" value={tag} onChange={(e) => setTag(e.target.value)} />
          <label style={{ display: 'inline-flex', gap: 4 }}><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />Set active (show on globe)</label>
          {err && <div style={{ color: '#900' }}>{err}</div>}
          <button onClick={() => void add()}>Add Satellite</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>
          <textarea className="ga98-text" rows={6} placeholder="Paste TLE text (2- or 3-line blocks)…" value={bulk} onChange={(e) => setBulk(e.target.value)} />
          {msg && <div style={{ opacity: 0.8 }}>{msg}</div>}
          <button onClick={() => void importBulk()}>Import</button>
        </div>
      )}
    </fieldset>
  );
}
