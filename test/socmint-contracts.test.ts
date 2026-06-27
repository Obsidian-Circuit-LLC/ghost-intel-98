import { describe, it, expect, vi } from 'vitest';
import { channels } from '../src/shared/ipc-contracts';
import {
  handleSetWhatsappBurnerPairingCode,
  handleHasWhatsappBurner,
  handleUnlinkWhatsappBurner,
} from '../src/main/socmint/ipc';

describe('socmint channels', () => {
  it('exposes the expected channel set, all namespaced under socmint:', () => {
    const g = (channels as Record<string, Record<string, string>>).socmint;
    expect(g).toBeTruthy();
    const expected = [
      'addChannel', 'removeChannel', 'listChannels',
      'listItems', 'rankItems', 'recordLabel',
      'setBurner', 'hasBurner',
      'startMonitor', 'stopMonitor',
      // FIX 5: main→renderer live item push
      'monitorItem',
      // WA-T5: WhatsApp linking ceremony channels
      'setWhatsappBurnerPairingCode', 'hasWhatsappBurner', 'unlinkWhatsappBurner',
    ];
    expect(Object.keys(g).sort()).toEqual([...expected].sort());
    for (const v of Object.values(g)) expect(v.startsWith('socmint:')).toBe(true);
  });

  it('channel values are globally unique', () => {
    const all = Object.values(channels as Record<string, Record<string, string>>).flatMap((grp) => Object.values(grp));
    expect(new Set(all).size).toBe(all.length);
  });

  it('WhatsApp ceremony channels carry the socmint: prefix and distinct values', () => {
    const g = (channels as Record<string, Record<string, string>>).socmint;
    const waChs = [
      g.setWhatsappBurnerPairingCode,
      g.hasWhatsappBurner,
      g.unlinkWhatsappBurner,
    ];
    for (const ch of waChs) expect(ch.startsWith('socmint:')).toBe(true);
    expect(new Set(waChs).size).toBe(waChs.length);
  });
});

// WA-T10: register.ts wiring smoke — verify the three WhatsApp ceremony handlers
// that register.ts wires via safeHandle are exported and callable from ipc.ts.
describe('WA-T10: register.ts WhatsApp ceremony wiring', () => {
  it('handleSetWhatsappBurnerPairingCode is a function (wired via socmint:setWhatsappBurnerPairingCode)', () => {
    expect(typeof handleSetWhatsappBurnerPairingCode).toBe('function');
  });

  it('handleHasWhatsappBurner is a function (wired via socmint:hasWhatsappBurner)', () => {
    expect(typeof handleHasWhatsappBurner).toBe('function');
  });

  it('handleUnlinkWhatsappBurner is a function (wired via socmint:unlinkWhatsappBurner)', () => {
    expect(typeof handleUnlinkWhatsappBurner).toBe('function');
  });

  it('gate-closed: setWhatsappBurnerPairingCode returns { disabled: true } without touching the sealed library', async () => {
    const result = await handleSetWhatsappBurnerPairingCode(
      'burner-wa',
      '15551234567',
      { networkEnabled: async () => false },
    );
    expect(result).toEqual({ disabled: true });
  });

  it('gate-closed: hasWhatsappBurner returns false for empty burnerId without store access', async () => {
    // Injected mock store ensures the handler does not call into production secretStore.
    const mockStore = { get: vi.fn(), delete: vi.fn() };
    expect(await handleHasWhatsappBurner('', mockStore)).toBe(false);
    expect(mockStore.get).not.toHaveBeenCalled();
  });

  it('gate-closed: unlinkWhatsappBurner is a no-op for empty burnerId', async () => {
    const mockStore = { get: vi.fn(), delete: vi.fn() };
    await handleUnlinkWhatsappBurner('', mockStore);
    expect(mockStore.delete).not.toHaveBeenCalled();
  });
});
