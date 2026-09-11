/**
 * Spectre — wireless-signal OSINT mapping (P1: place → nearby Wi-Fi on the map).
 *
 * Signal engine ported from WireTapper by h9zdev, CC BY-NC 4.0 (see the About line). Egress is
 * Tor-default and fail-closed: the map queries run through the main process's Tor gate, clearnet
 * only behind the one-time real-IP acknowledgement — the renderer never fetches anything itself.
 * API keys live encrypted in the main process; this screen only ever learns which slots are filled.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GeoItem } from '@shared/post-mvp-types';
import type { SpectreDevice, SpectreKeyStatus, SpectreQueryResult } from '@shared/spectre/types';
import { MapGL } from '../geoint/MapGL';
import { toast } from '../../state/toasts';

/** A device → a GeoItem so it plots on the shared GeoINT map with no second map engine. */
function toGeoItem(d: SpectreDevice, i: number): GeoItem {
  return {
    id: `spectre-${i}-${d.bssid ?? d.ssid ?? `${d.lat},${d.lon}`}`,
    sourceId: d.source,
    title: d.ssid || d.bssid || d.type,
    lat: d.lat,
    lon: d.lon,
    located: 'geo',
    category: d.type,
    summary: [d.vendor, d.bssid, d.signal != null ? `signal ${d.signal}` : ''].filter(Boolean).join(' · '),
  };
}

/** Parse a "lat, lon" string, or null if it isn't one — lets the search box take either a place or
 *  a coordinate pair without a second control. */
function parseLatLon(raw: string): { lat: number; lon: number } | null {
  const m = raw.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]); const lon = Number(m[2]);
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

const KEY_LABELS: Array<{ slot: keyof SpectreKeyStatus; label: string; hint: string }> = [
  { slot: 'wigleName', label: 'WiGLE API name', hint: 'from wigle.net account → Show My Token' },
  { slot: 'wigleToken', label: 'WiGLE API token', hint: 'the token beside the name' },
];

