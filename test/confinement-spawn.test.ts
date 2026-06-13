import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  spawnConfined,
  __setPlatformImplsForTest,
  type ConfinedHandle,
  type ConfinementPlan,
} from '../src/main/offensive/confinement';

// Minimal plan; spawnConfined treats it as opaque and forwards it to the impl.
const plan: ConfinementPlan = { proxyPort: 9050, allowCidrs: ['10.0.0.0/8'], domainOnlyIncludes: [] };
const io = {};

afterEach(() => {
  // Restore real platform + clear any injected impls so cases don't bleed.
  __setPlatformImplsForTest({ platform: process.platform });
});

describe('spawnConfined platform dispatch', () => {
  it('refuses on macOS', async () => {
    __setPlatformImplsForTest({ platform: 'darwin' });
    await expect(spawnConfined('curl', ['x'], plan, io)).rejects.toThrow(/not supported on macOS/);
  });

  it('routes to the linux impl', async () => {
    const handle: ConfinedHandle = { pid: 42, stop: async () => {} };
    const linux = vi.fn(async () => handle);
    __setPlatformImplsForTest({ platform: 'linux', linux });
    const got = await spawnConfined('curl', ['a', 'b'], plan, io);
    expect(got).toBe(handle);
    expect(linux).toHaveBeenCalledTimes(1);
    expect(linux).toHaveBeenCalledWith('curl', ['a', 'b'], plan, io);
  });

  it('routes to the win32 impl', async () => {
    const handle: ConfinedHandle = { pid: 7, stop: async () => {} };
    const win32 = vi.fn(async () => handle);
    __setPlatformImplsForTest({ platform: 'win32', win32 });
    const got = await spawnConfined('nmap', ['-sS'], plan, io);
    expect(got).toBe(handle);
    expect(win32).toHaveBeenCalledTimes(1);
    expect(win32).toHaveBeenCalledWith('nmap', ['-sS'], plan, io);
  });

  it('fails loud when the platform impl is not registered', async () => {
    __setPlatformImplsForTest({ platform: 'linux' });
    await expect(spawnConfined('curl', [], plan, io)).rejects.toThrow(/impl not registered/);
  });

  it('rejects an unsupported platform', async () => {
    __setPlatformImplsForTest({ platform: 'freebsd' });
    await expect(spawnConfined('curl', [], plan, io)).rejects.toThrow(/unsupported on platform/);
  });
});
