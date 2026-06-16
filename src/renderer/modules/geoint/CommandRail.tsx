/**
 * GeoINT command-center right rail (R9) — the dark command-center column that renders ONLY in
 * globe mode (useMapGL=true). When useMapGL is false the rail is never mounted and the live
 * 2-column Leaflet layout is untouched.
 *
 * HONESTY CONSTRAINT (charter): every panel shows data the app genuinely computes and labels its
 * source. Counts come from the real `items`/`visibleItems` sets; Monitored Situations from the
 * real `corroboration` memo; the threat level from `deriveThreatLevel`, whose basis is shown.
 * Nothing here fabricates a "live" metric.
 *
 * It owns no state — GeoIntModule owns everything and passes it down. The rail mirrors existing
 * handlers (basemap/labels, setFocusId) rather than duplicating logic.
 */

import type { GeoItem } from '@shared/post-mvp-types';
import { LiveNewsPanel } from './LiveNewsPanel';
import { deriveThreatLevel, categoryCounts, UNCATEGORIZED } from './threat';

// Category → marker color (mirrors GeoIntModule/MapPane/MapGL CATEGORY_COLOR). Re-declared here so
// the rail colours its category rows identically; a neutral grey for the uncategorized bucket.
const CATEGORY_COLOR: Record<string, string> = {
  conflict: '#c0392b', cyber: '#8e44ad', protest: '#e67e22',
  disaster: '#16a085', crime: '#7f8c8d', politics: '#2980b9'
};
function colorFor(cat: string): string {
  return CATEGORY_COLOR[cat] ?? '#555';
}

// Threat level → accent colour for the badge (UI only; derived purely from deriveThreatLevel).
const LEVEL_COLOR: Record<string, string> = {
  NONE: '#2c7', GUARDED: '#7c2', ELEVATED: '#ec0', HIGH: '#e80', SEVERE: '#e33'
};

function isLocated(i: GeoItem): boolean {
  return Number.isFinite(i.lat) && Number.isFinite(i.lon);
}

export interface CommandRailProps {
  /** Full (timeline-filtered) item set fed to the map — the rail's "visible set". */
  visibleItems: GeoItem[];
  /** Corroboration counts per item id (from corroborate()). */
  corroboration: Map<string, number>;
  /** Fly the map to + focus an item by id. */
  onFocus: (id: string) => void;
  /** Category filter: the set of category keys currently enabled (shown on the map). */
  categoryFilter: ReadonlySet<string>;
  /** Toggle one category key on/off. */
  onToggleCategory: (key: string, on: boolean) => void;
  /** Basemap controls — mirrored from the left pane (no duplicated logic). */
  basemap: 'street' | 'satellite';
  onBasemap: (b: 'street' | 'satellite') => void;
  labels: boolean;
  onLabels: (on: boolean) => void;
  /** Egress gate — disables the network-dependent imagery buttons when off. */
  net: boolean;
}

// Shared dark-panel chrome: keeps the Win98 fieldset/legend conventions but on a dark face so the
// rail reads as the command-center column. Light text on dark panels.
const railPanelStyle: React.CSSProperties = {
  background: '#11161f', border: '1px solid #2a3344', color: '#cdd6e4',
  margin: '0 0 8px', padding: 8
};
const railLegendStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 'bold', letterSpacing: 0.5, textTransform: 'uppercase',
  color: '#8fb7e0', margin: '0 0 6px'
};
const sourceNoteStyle: React.CSSProperties = { fontSize: 10, color: '#6b7688', margin: '6px 0 0' };

