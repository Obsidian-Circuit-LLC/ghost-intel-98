/**
 * Ghost Social Media Manager — IPC skeleton hardening (Phase 1, Global Constraint #7 + #8).
 *
 * Pins that EVERY registered handler:
 *   - rejects an IPC message from an UNTRUSTED sender frame (a remote social page can't drive
 *     the vault/state/defaults surface) — `assertTrustedSender` runs first; and
 *   - validates its argument SHAPE before doing anything (a hostile renderer's bad payload is
 *     refused, not passed through).
 *
 * The handlers are captured through a fake `handle`; no electron IPC is exercised.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: class {},
  session: {},
  app: { getPath: () => '/tmp/gs-ipc-test' },
  dialog: {},
}));

import { registerGhostSocialIpc } from '../src/main/ghost-social/ipc';
import { channels } from '../src/shared/ipc-contracts';

type Fn = (e: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown;

function collectHandlers(): Map<string, Fn> {
  const map = new Map<string, Fn>();
  registerGhostSocialIpc({ handle: (channel, fn) => map.set(channel, fn) });
  return map;
}

const TRUSTED = { senderFrame: { url: 'file:///app/dist/index.html' } } as unknown as Electron.IpcMainInvokeEvent;
const UNTRUSTED = { senderFrame: { url: 'https://x.com/' } } as unknown as Electron.IpcMainInvokeEvent;

describe('ghost-social IPC — registration + hardening', () => {
  it('registers all eight Phase-1 channels', () => {
    const h = collectHandlers();
    for (const ch of Object.values(channels.ghostSocial)) {
      expect(h.has(ch)).toBe(true);
    }
    expect(h.size).toBe(8);
  });

  it('every handler rejects an untrusted sender frame', async () => {
    const h = collectHandlers();
    for (const [channel, fn] of h) {
      await expect(Promise.resolve().then(() => fn(UNTRUSTED)), `channel ${channel}`).rejects.toThrow(
        /untrusted sender/i,
      );
    }
  });

  it('validates argument shape after the sender check (trusted frame, bad args)', async () => {
    const h = collectHandlers();
    const call = (ch: string, ...args: unknown[]) =>
      Promise.resolve().then(() => (h.get(ch) as Fn)(TRUSTED, ...args));

    await expect(call(channels.ghostSocial.vaultSetup, 123)).rejects.toThrow(/requires a password/i);
    await expect(call(channels.ghostSocial.vaultUnlock, '')).rejects.toThrow(/password or recovery key/i);
    await expect(call(channels.ghostSocial.vaultSaveRecoveryKey, '')).rejects.toThrow(/requires the key/i);
    await expect(call(channels.ghostSocial.stateSave, 'not-an-object')).rejects.toThrow(/state object/i);
    await expect(call(channels.ghostSocial.platformDefaults, 42)).rejects.toThrow(/platform key/i);
  });
});
