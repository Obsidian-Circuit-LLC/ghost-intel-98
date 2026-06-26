import { describe, it, expect } from 'vitest';
import { channels } from '../src/shared/ipc-contracts';

describe('socmint channels', () => {
  it('exposes the expected channel set, all namespaced under socmint:', () => {
    const g = (channels as Record<string, Record<string, string>>).socmint;
    expect(g).toBeTruthy();
    const expected = [
      'addChannel', 'removeChannel', 'listChannels',
      'listItems', 'rankItems', 'recordLabel',
      'setBurner', 'hasBurner',
      'startMonitor', 'stopMonitor',
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
