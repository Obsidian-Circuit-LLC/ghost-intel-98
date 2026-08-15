/**
 * WebSDR Viewer — Phase 3 control-bar injection (R3).
 *
 *  A. buildControlScript: reproduces his `execControl` DOM-heuristic VERBATIM in behaviour —
 *     asserted BOTH as the script-text/return-code contract (the JSON payload + his id/name/class/
 *     placeholder regexes + his exact return codes) AND behaviourally by running the built script
 *     against a jsdom receiver page and checking the driven control + the returned code.
 *  B. interpretControlReturn / execControl: his result mapping (a truthy return → "synchronized",
 *     an empty return → "use native controls", no view → "No receiver is loaded.", a throw → the
 *     error message).
 *  C. Manager: tune/setMode/setVolume run the script ONLY into the receiver view's webContents;
 *     captureSourceId returns getMediaSourceId(sender) and throws with no view loaded.
 *  D. registerWebSdrReceiverIpc: the Phase-3 receiver channels (tune/mode/volume/capture-source)
 *     are wired AND sender-check FIRST (real assertTrustedSender), even with garbage args.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const DATA = join(tmpdir(), 'dcs98-websdr-control-test');

vi.mock('electron', () => ({
  app: { getPath: () => DATA },
  session: { fromPartition: () => ({ cookies: { get: async () => [] } }) },
  shell: { openExternal: async () => undefined },
  WebContentsView: class {},
}));
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
  buildControlScript,
  interpretControlReturn,
  execControl,
} from '../src/main/websdr/control';
import {
  makeReceiverViewManager,
  type ReceiverViewDeps,
} from '../src/main/websdr/receiver-view';
import { registerWebSdrReceiverIpc } from '../src/main/websdr/receiver-ipc';
import { assertTrustedSender } from '../src/main/capture/capture-window';

// ---- A. script-text contract -------------------------------------------

describe('buildControlScript: his script-text + return-code contract', () => {
  it('frequency: JSON payload, his id/name/class/placeholder/title regex, frequency-input code', () => {
    const s = buildControlScript('frequency', 14200000);
    expect(s).toContain('{"kind":"frequency","value":14200000}');
    expect(s).toContain('/freq|frequency|tune/i');
    expect(s).toContain("return 'frequency-input'");
  });

  it('mode: his mode/demod select regex + mode-select and mode-button codes', () => {
    const s = buildControlScript('mode', 'usb');
    expect(s).toContain('{"kind":"mode","value":"usb"}');
    expect(s).toContain('/mode|demod/i');
    expect(s).toContain("return 'mode-select'");
    expect(s).toContain("return 'mode-button'");
  });

  it('volume: his vol/audio/gain range regex + volume-slider and media-volume codes', () => {
    const s = buildControlScript('volume', 0.5);
    expect(s).toContain('{"kind":"volume","value":0.5}');
    expect(s).toContain('input[type=range]');
    expect(s).toContain('/vol|audio|gain/i');
    expect(s).toContain("return 'volume-slider'");
    expect(s).toContain("media-volume");
  });
});

// ---- A'. behavioural parity against a jsdom receiver page ---------------

describe('buildControlScript: behavioural parity (run against a jsdom receiver page)', () => {
  const run = (html: string, code: string): unknown => {
    document.body.innerHTML = html;
    // eslint-disable-next-line no-eval
    return eval(code);
  };

  it('frequency drives the first freq-matching input and returns frequency-input', () => {
    const r = run('<input id="frequency">', buildControlScript('frequency', 14200000));
    expect(r).toBe('frequency-input');
    expect((document.getElementById('frequency') as HTMLInputElement).value).toBe('14200000');
  });

  it('mode selects the matching <option> and returns mode-select', () => {
    const r = run(
      '<select id="mode"><option value="am">AM</option><option value="usb">USB</option></select>',
      buildControlScript('mode', 'usb'),
    );
    expect(r).toBe('mode-select');
    expect((document.getElementById('mode') as HTMLSelectElement).value).toBe('usb');
  });

  it('mode falls back to clicking a matching button and returns mode-button', () => {
    let clicked = false;
    document.body.innerHTML = '<button id="b">USB</button>';
    document.getElementById('b')!.addEventListener('click', () => {
      clicked = true;
    });
    // eslint-disable-next-line no-eval
    const r = eval(buildControlScript('mode', 'usb'));
    expect(r).toBe('mode-button');
    expect(clicked).toBe(true);
  });

  it('volume scales a matching range input to its min/max and returns volume-slider', () => {
    const r = run(
      '<input type="range" id="volume" min="0" max="100">',
      buildControlScript('volume', 0.5),
    );
    expect(r).toBe('volume-slider');
    expect((document.getElementById('volume') as HTMLInputElement).value).toBe('50');
  });

  it('volume with no slider sets media element volume and returns media-volume', () => {
    const r = run('<audio id="a"></audio>', buildControlScript('volume', 0.25));
    expect(r).toBe('media-volume');
    expect((document.getElementById('a') as HTMLAudioElement).volume).toBeCloseTo(0.25);
  });

  it('an incompatible page returns the empty code (native controls stay usable)', () => {
    expect(run('<div>nothing</div>', buildControlScript('frequency', 1))).toBe('');
  });
});

// ---- B. result mapping -------------------------------------------------

describe('interpretControlReturn / execControl: his result mapping', () => {
  it('a truthy return maps to ok + "synchronized (<code>)"', () => {
    expect(interpretControlReturn('frequency-input')).toEqual({
      ok: true,
      message: 'Control synchronized (frequency-input).',
    });
  });

  it('an empty return maps to a not-ok "use native controls" message', () => {
    const r = interpretControlReturn('');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/native controls/i);
  });

  it('execControl(null, ...) reports no receiver loaded without running anything', async () => {
    expect(await execControl(null, 'frequency', 1)).toEqual({
      ok: false,
      message: 'No receiver is loaded.',
    });
  });

  it('execControl runs the built script and maps the return code', async () => {
    const seen: string[] = [];
    const wc = {
      executeJavaScript: async (code: string) => {
        seen.push(code);
        return 'volume-slider';
      },
    };
    const r = await execControl(wc, 'volume', 0.5);
    expect(seen[0]).toBe(buildControlScript('volume', 0.5));
    expect(r).toEqual({ ok: true, message: 'Control synchronized (volume-slider).' });
  });

  it('execControl surfaces a thrown error message (not-ok)', async () => {
    const wc = {
      executeJavaScript: async () => {
        throw new Error('boom');
      },
    };
    expect(await execControl(wc, 'mode', 'am')).toEqual({ ok: false, message: 'boom' });
  });
});

// ---- C. manager: control confined to the receiver view -----------------

function fakeManagerHarness() {
  const exec: string[] = [];
  const mediaFor: unknown[] = [];
  let execReturn: unknown = 'frequency-input';
  const webContents = {
    setWindowOpenHandler: () => undefined,
    on: () => undefined,
    loadURL: async () => undefined,
    setAudioMuted: () => undefined,
    close: () => undefined,
    executeJavaScript: async (code: string) => {
      exec.push(code);
      return execReturn;
    },
    getMediaSourceId: (forWc: unknown) => {
      mediaFor.push(forWc);
      return 'media-source-id-xyz';
    },
  };
  const view = {
    webContents,
    setBounds: () => undefined,
    setVisible: () => undefined,
  };
  const deps: ReceiverViewDeps = {
    getWindow: () => ({ contentView: { addChildView: () => undefined, removeChildView: () => undefined } }),
    getSession: () => ({
      setProxy: async () => undefined,
      setPermissionRequestHandler: () => undefined,
      setPermissionCheckHandler: () => undefined,
      fetch: async () => ({ ok: true, status: 200 }),
    }),
    createView: () => view,
    torSocks: () => '127.0.0.1:9050',
    readEgress: async () => ({ mode: 'clearnet' }),
    writeEgress: async (mode) => ({ mode }),
    openExternal: () => undefined,
  };
  const mgr = makeReceiverViewManager(deps);
  return {
    mgr,
    exec,
    mediaFor,
    setExecReturn: (v: unknown) => {
      execReturn = v;
    },
  };
}

describe('receiver-view manager: control injection confined to the receiver view', () => {
  it('tune runs the frequency script into the receiver webContents and maps the result', async () => {
    const h = fakeManagerHarness();
    await h.mgr.load('https://sdr.example/');
    const r = await h.mgr.tune(14200000);
    expect(h.exec).toContain(buildControlScript('frequency', 14200000));
    expect(r).toEqual({ ok: true, message: 'Control synchronized (frequency-input).' });
  });

  it('setMode and setVolume run their scripts into the receiver webContents', async () => {
    const h = fakeManagerHarness();
    await h.mgr.load('https://sdr.example/');
    h.setExecReturn('mode-select');
    await h.mgr.setMode('usb');
    expect(h.exec).toContain(buildControlScript('mode', 'usb'));
    h.setExecReturn('volume-slider');
    await h.mgr.setVolume(0.5);
    expect(h.exec).toContain(buildControlScript('volume', 0.5));
  });

  it('tune with no receiver loaded reports "No receiver is loaded." (nothing injected)', async () => {
    const h = fakeManagerHarness();
    const r = await h.mgr.tune(1000);
    expect(r).toEqual({ ok: false, message: 'No receiver is loaded.' });
    expect(h.exec).toEqual([]);
  });

  it('captureSourceId returns getMediaSourceId(sender) for a loaded receiver', async () => {
    const h = fakeManagerHarness();
    await h.mgr.load('https://sdr.example/');
    const sender = { id: 'renderer-wc' };
    expect(h.mgr.captureSourceId(sender)).toBe('media-source-id-xyz');
    expect(h.mediaFor).toEqual([sender]);
  });

  it('captureSourceId throws when no receiver is loaded (his guard)', () => {
    const h = fakeManagerHarness();
    expect(() => h.mgr.captureSourceId({})).toThrow(/Load a receiver/i);
  });
});

// ---- D. IPC seam: Phase-3 receiver channels sender-check FIRST ----------

function fakeIpcMain() {
  const registered = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const handle = (channel: string, fn: (e: unknown, ...args: unknown[]) => unknown) => {
    registered.set(channel, (e, ...args) => fn(e, ...args));
  };
  return { registered, handle };
}

const TRUSTED_EVENT = { senderFrame: { url: 'file:///app/index.html' } };
const UNTRUSTED_EVENT = { senderFrame: { url: 'https://sdr.attacker/' } };
const SENDER_ERROR = 'Rejected IPC from an untrusted sender frame.';

const PHASE3_RECEIVER_CHANNELS = [
  channels.websdr.receiverTune,
  channels.websdr.receiverMode,
  channels.websdr.receiverVolume,
  channels.websdr.receiverCaptureSource,
];

describe('registerWebSdrReceiverIpc: Phase-3 control channels wired + sender-check FIRST', () => {
  it('sanity-checks the real assertTrustedSender fixture', () => {
    expect(() => assertTrustedSender(TRUSTED_EVENT as never)).not.toThrow();
    expect(() => assertTrustedSender(UNTRUSTED_EVENT as never)).toThrow(SENDER_ERROR);
  });

  it('registers a handler for every Phase-3 receiver control channel', () => {
    const ipc = fakeIpcMain();
    registerWebSdrReceiverIpc({ handle: ipc.handle as never, getWindow: () => null });
    for (const ch of PHASE3_RECEIVER_CHANNELS) expect(ipc.registered.has(ch)).toBe(true);
  });

  it('rejects an untrusted sender on every Phase-3 control channel, even with garbage args', async () => {
    const ipc = fakeIpcMain();
    registerWebSdrReceiverIpc({ handle: ipc.handle as never, getWindow: () => null });
    for (const ch of PHASE3_RECEIVER_CHANNELS) {
      const fn = ipc.registered.get(ch)!;
      await expect((async () => fn(UNTRUSTED_EVENT, { hostile: true }))()).rejects.toThrow(
        SENDER_ERROR,
      );
    }
  });
});