export function SpectreModule(): JSX.Element {
  const [tab, setTab] = useState<'map' | 'settings'>('map');
  const [queryText, setQueryText] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SpectreQueryResult | null>(null);
  const [flyTo, setFlyTo] = useState<{ lat: number; lon: number; key: number } | null>(null);
  const [egress, setEgress] = useState<{ clearnet: boolean; clearnetAck: boolean; torReady: boolean }>({ clearnet: false, clearnetAck: false, torReady: false });
  const [keyStatus, setKeyStatus] = useState<SpectreKeyStatus | null>(null);
  const [keyDraft, setKeyDraft] = useState<Record<string, string>>({});

  const refreshMeta = useCallback(async () => {
    try { setEgress(await window.api.spectre.getEgress()); } catch { /* offline */ }
    try { setKeyStatus(await window.api.spectre.keyStatus()); } catch { /* offline */ }
  }, []);
  useEffect(() => { void refreshMeta(); }, [refreshMeta]);

  const items = useMemo(() => (result?.devices ?? []).map(toGeoItem), [result]);

  async function run(): Promise<void> {
    const text = queryText.trim();
    if (!text) { toast.warn('Enter a place name or a "lat, lon" pair.'); return; }
    const coord = parseLatLon(text);
    setRunning(true);
    try {
      const res = await window.api.spectre.query(coord ? { lat: coord.lat, lon: coord.lon, mode: 'wifi' } : { place: text, mode: 'wifi' });
      setResult(res);
      setFlyTo({ lat: res.center.lat, lon: res.center.lon, key: Date.now() });
      const failed = res.notes.filter((n) => !n.ok);
      if (res.devices.length === 0 && failed.length) toast.warn(failed[0].reason ?? 'No results.');
      else toast.success(`${res.devices.length} device(s) near ${res.center.label ?? `${res.center.lat.toFixed(3)}, ${res.center.lon.toFixed(3)}`}.`);
    } catch (err) {
      // A blocked Tor gate surfaces here as a thrown reason — say it plainly.
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  async function saveKeys(): Promise<void> {
    const patch: Record<string, string> = {};
    for (const { slot } of KEY_LABELS) if (keyDraft[slot] !== undefined) patch[slot] = keyDraft[slot];
    if (!Object.keys(patch).length) { toast.warn('Nothing to save.'); return; }
    setKeyStatus(await window.api.spectre.saveKeys(patch));
    setKeyDraft({});
    toast.success('Keys saved (encrypted).');
  }

  async function toggleClearnet(next: boolean): Promise<void> {
    if (next) {
      const ok = window.confirm(
        'Turn OFF Tor for Spectre?\n\nQueries will use your REAL IP address, visible to WiGLE and the other API providers. Only do this if you understand the exposure.',
      );
      if (!ok) return;
    }
    const res = await window.api.spectre.setClearnet({ clearnet: next, clearnetAck: next });
    setEgress((e) => ({ ...e, ...res }));
  }

  return (
    /* FIELD BUG, found by actually launching the packaged app and measuring the real DOM
     * (jsdom does no layout — this was invisible to every unit test). `Window.tsx` already
     * renders this component inside its OWN `.ga98-window-shell` > `.window` > `.window-body`,
     * so this is a SECOND, nested `.ga98-window-shell`. That class is `position:absolute` with
     * no explicit width (theme.css), so without an explicit `width` here it shrink-wraps to
     * its own content instead of filling the real window — measured live at 424px inside a
     * 920px window. `width:'100%'` makes it a definite box instead of shrink-to-fit. */
    <div className="ga98-window-shell" style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
      <div className="ga98-spectre-bar">
        <button type="button" className={tab === 'map' ? 'active' : ''} onClick={() => setTab('map')}>Map Search</button>
        <button type="button" className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>Settings</button>
        <span className={`ga98-spectre-egress ${egress.clearnet && egress.clearnetAck ? 'clearnet' : egress.torReady ? 'tor' : 'blocked'}`}>
          {egress.clearnet && egress.clearnetAck ? 'CLEARNET (real IP)' : egress.torReady ? 'TOR' : 'TOR — not ready'}
        </span>
      </div>

      {tab === 'map' ? (
        <div className="ga98-split" style={{ flex: 1, minHeight: 0 }}>
          <div className="ga98-pane" style={{ width: 260, flex: '0 0 auto', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ display: 'flex', gap: 4, padding: 4 }}>
              <input
                aria-label="Place or coordinates"
                placeholder='Place name or "51.5, -0.1"'
                value={queryText}
                onChange={(e) => setQueryText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void run(); }}
                style={{ flex: 1, minWidth: 0 }}
              />
              <button type="button" disabled={running} onClick={() => { void run(); }}>{running ? '…' : 'Scan'}</button>
            </div>
            <div className="ga98-spectre-results" style={{ flex: 1, overflow: 'auto' }}>
              {!result && <p style={{ color: 'var(--ga98-dim-soft)', fontSize: 11, padding: 6 }}>Enter a place and Scan to map nearby Wi-Fi from WiGLE.</p>}
              {result?.notes.filter((n) => !n.ok).map((n, i) => (
                <p key={i} className="ga98-spectre-note" style={{ fontSize: 11, padding: '2px 6px', color: 'var(--ga98-warn)' }}>{n.source}: {n.reason}</p>
              ))}
              <ul className="ga98-list" style={{ margin: 0 }}>
                {(result?.devices ?? []).map((d, i) => (
                  <li key={i} title={d.bssid}>
                    <strong>{d.ssid || d.bssid || '(unnamed)'}</strong>
                    <div style={{ fontSize: 11, color: 'var(--ga98-dim-soft)' }}>
                      {d.type}{d.vendor ? ` · ${d.vendor}` : ''}{d.signal != null ? ` · ${d.signal}` : ''}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="ga98-pane" style={{ flex: 1, minWidth: 0 }}>
            <MapGL items={items} flyTo={flyTo} />
          </div>
        </div>
      ) : (
        <div className="ga98-pane" style={{ flex: 1, overflow: 'auto', padding: 10 }}>
          <fieldset>
            <legend>Egress</legend>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={egress.clearnet && egress.clearnetAck} onChange={(e) => { void toggleClearnet(e.target.checked); }} />
              Use clearnet (real IP) instead of Tor
            </label>
            <p style={{ fontSize: 11, color: 'var(--ga98-dim-soft)', margin: '4px 0 0' }}>
              Default is Tor. With Tor off, every API query uses your real IP. {egress.torReady ? '' : 'Tor is not currently ready.'}
            </p>
          </fieldset>
          <fieldset style={{ marginTop: 8 }}>
            <legend>WiGLE API key</legend>
            {KEY_LABELS.map(({ slot, label, hint }) => (
              <label key={slot} style={{ display: 'block', marginBottom: 6 }}>
                {label} {keyStatus?.[slot] ? <span style={{ color: 'var(--ga98-ok)' }}>· set</span> : <span style={{ color: 'var(--ga98-dim-soft)' }}>· not set</span>}
                <input
                  type="password"
                  placeholder={hint}
                  value={keyDraft[slot] ?? ''}
                  onChange={(e) => setKeyDraft((d) => ({ ...d, [slot]: e.target.value }))}
                  style={{ display: 'block', width: '100%' }}
                />
              </label>
            ))}
            <button type="button" onClick={() => { void saveKeys(); }}>Save keys</button>
            <p style={{ fontSize: 11, color: 'var(--ga98-dim-soft)', margin: '6px 0 0' }}>
              Stored encrypted on this device; never shown again after saving.
            </p>
          </fieldset>
          <p style={{ fontSize: 11, color: 'var(--ga98-dim-soft)', marginTop: 12 }}>
            Signal engine ported from <strong>WireTapper</strong> by h9zdev, licensed CC BY-NC 4.0.
            Live BLE/SDR radio features require Linux hardware and arrive with the Linux build.
          </p>
        </div>
      )}
    </div>
  );
}
