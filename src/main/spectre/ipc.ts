/**
 * Spectre — IPC registration (`registerSpectreIpc`). Every handler `assertTrustedSender(e)` FIRST
 * (wired via the event-preserving `safeHandleWithEvent`), then arg-validates before touching the
 * client, the encrypted key store, or the network.
 *
 * Egress is resolved MAIN-side from `AppSettings.spectre` + the live background-Tor SOCKS port
 * (`resolveSpectreEgress`): Tor-default, fail-closed, acked-clearnet opt-in — never a renderer-
 * supplied posture. Keys are read main-side from the encrypted store and never returned to the
 * renderer (only `keyStatus`). WireTapper engine by h9zdev (CC BY-NC 4.0).
 */
import { channels } from '@shared/ipc-contracts';
import { assertTrustedSender } from '../capture/capture-window';
import { getBgTor } from '../bgconn/tor-singleton';
import {
  geocode,
  queryWifi,
  resolveSpectreEgress,
  SpectreEgressBlockedError,
  type SpectreClientDeps,
  type SpectreEgressSettings,
} from './client';
import { keyStatus, readKeys, saveKeys } from './store';
import type { SpectreKeys, SpectreKeyStatus, SpectreQuery, SpectreQueryResult } from '@shared/spectre/types';

export type SpectreHandle = (
  channel: string,
  fn: (e: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown,
) => void;

export const SPECTRE_PLACE_MAX = 300;

export interface SpectreIpcDeps {
  loadEgressSettings(): Promise<SpectreEgressSettings>;
  torSocksPort(): number | null;
  /** Injected transport for tests; production uses the client's Tor/clearnet transport. */
  transport?: SpectreClientDeps['transport'];
  /** Injected key seams for tests. */
  readKeys?: typeof readKeys;
  saveKeys?: typeof saveKeys;
  keyStatus?: typeof keyStatus;
}

function prodDeps(): SpectreIpcDeps {
  return {
    loadEgressSettings: async () => {
      try {
        const { settingsStore } = await import('../storage/json-fs');
        const s = await settingsStore.read();
        return { clearnet: s.spectre?.clearnet === true, clearnetAck: s.spectre?.clearnetAck === true };
      } catch {
        return { clearnet: false, clearnetAck: false }; // fail-closed to Tor mode
      }
    },
    torSocksPort: () => {
      try { const tor = getBgTor(); return tor?.isBootstrapped() ? tor.socksPort() : null; } catch { return null; }
    },
  };
}

/** Resolve the client deps (egress posture + live Tor port + transport) for a network op. */
async function buildClientDeps(deps: SpectreIpcDeps): Promise<SpectreClientDeps> {
  const settings = await deps.loadEgressSettings();
  const egress = resolveSpectreEgress(settings, { torReady: deps.torSocksPort() !== null, socksPort: deps.torSocksPort() ?? undefined });
  return { egress, transport: deps.transport };
}

function validateQuery(raw: unknown): SpectreQuery {
  if (!raw || typeof raw !== 'object') throw new Error('spectre: a query object is required');
  const o = raw as Record<string, unknown>;
  const mode = o.mode === 'cell' || o.mode === 'bluetooth' || o.mode === 'iot' ? o.mode : 'wifi';
  const place = typeof o.place === 'string' ? o.place.slice(0, SPECTRE_PLACE_MAX) : undefined;
  const lat = o.lat === undefined ? undefined : Number(o.lat);
  const lon = o.lon === undefined ? undefined : Number(o.lon);
  if (lat !== undefined && (!Number.isFinite(lat) || lat < -90 || lat > 90)) throw new Error('spectre: latitude out of range');
  if (lon !== undefined && (!Number.isFinite(lon) || lon < -180 || lon > 180)) throw new Error('spectre: longitude out of range');
  if (!place && (lat === undefined || lon === undefined)) throw new Error('spectre: a place name or a lat/lon pair is required');
  return { mode, ...(place ? { place } : {}), ...(lat !== undefined ? { lat } : {}), ...(lon !== undefined ? { lon } : {}) };
}

function validateKeyPatch(raw: unknown): Partial<SpectreKeys> {
  if (!raw || typeof raw !== 'object') throw new Error('spectre: a key patch object is required');
  const o = raw as Record<string, unknown>;
  const out: Partial<SpectreKeys> = {};
  for (const k of ['wigleName', 'wigleToken', 'opencellid', 'shodan', 'censysId', 'censysSecret', 'unwiredlabs'] as (keyof SpectreKeys)[]) {
    if (o[k] !== undefined) {
      if (typeof o[k] !== 'string') throw new Error(`spectre: ${k} must be a string`);
      out[k] = o[k] as string;
    }
  }
  return out;
}

export function registerSpectreIpc(opts: { handle: SpectreHandle; deps?: SpectreIpcDeps }): void {
  const deps = opts.deps ?? prodDeps();
  const rk = deps.readKeys ?? readKeys;
  const sk = deps.saveKeys ?? saveKeys;
  const ks = deps.keyStatus ?? keyStatus;
  const h = opts.handle;

  h(channels.spectre.query, async (e, arg) => {
    assertTrustedSender(e);
    const q = validateQuery(arg);
    const clientDeps = await buildClientDeps(deps);

    // Resolve the centre: a place is geocoded (keyless), else the validated lat/lon is used.
    let center: SpectreQueryResult['center'];
    try {
      if (q.place) {
        const hit = await geocode(q.place, clientDeps);
        if (!hit) return { center: { lat: 0, lon: 0 }, devices: [], notes: [{ source: 'nominatim', ok: false, reason: 'Location not found.' }] } as SpectreQueryResult;
        center = { lat: hit.lat, lon: hit.lon, ...(hit.label ? { label: hit.label } : {}) };
      } else {
        center = { lat: q.lat as number, lon: q.lon as number };
      }
    } catch (err) {
      if (err instanceof SpectreEgressBlockedError) throw new Error(err.message);
      throw err;
    }

    // P1: wifi only. Other modes arrive in P2 with their clients.
    try {
      const keys = await rk();
      const { devices, notes } = await queryWifi(center.lat, center.lon, keys, clientDeps);
      return { center, devices, notes } as SpectreQueryResult;
    } catch (err) {
      if (err instanceof SpectreEgressBlockedError) throw new Error(err.message);
      throw err;
    }
  });

  h(channels.spectre.keyStatus, async (e) => {
    assertTrustedSender(e);
    return ks() as Promise<SpectreKeyStatus>;
  });

  h(channels.spectre.saveKeys, async (e, arg) => {
    assertTrustedSender(e);
    return sk(validateKeyPatch(arg));
  });

  h(channels.spectre.getEgress, async (e) => {
    assertTrustedSender(e);
    const s = await deps.loadEgressSettings();
    return { clearnet: s.clearnet, clearnetAck: s.clearnetAck, torReady: deps.torSocksPort() !== null };
  });

  h(channels.spectre.setClearnet, async (e, arg) => {
    assertTrustedSender(e);
    const o = (arg && typeof arg === 'object' ? arg : {}) as Record<string, unknown>;
    const clearnet = o.clearnet === true;
    // Enabling clearnet REQUIRES the one-time real-IP acknowledgement in the same call — an un-acked
    // flag can never leave Tor (client enforces this too; the store must never persist an un-acked on).
    const clearnetAck = clearnet ? o.clearnetAck === true : false;
    if (clearnet && !clearnetAck) throw new Error('spectre: enabling clearnet requires the real-IP acknowledgement');
    const { settingsStore } = await import('../storage/json-fs');
    const next = await settingsStore.update({ spectre: { clearnet, clearnetAck } });
    return { clearnet: next.spectre.clearnet, clearnetAck: next.spectre.clearnetAck };
  });
}
