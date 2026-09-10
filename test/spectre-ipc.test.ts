// @vitest-environment node
/**
 * Spectre IPC — sender-gate, egress resolution, key handling. Everything the renderer can reach.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const assertTrustedSender = vi.fn((e: { __untrusted?: boolean }) => {
  if (e?.__untrusted) throw new Error('untrusted sender frame');
});
vi.mock('../src/main/capture/capture-window', () => ({ assertTrustedSender: (e: unknown) => assertTrustedSender(e as never) }));
vi.mock('../src/main/bgconn/tor-singleton', () => ({ getBgTor: () => null }));

import { registerSpectreIpc, type SpectreIpcDeps } from '../src/main/spectre/ipc';
import { channels } from '../src/shared/ipc-contracts';

type Fn = (e: unknown, ...a: unknown[]) => Promise<unknown>;

function harness(over: Partial<SpectreIpcDeps> = {}, torReady = true) {
  const handlers = new Map<string, Fn>();
  const keys = { wigleName: 'me', wigleToken: 'tok', opencellid: '', shodan: '', censysId: '', censysSecret: '', unwiredlabs: '' };
  const deps: SpectreIpcDeps = {
    loadEgressSettings: async () => ({ clearnet: false, clearnetAck: false }),
    torSocksPort: () => (torReady ? 9050 : null),
    transport: async (url: string, opts) => {
      if (url.includes('nominatim')) return { status: 200, body: JSON.stringify([{ lat: '51.5', lon: '-0.1', display_name: 'London' }]) };
      if (url.includes('wigle')) {
        expect(opts?.auth, 'wigle call must carry basic auth').toMatchObject({ user: 'me', pass: 'tok' });
        return { status: 200, body: JSON.stringify({ results: [{ trilat: 51.5, trilong: -0.1, ssid: 'RING-CAM', netid: 'A', level: -50 }] }) };
      }
      throw new Error(`unexpected host: ${url}`);
    },
    readKeys: async () => keys,
    saveKeys: (async (patch: Record<string, string>) => { Object.assign(keys, patch); const st: Record<string, boolean> = {}; for (const k of Object.keys(keys)) st[k] = Boolean((keys as Record<string, string>)[k]); return st; }) as never,
    keyStatus: (async () => { const st: Record<string, boolean> = {}; for (const k of Object.keys(keys)) st[k] = Boolean((keys as Record<string, string>)[k]); return st; }) as never,
    ...over,
  };
  registerSpectreIpc({ handle: (c: string, fn: never) => handlers.set(c, fn), deps });
  return { handlers, keys };
}

beforeEach(() => assertTrustedSender.mockClear());

describe('sender gate', () => {
  it('every handler rejects an untrusted sender before doing anything', async () => {
    const { handlers } = harness();
    for (const ch of Object.values(channels.spectre)) {
      await expect(handlers.get(ch)!({ __untrusted: true }, {})).rejects.toThrow(/untrusted sender/i);
    }
  });
});

describe('query orchestration (place → geocode → wifi)', () => {
  it('geocodes a place then plots WiGLE devices around it', async () => {
    const { handlers } = harness();
    const res = await handlers.get(channels.spectre.query)!({}, { place: 'London', mode: 'wifi' }) as {
      center: { lat: number; lon: number; label?: string }; devices: Array<{ ssid: string; type: string; source: string }>;
    };
    expect(res.center).toMatchObject({ lat: 51.5, lon: -0.1, label: 'London' });
    expect(res.devices[0]).toMatchObject({ ssid: 'RING-CAM', type: 'camera', source: 'wigle' });
  });

  it('accepts a direct lat/lon without geocoding', async () => {
    const { handlers } = harness();
    const res = await handlers.get(channels.spectre.query)!({}, { lat: 51.5, lon: -0.1, mode: 'wifi' }) as { devices: unknown[] };
    expect(res.devices).toHaveLength(1);
  });

  it('rejects a query with neither place nor coordinates', async () => {
    const { handlers } = harness();
    await expect(handlers.get(channels.spectre.query)!({}, { mode: 'wifi' })).rejects.toThrow(/place name or a lat\/lon/i);
  });
});

describe('egress — fail closed', () => {
  it('Tor not ready + no clearnet ack → the query is blocked, nothing dialled', async () => {
    // The transport would throw if reached; the gate must stop first.
    const { handlers } = harness({ transport: async () => { throw new Error('should not dial'); } }, false);
    await expect(handlers.get(channels.spectre.query)!({}, { place: 'London', mode: 'wifi' })).rejects.toThrow(/Tor is not ready/i);
  });
});

describe('keys', () => {
  it('saveKeys never returns the values, only which slots are filled', async () => {
    const { handlers } = harness();
    const status = await handlers.get(channels.spectre.saveKeys)!({}, { shodan: 'secret-value' }) as Record<string, boolean>;
    expect(status.shodan).toBe(true);
    expect(JSON.stringify(status)).not.toContain('secret-value');
  });
});
