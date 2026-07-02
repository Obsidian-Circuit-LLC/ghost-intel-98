/**
 * GhostScrape (v3.27.0 W3) — openScrapeWindow session-isolation + credential-clearing wiring.
 *
 * The pure partitionForJob() helper is covered by ghostscrape-partition.test.ts, but nothing
 * asserted that openScrapeWindow actually WIRES that partition into session.fromPartition — so a
 * regression back to a shared `persist:ghostscrape` partition (the exact credential race this work
 * closed) would have stayed green. This test pins the wiring against a mocked electron:
 *
 *   1. session.fromPartition is called with `ghostscrape-<jobId>` (unique, non-persistent).
 *   2. the injected cookie is set on THAT session's jar.
 *   3. both permission handlers are installed (deny-by-default lockdown).
 *   4. dispose() destroys the window AND clears the session's storage — purging the injected
 *      X credentials from the resident in-memory jar (Electron 33 keeps fromPartition sessions
 *      alive for the app lifetime, so win.destroy() alone is not enough).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted so the vi.mock('electron') factory (lifted to the top of the file) can reach this state.
const h = vi.hoisted(() => {
  const fakeSession = {
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    cookies: { set: vi.fn().mockResolvedValue(undefined) },
    clearStorageData: vi.fn().mockResolvedValue(undefined),
  };
  const fromPartition = vi.fn(() => fakeSession);
  const windowDestroy = vi.fn();
  class FakeBrowserWindow {
    webContents = {
      debugger: {
        on(): void {},
        attach(): void {},
        off(): void {},
        detach(): void {},
        sendCommand: (): Promise<unknown> => Promise.resolve({}),
      },
    };
    isDestroyed(): boolean {
      return false;
    }
    destroy = windowDestroy;
  }
  return { fakeSession, fromPartition, windowDestroy, FakeBrowserWindow };
});

const { fakeSession, fromPartition, windowDestroy } = h;

vi.mock('electron', () => ({
  session: { fromPartition: (...args: unknown[]) => h.fromPartition(...args) },
  BrowserWindow: h.FakeBrowserWindow,
}));

import { openScrapeWindow } from '../src/main/x/ghostscrape/browser';
import type { XCookie } from '../src/main/x/ghostscrape/cookies';

const cookie: XCookie = {
  url: 'https://x.com',
  name: 'auth_token',
  value: 'SECRET_TOKEN',
  domain: '.x.com',
  path: '/',
  secure: true,
  httpOnly: true,
};

describe('openScrapeWindow — per-job session isolation + credential clearing', () => {
  beforeEach(() => {
    fromPartition.mockClear();
    windowDestroy.mockClear();
    fakeSession.setPermissionRequestHandler.mockClear();
    fakeSession.setPermissionCheckHandler.mockClear();
    fakeSession.cookies.set.mockClear();
    fakeSession.clearStorageData.mockClear();
  });

  it('opens the window on the UNIQUE per-job partition and injects the cookie there', async () => {
    await openScrapeWindow('job-XYZ', [cookie]);

    // Guards the shared-partition regression: must be the unique, non-persistent per-job name.
    expect(fromPartition).toHaveBeenCalledWith('ghostscrape-job-XYZ');
    const partitionArg = fromPartition.mock.calls[0][0] as string;
    expect(partitionArg).not.toMatch(/^persist:/);

    // The injected credential lands on THAT job-private session's jar.
    expect(fakeSession.cookies.set).toHaveBeenCalledWith(cookie);

    // Deny-by-default lockdown installed on the hidden session.
    expect(fakeSession.setPermissionRequestHandler).toHaveBeenCalledTimes(1);
    expect(fakeSession.setPermissionCheckHandler).toHaveBeenCalledTimes(1);
  });

  it('dispose() destroys the window AND clears the session storage (credentials purged)', async () => {
    const win = await openScrapeWindow('job-XYZ', [cookie]);

    expect(windowDestroy).not.toHaveBeenCalled();
    expect(fakeSession.clearStorageData).not.toHaveBeenCalled();

    await win.dispose();

    // Guards the credential-clearing regression: both must fire on dispose.
    expect(windowDestroy).toHaveBeenCalledTimes(1);
    expect(fakeSession.clearStorageData).toHaveBeenCalledTimes(1);
  });
});
