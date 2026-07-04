import { describe, it, expect } from 'vitest';
import { channels } from '../src/shared/ipc-contracts';
import { createBonds, type BondIO } from '../src/main/services/memory/bonds';

/** In-memory fake IO — no real secure-fs, no filesystem. The register.ts handlers for
 *  bondList/bondAdd/bondRemove are thin delegations straight to `createBonds()`'s ops (see
 *  register.ts), so exercising that op sequence here is the light handler-level round-trip the
 *  task calls for, without needing to stand up electron's ipcMain. */
function makeFakeIO(): BondIO {
  let text: string | null = null;
  return {
    async read() { return text; },
    async write(t: string) { text = t; }
  };
}

describe('bond IPC', () => {
  it('declares the bond channels', () => {
    expect(channels.memory.bondList).toBe('memory:bondList');
    expect(channels.memory.bondAdd).toBe('memory:bondAdd');
    expect(channels.memory.bondRemove).toBe('memory:bondRemove');
  });

  it('add -> list -> remove round-trips through createBonds with an injected IO', async () => {
    const bonds = createBonds(makeFakeIO());
    await bonds.add('doc:a', 'fact:b');
    expect(await bonds.list()).toEqual([{ a: 'doc:a', b: 'fact:b' }]);
    await bonds.remove('doc:a', 'fact:b');
    expect(await bonds.list()).toEqual([]);
  });
});