export function CommandRail(props: CommandRailProps): JSX.Element {
  const {
    visibleItems, corroboration, onFocus,
    categoryFilter, onToggleCategory,
    basemap, onBasemap, labels, onLabels, net
  } = props;

  const located = visibleItems.filter(isLocated);
  const counts = categoryCounts(visibleItems);
  // Stable category row order: the known categories first (legend order), then uncategorized last.
  const knownOrder = Object.keys(CATEGORY_COLOR);
  const catKeys = [
    ...knownOrder.filter((k) => counts.has(k)),
    ...[...counts.keys()].filter((k) => !knownOrder.includes(k) && k !== UNCATEGORIZED).sort(),
    ...(counts.has(UNCATEGORIZED) ? [UNCATEGORIZED] : [])
  ];
  const threat = deriveThreatLevel(visibleItems);

  // Monitored situations: corroborated items (>=1 other source agrees on place+time). Sorted by
  // agreement count desc so the most-corroborated sit on top. Reuses the upstream corroboration memo.
  const situations = visibleItems
    .map((i) => ({ item: i, count: corroboration.get(i.id) ?? 0 }))
    .filter((s) => s.count >= 1)
    .sort((a, b) => b.count - a.count);

  return (
    <div
      className="ga98-pane ga98-geo-rail"
      style={{
        flex: '0 0 300px', minWidth: 300, maxWidth: 300, height: '100%',
        overflowY: 'auto', overflowX: 'hidden',
        // The 16px Win98 (::-webkit-scrollbar) classic scrollbar is drawn OVER the right padding, so
        // with a small right padding it bleeds into the content and hides the rail's right-edge
        // controls (stream ×, HLS dropdown, Add stream). Pad the right by 24px = 16px scrollbar + an
        // 8px gap matching the left, so content always clears the scrollbar.
        background: '#0a0f1a', color: '#cdd6e4', padding: '8px 24px 8px 8px', boxSizing: 'border-box'
      }}
    >
      {/* 1 — Live News (relocated from the right-pane "▶ News" overlay to the top of the rail). */}
      <div style={railPanelStyle}>
        <div style={railLegendStyle}>Live News</div>
        <LiveNewsPanel />
      </div>

      {/* 2 — Global Threat View: real counts + per-category filter toggles + derived threat level. */}
      <div style={railPanelStyle}>
        <div style={railLegendStyle}>Global Threat View</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 22, fontWeight: 'bold', color: '#e6edf6' }}>{located.length}</span>
          <span style={{ fontSize: 11, color: '#8a96a8' }}>located event{located.length === 1 ? '' : 's'}</span>
        </div>
        <div
          title={`Threat level is a step function of the high-severity count: ${threat.basis}`}
          style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}
        >
          <span style={{
            background: LEVEL_COLOR[threat.level] ?? '#555', color: '#0a0f1a',
            fontSize: 11, fontWeight: 'bold', padding: '1px 8px', borderRadius: 2, letterSpacing: 0.5
          }}>{threat.level}</span>
          <span style={{ fontSize: 10, color: '#6b7688' }}>{threat.basis}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {catKeys.length === 0 && <span style={{ fontSize: 11, color: '#6b7688' }}>No events in view.</span>}
          {catKeys.map((k) => {
            const on = categoryFilter.has(k);
            return (
              <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, cursor: 'pointer', opacity: on ? 1 : 0.55 }}>
                <input type="checkbox" checked={on} onChange={(e) => onToggleCategory(k, e.target.checked)} />
                <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: colorFor(k), border: '1px solid rgba(0,0,0,.5)' }} />
                <span style={{ flex: 1, textTransform: k === UNCATEGORIZED ? 'none' : 'capitalize' }}>{k === UNCATEGORIZED ? 'uncategorized' : k}</span>
                <span style={{ color: '#8a96a8' }}>{counts.get(k)}</span>
              </label>
            );
          })}
        </div>
        <p style={sourceNoteStyle}>Source: located feed + threat-layer events in view. Threat level = bucketed high-severity count.</p>
      </div>

      {/* 3 — Monitored Situations: corroboration clusters (>=2 sources agree on place+time). */}
      <div style={railPanelStyle}>
        <div style={railLegendStyle}>Monitored Situations ({situations.length})</div>
        {situations.length === 0 ? (
          <p style={{ fontSize: 11, color: '#6b7688', margin: 0 }}>No corroborated clusters in view.</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 200, overflowY: 'auto' }}>
            {situations.map(({ item, count }) => (
              <li
                key={item.id}
                onClick={() => onFocus(item.id)}
                title={`${count + 1} sources agree on place+time — click to fly there`}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 2px', cursor: 'pointer', borderBottom: '1px solid #1b2230' }}
              >
                <span style={{ flex: 1, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</span>
                <span style={{ flex: '0 0 auto', fontSize: 10, fontWeight: 'bold', color: '#8fb7e0', background: '#1b2230', padding: '0 5px', borderRadius: 2 }}>×{count}</span>
              </li>
            ))}
          </ul>
        )}
        <p style={sourceNoteStyle}>Source: corroborate() — count of distinct other sources agreeing on place+time.</p>
      </div>

      {/* 4 — Visual Imagery: mirrors the left-pane basemap controls (no duplicated logic). */}
      <div style={railPanelStyle}>
        <div style={railLegendStyle}>Visual Imagery</div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => onBasemap('street')} disabled={!net} aria-pressed={basemap === 'street'}
            style={basemap === 'street' ? { borderStyle: 'inset', fontWeight: 'bold' } : {}}>2D</button>
          <button onClick={() => onBasemap('satellite')} disabled={!net} aria-pressed={basemap === 'satellite'}
            style={basemap === 'satellite' ? { borderStyle: 'inset', fontWeight: 'bold' } : {}}>Satellite</button>
          <label style={{ fontSize: 11, marginLeft: 6, display: 'inline-flex', alignItems: 'center', gap: 4, opacity: net ? 1 : 0.5 }}>
            <input type="checkbox" checked={labels} disabled={!net} onChange={(e) => onLabels(e.target.checked)} /> Labels
          </label>
        </div>
        <p style={sourceNoteStyle}>{net ? 'Esri World Imagery (satellite) · Esri labels overlay.' : 'Network off — imagery disabled.'}</p>
      </div>

      {/* 5 — Breaking News / Situation Feed: the visible items as a categorized clickable list. */}
      <div style={railPanelStyle}>
        <div style={railLegendStyle}>Situation Feed ({visibleItems.length})</div>
        {visibleItems.length === 0 ? (
          <p style={{ fontSize: 11, color: '#6b7688', margin: 0 }}>No events in view.</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 280, overflowY: 'auto' }}>
            {visibleItems.map((i) => {
              const cat = i.category ?? UNCATEGORIZED;
              const placeable = isLocated(i);
              return (
                <li
                  key={i.id}
                  onClick={() => placeable && onFocus(i.id)}
                  title={placeable ? 'Click to fly to this event' : 'No location'}
                  style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '3px 2px', cursor: placeable ? 'pointer' : 'default', borderBottom: '1px solid #1b2230' }}
                >
                  <span style={{ flex: '0 0 auto', marginTop: 3, width: 8, height: 8, borderRadius: '50%', background: colorFor(cat), border: '1px solid rgba(0,0,0,.5)' }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 11, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.title}</span>
                    <span style={{ fontSize: 9, color: '#6b7688' }}>{i.sourceId}{placeable ? '' : ' · no location'}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <p style={sourceNoteStyle}>Source: same feed + threat-layer items as the Events list (timeline-filtered).</p>
      </div>
    </div>
  );
}
