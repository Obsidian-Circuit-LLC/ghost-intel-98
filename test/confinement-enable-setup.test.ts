import { describe, it, expect, vi } from 'vitest';
import { makeEnableSetup } from '../src/main/offensive/confinement/enable-setup';

describe('enable-setup', () => {
  it('status() is not-enabled when the sid file is absent', async () => {
    const es = makeEnableSetup({ platform: 'win32', readSidFile: () => { throw new Error('ENOENT'); }, elevate: vi.fn() });
    expect(await es.status()).toEqual({ enabled: false, engineSid: null });
  });

  it('status() reports enabled + the SID when present', async () => {
    const es = makeEnableSetup({ platform: 'win32', readSidFile: () => 'S-1-5-21-9-9-9-1001', elevate: vi.fn() });
    expect(await es.status()).toEqual({ enabled: true, engineSid: 'S-1-5-21-9-9-9-1001' });
  });

  it('enable() runs the elevated installer then re-checks status', async () => {
    let installed = false;
    const elevate = vi.fn(async () => { installed = true; });
    const es = makeEnableSetup({ platform: 'win32', elevate, readSidFile: () => installed ? 'S-1-5-21-9-9-9-1001' : (() => { throw new Error('ENOENT'); })() });
    const r = await es.enable();
    expect(elevate).toHaveBeenCalledWith(expect.stringContaining('dcs98-confine'), ['install']);
    expect(r).toEqual({ enabled: true, engineSid: 'S-1-5-21-9-9-9-1001' });
  });

  it('enable() refuses on non-win32 (engine confinement is win32/linux only)', async () => {
    const es = makeEnableSetup({ platform: 'darwin', readSidFile: () => { throw new Error('ENOENT'); }, elevate: vi.fn() });
    await expect(es.enable()).rejects.toThrow(/not supported/);
  });
});
