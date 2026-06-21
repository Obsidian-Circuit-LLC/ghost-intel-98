import { describe, it, expect, vi, beforeEach } from 'vitest';
const net = { on: false }; const key = { val: '' };
const sent: string[] = []; let opened = false;
vi.mock('ws', () => ({
  default: class {
    onmsg?: any;
    constructor() { opened = true; }
    on(event: string, cb: () => void) {
      // Fire 'open' synchronously so subscribe() runs before startAis resolves.
      if (event === 'open') cb();
      return this;
    }
    send(s: string) { sent.push(s); }
    close() {}
    readyState = 1;
    static OPEN = 1;
  }
}));
vi.mock('../src/main/storage/json-fs', () => ({ settingsStore: { read: async () => ({ geoint: { networkEnabled: net.on } }) } }));
vi.mock('../src/main/secrets', () => ({ secretStore: { get: async () => (key.val || null) } }));
import { startAis, stopAis } from '../src/main/services/livefeeds/ais-stream';

beforeEach(() => { net.on = false; key.val = ''; sent.length = 0; opened = false; });

describe('AIS stream gating', () => {
  it('does not connect when the network gate is OFF', async () => {
    expect(await startAis({ west: -1, south: 51, east: 1, north: 53 }, () => {})).toBe('gate-off');
    expect(opened).toBe(false);
  });
  it('does not connect when no key is stored', async () => {
    net.on = true;
    expect(await startAis({ west: -1, south: 51, east: 1, north: 53 }, () => {})).toBe('no-key');
    expect(opened).toBe(false);
  });
  it('opens + sends a subscription with the bbox when gate on + key present', async () => {
    net.on = true; key.val = 'KEY123';
    expect(await startAis({ west: -1, south: 51, east: 1, north: 53 }, () => {})).toBe('started');
    expect(opened).toBe(true);
    expect(sent.length).toBeGreaterThan(0);
    const frame = JSON.parse(sent[0]);
    expect(frame.APIKey).toBe('KEY123');
    expect(Array.isArray(frame.BoundingBoxes) && frame.BoundingBoxes.length > 0).toBe(true);
    expect(frame.FilterMessageTypes).toContain('PositionReport');
    stopAis();
  });
});
