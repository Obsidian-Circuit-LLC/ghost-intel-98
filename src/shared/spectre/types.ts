/**
 * Spectre — wireless-signal OSINT mapping. Types shared main↔renderer.
 *
 * Signal engine ported from WireTapper by h9zdev (CC BY-NC 4.0). The device shape and the API
 * contracts are transcribed from his `app.py`, not re-derived — the recorded failure mode is
 * guessing an upstream's params from memory.
 */

/** A located device/observation, normalized to one shape regardless of which API produced it —
 *  exactly his `classify_device`-normalized dict. Plots directly onto GeoINT's point features. */
export interface SpectreDevice {
  lat: number;
  lon: number;
  /** Network name / device name (SSID, BT name, …), when observed. */
  ssid?: string;
  /** Hardware/network id (BSSID / netid / IP), when observed. */
  bssid?: string;
  vendor?: string;
  /** Signal level as the source reported it (never synthesized). */
  signal?: number | string;
  /** Source-reported last-seen timestamp, verbatim. */
  timestamp?: string;
  /** Classified device category (his `classify_device` output). */
  type: string;
  /** Which upstream produced this observation — for the map legend and provenance. */
  source: 'wigle' | 'shodan' | 'censys' | 'opencellid' | 'unwiredlabs' | 'telemetry' | 'flock';
}

/** The API credentials Spectre holds, in the vault — never plaintext .env/SQLite as upstream does,
 *  and never returned to the renderer after write. */
export interface SpectreKeys {
  wigleName: string;
  wigleToken: string;
  opencellid: string;
  shodan: string;
  censysId: string;
  censysSecret: string;
  unwiredlabs: string;
}

/** Which key slots are filled — the ONLY key state the renderer ever sees (never the values). */
export type SpectreKeyStatus = Record<keyof SpectreKeys, boolean>;

/** A place-or-coordinate search the renderer submits. `mode` selects which observation kinds to
 *  gather (his `/nearby` mode switch). P1 supports `wifi`. */
export interface SpectreQuery {
  /** A free-text place name (geocoded via Nominatim) OR empty when lat/lon are supplied directly. */
  place?: string;
  lat?: number;
  lon?: number;
  mode: 'wifi' | 'cell' | 'bluetooth' | 'iot';
}

export interface SpectreQueryResult {
  /** The resolved centre the search ran around (from geocode or the supplied lat/lon). */
  center: { lat: number; lon: number; label?: string };
  devices: SpectreDevice[];
  /** Per-source outcome so a partial failure (one API down, one key missing) is reported, never
   *  swallowed — the honesty floor every collection path in this app now holds. */
  notes: Array<{ source: string; ok: boolean; reason?: string }>;
}
