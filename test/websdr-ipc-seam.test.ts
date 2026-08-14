/**
 * WebSDR Viewer — Phase 1 orchestration + IPC-registration seam.
 *
 *  A. Orchestration (pure, injected store + injected id/clock seams): a save mints ids +
 *     timestamps MAIN-side, normalizes the receiver URL at the boundary, clamps the egress mode,
 *     and cascade-removes presets on a receiver delete.
 *  B. registerWebSdrIpc wiring: every Phase-1 channel is registered under its literal string AND
 *     rejects an UNTRUSTED sender frame BEFORE any argument is read (real assertTrustedSender —
 *     the v3.24.2 "no fail-open" invariant).
 */
import { describe, it, expect, vi } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const DATA = join(tmpdir(), 'dcs98-websdr-ipc-seam-test');

// Mocked down to what ipc.ts's import graph touches at load: paths.ts needs app.getPath, and
// capture-window (assertTrustedSender) is the REAL implementation over a mocked electron.
vi.mock('electron', () => ({
  app: { getPath: () => DATA },
  session: { fromPartition: () => ({ cookies: { get: async () => [] } }) },
}));
// Passthrough vault so the real secure-fs choke-point stays plaintext in this seam test (the
// encrypt-at-rest invariant is proven in websdr-store.test.ts against a reversible fake vault).
vi.mock('../src/main/services/vault', () => ({
  isEnabledCached: () => false,
  isUnlocked: () => true,
  shouldEncrypt: () => false,
  hasMagicPrefix: () => false,
  isEncrypted: () => false,
  encryptBuffer: (b: Buffer) => b,
  decryptBuffer: (b: Buffer) => b,
}));

import { channels } from '../src/shared/ipc-contracts';
import {
  registerWebSdrIpc,
  saveReceiver,
  saveNote,
  deleteReceiver,
  setEgress,
} from '../src/main/websdr/ipc';
import { makeWebSdrStore, type WebSdrStore } from '../src/main/websdr/store';
import { assertTrustedSender } from '../src/main/capture/capture-window';
import type { WebSdrStoreDeps } from '../src/main/websdr/store';

const TRUSTED_EVENT = { senderFrame: { url: 'file:///app/index.html' } };
const UNTRUSTED_EVENT = { senderFrame: { url: 'https://sdr.attacker/' } };
const SENDER_ERROR = 'Rejected IPC from an untrusted sender frame.';

function memStore(): WebSdrStore {
  const store = new Map<string, string>();
  const enoent = (p: string): Error => {
    const e = new Error(`ENOENT: ${p}`);
    (e as NodeJS.ErrnoException).code = 'ENOENT';
    return e;
  };
  const deps: WebSdrStoreDeps = {
    readFile: async (p) => {
      if (!store.has(p)) throw enoent(p);
      return Buffer.from(store.get(p)!, 'utf8');
    },
    writeFile: async (p, d) => {
      store.set(p, d);
    },
    directoryPath: () => 'd',
    presetsPath: () => 'p',
    notesPath: () => 'n',
    menuPath: () => 'm',
    egressPath: () => 'e',
    recordingsPath: () => 'r',
    seedReceivers: [],
  };
  return makeWebSdrStore(deps);
}

// ---- A. orchestration --------------------------------------------------

