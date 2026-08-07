/**
 * TG5 — TelegramHunterCollector unit suite.
 *
 * The engine swap: SOCMINT's mtcute streaming collector is replaced by the
 * Telegram Hunter capture-window engine. `TelegramHunterCollector` must satisfy the
 * existing `SocmintCollector` interface (so the socmint store/rank/filter/IPC seam is
 * reused unchanged) AND expose the capture-window operations the Telegram tab drives
 * (open / captureMessages / captureGroupMembers).
 *
 * Every collaborator is an INJECTED seam so this runs without electron/network/Tor:
 *   - `openFn` stands in for `session.ts` `openTelegramCapture` (the Tor-fail-closed
 *     window opener). Blocked (Tor not ready) ⇒ connect() THROWS and opens NO window —
 *     there is never a clearnet fallback.
 *   - `captureMessagesFn` / `captureMembersFn` stand in for the TG1/TG2 orchestrators.
 *
 * The module is quarantine-clean at import (collector.ts pulls no electron statically —
 * the session opener is a lazy import inside the default seam), so this test needs no
 * electron mock.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  TelegramHunterCollector,
  makeTelegramHunterCollector,
} from '../src/main/socmint/telegram-hunter/collector';
import type { SocmintCollector } from '../src/main/socmint/collector';

function fakeWin() {
  return {
    webContents: {
      executeJavaScript: vi.fn(async () => []),
      setWebRTCIPHandlingPolicy: vi.fn(),
    },
    isDestroyed: vi.fn(() => false),
    close: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
  } as unknown as Electron.BrowserWindow;
}

describe('TelegramHunterCollector — SocmintCollector interface', () => {
  it('implements every SocmintCollector method', () => {
    const c = new TelegramHunterCollector();
    for (const m of ['connect', 'join', 'backfill', 'subscribe', 'disconnect'] as const) {
      expect(typeof (c as unknown as Record<string, unknown>)[m]).toBe('function');
    }
    // Structural: an instance is assignable to the interface.
    const asIface: SocmintCollector = c;
    expect(asIface).toBeTruthy();
  });

  it('connect() opens the Tor-gated capture window', async () => {
    const win = fakeWin();
    const openFn = vi.fn(async () => ({ win }));
    const c = new TelegramHunterCollector({ openFn });
    await c.connect();
    expect(openFn).toHaveBeenCalledTimes(1);
    expect(c.isOpen()).toBe(true);
  });

  it('connect() THROWS and opens NO window when Tor is not ready (fail-closed, no clearnet fallback)', async () => {
    const openFn = vi.fn(async () => ({ blocked: true as const, reason: 'Tor is not ready — Telegram capture is blocked.' }));
    const c = new TelegramHunterCollector({ openFn });
    await expect(c.connect()).rejects.toThrow(/Tor is not ready/);
    expect(c.isOpen()).toBe(false);
  });

  it('join() returns a MonitoredChannel without navigating', async () => {
    const c = new TelegramHunterCollector({ openFn: async () => ({ win: fakeWin() }) });
    const ch = await c.join('@target');
    expect(ch).toEqual({ channelId: '@target', label: '@target', keywords: [] });
  });

  it('backfill() runs a visible-message capture and returns the items without double-persisting', async () => {
    const items = [{ id: 'x' }] as never;
    const captureMessagesFn = vi.fn(async () => ({ blocked: false, added: 0, skipped: 0, items }));
    const c = new TelegramHunterCollector({ openFn: async () => ({ win: fakeWin() }), captureMessagesFn });
    await c.connect();
    const out = await c.backfill('@target', 20);
    expect(out).toBe(items);
    expect(captureMessagesFn).toHaveBeenCalledTimes(1);
    // backfill overrides saveItems to a no-op so it never writes the store a second time.
    const overrides = captureMessagesFn.mock.calls[0][2] as { saveItems?: unknown };
    expect(typeof overrides.saveItems).toBe('function');
  });

  it('subscribe() returns an unsubscribe function (capture model has no live push)', async () => {
    const c = new TelegramHunterCollector({ openFn: async () => ({ win: fakeWin() }) });
    await c.connect();
    const unsub = c.subscribe(['@t'], () => {});
    expect(typeof unsub).toBe('function');
    expect(() => unsub()).not.toThrow();
  });

  it('disconnect() closes the capture window', async () => {
    const win = fakeWin();
    const c = new TelegramHunterCollector({ openFn: async () => ({ win }) });
    await c.connect();
    await c.disconnect();
    expect(win.close).toHaveBeenCalled();
    expect(c.isOpen()).toBe(false);
  });

  it('captureMessages()/captureGroupMembers() delegate to the injected engine', async () => {
    const msgRes = { blocked: false, added: 1, skipped: 0, items: [] };
    const memRes = { blocked: false, added: 1, captured: 1, members: [] };
    const captureMessagesFn = vi.fn(async () => msgRes);
    const captureMembersFn = vi.fn(async () => memRes);
    const c = new TelegramHunterCollector({
      openFn: async () => ({ win: fakeWin() }),
      captureMessagesFn,
      captureMembersFn,
    });
    await c.connect();
    expect(await c.captureMessages({ caseId: 'c', jobId: 'j', channelId: 'ch', channelLabel: 'L' })).toBe(msgRes);
    expect(await c.captureGroupMembers({ caseId: 'c' })).toBe(memRes);
  });

  it('captureMessages() throws before connect() (no window)', async () => {
    const c = new TelegramHunterCollector({ openFn: async () => ({ win: fakeWin() }) });
    await expect(c.captureMessages({ caseId: 'c', jobId: 'j', channelId: 'ch', channelLabel: 'L' })).rejects.toThrow();
  });

  it('makeTelegramHunterCollector() satisfies the CollectorFactory signature and ignores burner/transport', () => {
    const col = makeTelegramHunterCollector({
      burnerId: 'b',
      transport: { mode: 'tor' } as never,
      harvestedAt: () => 'T',
    });
    const asIface: SocmintCollector = col;
    expect(typeof asIface.connect).toBe('function');
    expect(typeof asIface.disconnect).toBe('function');
  });
});
