// src/renderer/modules/geoint/livefeeds/LiveFeedsPanel.tsx
/** Left-rail "LIVE FEEDS" panel: ADS-B aircraft toggle + AIS ship toggle, live counts,
 *  AIS API key field (password input + Save, gated behind net), and the adsb.lol ODbL
 *  attribution line. No egress, no telemetry. All state is owned by GeoIntModule. */

export interface LiveFeedsPanelProps {
  // Aircraft (ADS-B via adsb.lol)
  showAircraft: boolean;
  onToggleAircraft(b: boolean): void;
  aircraftCount: number;

  // Ships (AIS via AISStream.io WebSocket)
  showShips: boolean;
  onToggleShips(b: boolean): void;
  shipCount: number;

  // GeoINT network gate — both toggles and the AIS key field are disabled when off
  net: boolean;

  // AIS key field: draft lives in the parent; Save calls the parent which calls IPC
  hasAisKey: boolean;
  aisKeyDraft: string;
  onAisKeyDraft(v: string): void;
  onSaveAisKey(): void;

  // Optional status text surfaced from the main-side AIS socket (e.g. "connecting…", "error")
  aisStatus?: string | null;
}

export function LiveFeedsPanel(p: LiveFeedsPanelProps): JSX.Element {
  return (
    <fieldset style={{ marginTop: 6 }}>
      <legend>Live Feeds</legend>

      {/* ADS-B aircraft toggle */}
      <label
        style={{
          fontSize: 12,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          opacity: p.net ? 1 : 0.5,
        }}
      >
        <input
          type="checkbox"
          checked={p.showAircraft}
          disabled={!p.net}
          onChange={(e) => p.onToggleAircraft(e.target.checked)}
        />
        Live Aircraft (ADS-B) ({p.aircraftCount})
      </label>

      {/* AIS ships toggle */}
      <div style={{ marginTop: 4 }}>
        <label
          style={{
            fontSize: 12,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            opacity: p.net && p.hasAisKey ? 1 : 0.5,
          }}
        >
          <input
            type="checkbox"
            checked={p.showShips}
            disabled={!p.net || !p.hasAisKey}
            onChange={(e) => p.onToggleShips(e.target.checked)}
          />
          Live Ships (AIS) ({p.shipCount})
        </label>
        {p.net && !p.hasAisKey && (
          <span style={{ fontSize: 11, color: '#555', marginLeft: 4 }}>
            — store a key below to enable
          </span>
        )}
      </div>

      {/* AIS key field — mirrors the FIRMS/UCDP keyed-layer pattern */}
      <div className="field-row" style={{ gap: 4, alignItems: 'center', marginTop: 6 }}>
        <input
          className="ga98-text"
          style={{ flex: 1 }}
          type="password"
          placeholder={p.hasAisKey ? 'key stored — replace' : 'AISStream API key'}
          value={p.aisKeyDraft}
          disabled={!p.net}
          onChange={(e) => p.onAisKeyDraft(e.target.value)}
          title="AISStream.io API key (free, register at aisstream.io)"
        />
        <button
          disabled={!p.net}
          onClick={p.onSaveAisKey}
        >
          Save
        </button>
      </div>

      {/* AIS socket status */}
      {p.aisStatus && (
        <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>{p.aisStatus}</div>
      )}

      {/* ADS-B ODbL attribution */}
      <div style={{ fontSize: 10, color: '#777', marginTop: 6 }}>
        ADS-B data &copy; adsb.lol / contributors (ODbL)
      </div>
    </fieldset>
  );
}
