/**
 * WebSDR Viewer — Phase 3 recording archive (R7).
 *
 *  A. Orchestration (pure, injected blob/store/dialog seams + injected id/clock): save writes the
 *     captured bytes through the blob seam and the metadata through the P1 store, minting id +
 *     timestamps MAIN-side; data reads the bytes back; annotate edits only notes; delete removes
 *     BOTH the blob and the metadata; export writes a PLAINTEXT copy only to a chosen path (and is
 *     a no-op when the save dialog is cancelled).
 *  B. Encrypt-at-rest (real secure-fs + a reversible ENCX fake vault + real paths): a saved
 *     recording's blob is CIPHERTEXT on disk (ENCX envelope, the captured bytes absent in plaintext)
 *     yet `data` decrypts it back to the exact bytes; delete unlinks the encrypted blob.
 *  C. registerWebSdrIpc wiring: the recording channels are registered AND sender-check FIRST.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rm, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const DATA = join(tmpdir(), 'dcs98-websdr-recordings-test');
const MAGIC = Buffer.from('ENCX');

vi.mock('electron', () => ({ app: { getPath: () => DATA } }));

// Reversible fake vault (ENCX prefix + byte-inverted body), enabled + unlocked — mirrors the store
// test, so the real secure-fs choke-point encrypts on write and decrypts on read.
vi.mock('../src/main/services/vault', () => {
  const isEnc = (b: Buffer) => b.length >= 4 && b.subarray(0, 4).equals(MAGIC);
  return {
    isEnabledCached: () => true,
    isUnlocked: () => true,
    shouldEncrypt: () => true,
    hasMagicPrefix: (b: Buffer) => isEnc(b),
    isEncrypted: (b: Buffer) => isEnc(b),
    encryptBuffer: (b: Buffer) => Buffer.concat([MAGIC, Buffer.from(b.map((x) => x ^ 0xff))]),
    decryptBuffer: (b: Buffer) => Buffer.from(b.subarray(4).map((x) => x ^ 0xff)),
  };
});

import { channels } from '../src/shared/ipc-contracts';
import {
  listRecordings,
  saveRecording,
  recordingData,
  annotateRecording,
  deleteRecording,
  exportRecording,
  type RecordingsDeps,
} from '../src/main/websdr/recordings';
import { registerWebSdrIpc } from '../src/main/websdr/ipc';
import { makeWebSdrStore, type WebSdrStore, type WebSdrStoreDeps } from '../src/main/websdr/store';
import { assertTrustedSender } from '../src/main/capture/capture-window';

// ---- in-memory harness for the pure orchestration ----------------------

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

function harness(over: Partial<RecordingsDeps> = {}) {
  const blobs = new Map<string, Buffer>();
  const exported: Array<{ path: string; buf: Buffer }> = [];
  let ids = 0;
  const s = memStore();
  const deps: RecordingsDeps = {
    store: async () => s,
    writeBlob: async (id, buf) => {
      blobs.set(id, Buffer.from(buf));
    },
    readBlob: async (id) => {
      const b = blobs.get(id);
      if (!b) throw new Error('missing blob');
      return b;
    },
    deleteBlob: async (id) => {
      blobs.delete(id);
    },
    promptExportPath: async () => '/chosen/export/path.webm',
    writePlaintext: async (path, buf) => {
      exported.push({ path, buf: Buffer.from(buf) });
    },
    newId: () => `REC-${++ids}`,
    now: () => '2026-08-15T00:00:00.000Z',
    ...over,
  };
  return { deps, blobs, exported, store: s };
}

const BYTES = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0xff, 0x10]); // webm-ish header + body

// ---- A. orchestration --------------------------------------------------

describe('WebSDR recordings orchestration', () => {
  it('save writes the bytes to the blob seam and the metadata to the store, minting id + times', async () => {
    const h = harness();
    const list = await saveRecording(
      {
        data: BYTES,
        receiverName: 'Twente WebSDR',
        sourceUrl: 'https://websdr.example/',
        durationMs: 5000,
        frequencyHz: 14200000,
        mode: 'usb',
      },
      h.deps,
    );
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('REC-1');
    expect(list[0].receiverName).toBe('Twente WebSDR');
    expect(list[0].sizeBytes).toBe(BYTES.byteLength);
    expect(list[0].startedAt).toBe('2026-08-15T00:00:00.000Z');
    // No plaintext filePath escapes into the metadata (hardened shape).
    expect((list[0] as Record<string, unknown>).filePath).toBeUndefined();
    // The captured bytes went to the blob seam keyed by the minted id.
    expect(h.blobs.get('REC-1')).toEqual(BYTES);
  });

  it('save rejects a non-binary data payload before touching the store or blob', async () => {
    const h = harness();
    await expect(saveRecording({ data: 'not-binary', receiverName: 'x' }, h.deps)).rejects.toThrow();
    expect(h.blobs.size).toBe(0);
    expect(await listRecordings(h.deps)).toHaveLength(0);
  });

  it('data reads the captured bytes back for in-app playback', async () => {
    const h = harness();
    await saveRecording({ data: BYTES, receiverName: 'r' }, h.deps);
    const d = await recordingData('REC-1', h.deps);
    expect(d.mime).toBe('video/webm');
    expect(Buffer.from(d.bytes)).toEqual(BYTES);
  });

  it('annotate edits only the notes of an existing recording', async () => {
    const h = harness();
    await saveRecording({ data: BYTES, receiverName: 'r', notes: 'first' }, h.deps);
    const list = await annotateRecording('REC-1', 'edited note', h.deps);
    expect(list[0].notes).toBe('edited note');
    expect(list[0].receiverName).toBe('r'); // untouched
  });

  it('delete removes BOTH the encrypted blob and the metadata record', async () => {
    const h = harness();
    await saveRecording({ data: BYTES, receiverName: 'r' }, h.deps);
    expect(h.blobs.has('REC-1')).toBe(true);
    const list = await deleteRecording('REC-1', h.deps);
    expect(list).toHaveLength(0);
    expect(h.blobs.has('REC-1')).toBe(false);
  });

  it('export writes a PLAINTEXT copy only to the chosen save-dialog path', async () => {
    const h = harness();
    await saveRecording({ data: BYTES, receiverName: 'r' }, h.deps);
    const ok = await exportRecording('REC-1', h.deps);
    expect(ok).toBe(true);
    expect(h.exported).toHaveLength(1);
    expect(h.exported[0].path).toBe('/chosen/export/path.webm');
    expect(h.exported[0].buf).toEqual(BYTES); // plaintext bytes at the user-chosen destination
  });

  it('export is a no-op when the save dialog is cancelled (no plaintext written)', async () => {
    const h = harness({ promptExportPath: async () => null });
    await saveRecording({ data: BYTES, receiverName: 'r' }, h.deps);
    const ok = await exportRecording('REC-1', h.deps);
    expect(ok).toBe(false);
    expect(h.exported).toHaveLength(0);
  });
});

// ---- B. encrypt-at-rest (real secure-fs + real paths) ------------------

describe('WebSDR recordings: encrypt-at-rest (ENCX on disk, plaintext absent)', () => {
  beforeEach(async () => {
    await rm(DATA, { recursive: true, force: true });
    const { __resetProdWebSdrStore } = await import('../src/main/websdr/store');
    __resetProdWebSdrStore();
  });
  afterEach(async () => {
    await rm(DATA, { recursive: true, force: true });
  });

  it('a saved blob is ciphertext on disk (ENCX; captured bytes absent) yet data decrypts it back', async () => {
    const { websdrRecordingBlobFile } = await import('../src/main/storage/paths');
    // Distinctive plaintext marker inside the "captured" bytes.
    const SECRET = Buffer.from('SECRET-CAPTURE-BYTES-zzz', 'utf8');

    const list = await saveRecording({ data: SECRET, receiverName: 'Encrypted Rx' });
    const id = list[0].id;

    const onDisk = await readFile(websdrRecordingBlobFile(id));
    expect(onDisk.subarray(0, 4).toString()).toBe('ENCX'); // encrypted envelope
    expect(onDisk.includes(SECRET)).toBe(false); // captured bytes never plaintext on disk

    const back = await recordingData(id);
    expect(Buffer.from(back.bytes)).toEqual(SECRET); // decrypts in-app
  });

  it('delete unlinks the encrypted blob from disk', async () => {
    const { websdrRecordingBlobFile } = await import('../src/main/storage/paths');
    const list = await saveRecording({ data: BYTES, receiverName: 'r' });
    const id = list[0].id;
    await access(websdrRecordingBlobFile(id)); // exists
    await deleteRecording(id);
    await expect(access(websdrRecordingBlobFile(id))).rejects.toThrow(); // gone
  });
});

// ---- C. IPC registration seam ------------------------------------------

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

const RECORDING_CHANNELS = [
  channels.websdr.recordingsList,
  channels.websdr.recordingsSave,
  channels.websdr.recordingsData,
  channels.websdr.recordingsAnnotate,
  channels.websdr.recordingsDelete,
  channels.websdr.recordingsExport,
];

describe('registerWebSdrIpc: recording channels wired + sender-check FIRST', () => {
  it('sanity-checks the real assertTrustedSender fixture', () => {
    expect(() => assertTrustedSender(TRUSTED_EVENT as never)).not.toThrow();
    expect(() => assertTrustedSender(UNTRUSTED_EVENT as never)).toThrow(SENDER_ERROR);
  });

  it('registers a handler for every recording channel', () => {
    const ipc = fakeIpcMain();
    registerWebSdrIpc({ handle: ipc.handle });
    for (const ch of RECORDING_CHANNELS) expect(ipc.registered.has(ch)).toBe(true);
  });

  it('rejects an untrusted sender on every recording channel, even with garbage args', async () => {
    const ipc = fakeIpcMain();
    registerWebSdrIpc({ handle: ipc.handle });
    for (const ch of RECORDING_CHANNELS) {
      const fn = ipc.registered.get(ch)!;
      await expect((async () => fn(UNTRUSTED_EVENT, { hostile: true }))()).rejects.toThrow(
        SENDER_ERROR,
      );
    }
  });
});
