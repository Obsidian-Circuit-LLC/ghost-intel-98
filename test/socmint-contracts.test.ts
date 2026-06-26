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
    ];
    expect(Object.keys(g).sort()).toEqual([...expected].sort());
    for (const v of Object.values(g)) expect(v.startsWith('socmint:')).toBe(true);
  });

  it('channel values are globally unique', () => {
    const all = Object.values(channels as Record<string, Record<string, string>>).flatMap((grp) => Object.values(grp));
    expect(new Set(all).size).toBe(all.length);
  });
});
