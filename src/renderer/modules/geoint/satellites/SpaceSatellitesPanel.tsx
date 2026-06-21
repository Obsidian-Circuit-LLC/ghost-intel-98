// src/renderer/modules/geoint/satellites/SpaceSatellitesPanel.tsx
/** Bottom-left "SPACE SATELLITES" panel: toggle, CelesTrak group picker, Refresh,
 *  visible-count status, per-type filter checkboxes, sortable table (capped at 500
 *  rows of the filtered set), and Track / Center / Details row actions.
 *  Export is a renderer-only Blob download — no IPC, no egress. */
import { useMemo, useState } from 'react';
import type { PropagatedSat, SatelliteType } from './types';
import { SAT_GROUPS } from './types';
import { SAT_TYPE_COLORS } from './satelliteLayer';

const TYPES = Object.keys(SAT_TYPE_COLORS) as SatelliteType[];
const ROW_CAP = 500;
type SortKey = 'name' | 'type' | 'altKm' | 'velocityKmS' | 'inclinationDeg';

export interface SpaceSatellitesPanelProps {
  show: boolean;
  onToggle(b: boolean): void;
  propagated: PropagatedSat[];
  total: number;
  visibleTypes: Set<SatelliteType> | null;
  onVisibleTypes(s: Set<SatelliteType> | null): void;
  group: string;
  onGroup(g: string): void;
  onRefresh(): void;
  lastUpdate: string | null;
  networkEnabled: boolean;
  onTrack(id: string): void;
  onCenter(id: string): void;
  onDetails(id: string): void;
}

export function SpaceSatellitesPanel(p: SpaceSatellitesPanelProps): JSX.Element {
  const [sort, setSort] = useState<SortKey>('name');
  const [asc, setAsc] = useState(true);

  const rows = useMemo(() => {
    const filtered = p.visibleTypes
      ? p.propagated.filter((s) => p.visibleTypes!.has(s.type))
      : p.propagated;
    const sorted = [...filtered].sort((a, b) => {
      const av = a[sort];
      const bv = b[sort];
      const c =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv));
      return asc ? c : -c;
    });
    return sorted;
  }, [p.propagated, p.visibleTypes, sort, asc]);

  const toggleType = (t: SatelliteType): void => {
    const cur = p.visibleTypes ?? new Set(TYPES);
    const next = new Set(cur);
    next.has(t) ? next.delete(t) : next.add(t);
    p.onVisibleTypes(next.size === TYPES.length ? null : next);
  };

  // Renderer-only Blob download — no IPC, no egress.
  const exportJson = (): void => {
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'satellites-export.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const th = (k: SortKey, label: string): JSX.Element => (
    <th
      style={{ cursor: 'pointer' }}
      onClick={() => {
        setSort(k);
        setAsc(k === sort ? !asc : true);
      }}
    >
      {label}
      {sort === k ? (asc ? ' ▲' : ' ▼') : ''}
    </th>
  );

  return (
    <fieldset style={{ marginTop: 6 }}>
      <legend>Space Satellites</legend>

      <label style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <input type="checkbox" checked={p.show} onChange={(e) => p.onToggle(e.target.checked)} />
        Show Space Satellites ({p.total})
      </label>

      <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
        <select
          className="ga98-text"
          value={p.group}
          onChange={(e) => p.onGroup(e.target.value)}
        >
          {SAT_GROUPS.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </select>
        <button
          onClick={p.onRefresh}
          disabled={!p.networkEnabled}
          title={
            p.networkEnabled
              ? 'Refresh from CelesTrak'
              : 'Enable GeoINT network to refresh'
          }
        >
          Refresh
        </button>
        <button onClick={exportJson} disabled={!rows.length}>
          Export…
        </button>
      </div>

      <div style={{ fontSize: 11, opacity: 0.8, marginTop: 2 }}>
        Satellites visible: {rows.length} / {p.total}
        {p.lastUpdate ? ` · updated ${p.lastUpdate}` : ''}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 11, margin: '4px 0' }}>
        {TYPES.map((t) => (
          <label key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
            <input
              type="checkbox"
              checked={!p.visibleTypes || p.visibleTypes.has(t)}
              onChange={() => toggleType(t)}
            />
            <span
              style={{
                width: 8,
                height: 8,
                background: SAT_TYPE_COLORS[t],
                display: 'inline-block',
                flexShrink: 0,
              }}
            />
            {t}
          </label>
        ))}
      </div>

      <div style={{ maxHeight: 220, overflow: 'auto' }}>
        <table style={{ fontSize: 11, width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {th('name', 'Name')}
              {th('type', 'Type')}
              {th('altKm', 'Alt km')}
              {th('velocityKmS', 'Vel km/s')}
              {th('inclinationDeg', 'Incl')}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, ROW_CAP).map((s) => (
              <tr key={s.id}>
                <td title={s.name}>{s.name}</td>
                <td>{s.type}</td>
                <td>{Math.round(s.altKm)}</td>
                <td>{s.velocityKmS.toFixed(2)}</td>
                <td>{s.inclinationDeg.toFixed(1)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button onClick={() => p.onCenter(s.id)} title="Center">
                    &#9678;
                  </button>
                  <button onClick={() => p.onTrack(s.id)} title="Track">
                    &#8857;
                  </button>
                  <button onClick={() => p.onDetails(s.id)} title="Details">
                    &#x2139;
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > ROW_CAP && (
          <div style={{ fontSize: 10, opacity: 0.7 }}>
            Showing first {ROW_CAP} of {rows.length} (filter to narrow).
          </div>
        )}
      </div>
    </fieldset>
  );
}