describe('WebSDR orchestration (determinism + boundary normalization)', () => {
  const injected = (s: WebSdrStore, over = {}) => ({
    store: async () => s,
    newId: () => 'MINTED-ID',
    now: () => '2026-08-14T00:00:00.000Z',
    ...over,
  });

  it('saveReceiver mints an id when absent, and normalizes the URL', async () => {
    const s = memStore();
    const list = await saveReceiver(
      { name: 'New', url: 'https://sdr.example/', type: 'WebSDR' },
      injected(s),
    );
    expect(list[0].id).toBe('MINTED-ID');
    expect(list[0].url).toBe('https://sdr.example/');
    expect(list[0].type).toBe('WebSDR');
  });

  it('saveReceiver rejects a non-http(s) URL before any store write', async () => {
    const s = memStore();
    await expect(saveReceiver({ name: 'bad', url: 'file:///etc/passwd' }, injected(s))).rejects.toThrow();
    expect(await s.directory.read()).toHaveLength(0);
  });

  it('saveReceiver clamps an unknown receiver type to Generic', async () => {
    const s = memStore();
    const list = await saveReceiver({ url: 'http://x/', type: 'HACKED' }, injected(s));
    expect(list[0].type).toBe('Generic');
  });

  it('saveNote stamps createdAt/updatedAt MAIN-side from the injected clock', async () => {
    const s = memStore();
    const list = await saveNote({ title: 'T', body: 'B', createdAt: 'renderer-lie' }, injected(s));
    // A fresh note (no id) stamps both to `now`, never the renderer-supplied createdAt.
    expect(list[0].updatedAt).toBe('2026-08-14T00:00:00.000Z');
    expect(list[0].createdAt).toBe('2026-08-14T00:00:00.000Z');
    expect(list[0].id).toBe('MINTED-ID');
  });

  it('deleteReceiver cascade-removes presets bound to it', async () => {
    const s = memStore();
    await s.directory.save({
      id: 'rx', name: 'r', url: 'http://x/', type: 'KiwiSDR', location: '', notes: '', favorite: false,
    });
    await s.presets.save({ id: 'p1', name: 'a', frequencyHz: 1, mode: 'AM', receiverId: 'rx', notes: '' });
    await s.presets.save({ id: 'p2', name: 'b', frequencyHz: 2, mode: 'AM', receiverId: 'other', notes: '' });
    await deleteReceiver('rx', injected(s));
    expect((await s.presets.read()).map((p) => p.id)).toEqual(['p2']);
    expect(await s.directory.read()).toHaveLength(0);
  });

  it('setEgress clamps the mode to the two-value union', async () => {
    const s = memStore();
    expect((await setEgress('tor', injected(s))).mode).toBe('tor');
    expect((await setEgress('anything-else', injected(s))).mode).toBe('clearnet');
  });
});

// ---- B. registration seam ----------------------------------------------

function fakeIpcMain() {
  const registered = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const handle = (channel: string, fn: (e: unknown, ...args: unknown[]) => unknown) => {
    registered.set(channel, (e, ...args) => fn(e, ...args));
  };
  return { registered, handle };
}

async function call(
  ipc: ReturnType<typeof fakeIpcMain>,
  channel: string,
  event: unknown,
  ...args: unknown[]
): Promise<{ ok: true; value: unknown } | { ok: false; error: Error }> {
  const fn = ipc.registered.get(channel);
  if (!fn) throw new Error(`channel not registered: ${channel}`);
  try {
    return { ok: true, value: await fn(event, ...args) };
  } catch (e) {
    return { ok: false, error: e as Error };
  }
}

describe('registerWebSdrIpc: every channel is wired + sender-checks FIRST', () => {
  it('sanity-checks the real assertTrustedSender fixture', () => {
    expect(() => assertTrustedSender(TRUSTED_EVENT as never)).not.toThrow();
    expect(() => assertTrustedSender(UNTRUSTED_EVENT as never)).toThrow(SENDER_ERROR);
  });

  const CHANNELS = Object.values(channels.websdr);

  it('registers a handler for every declared websdr channel', () => {
    const ipc = fakeIpcMain();
    registerWebSdrIpc({ handle: ipc.handle });
    for (const ch of CHANNELS) {
      expect(ipc.registered.has(ch)).toBe(true);
    }
  });

  it('rejects an untrusted sender on EVERY channel, even with garbage args', async () => {
    const ipc = fakeIpcMain();
    registerWebSdrIpc({ handle: ipc.handle });
    for (const ch of CHANNELS) {
      const res = await call(ipc, ch, UNTRUSTED_EVENT, { hostile: true });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.message).toBe(SENDER_ERROR);
    }
  });

  it('a trusted list call reaches past the boundary (no sender error)', async () => {
    const ipc = fakeIpcMain();
    registerWebSdrIpc({ handle: ipc.handle });
    const res = await call(ipc, channels.websdr.egressGet, TRUSTED_EVENT);
    expect(res.ok).toBe(true);
    if (res.ok) expect((res.value as { mode: string }).mode).toBe('clearnet');
  });
});
