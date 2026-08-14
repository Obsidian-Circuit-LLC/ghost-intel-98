/**
 * WebSDR Viewer — recording archive orchestration (Phase 3, R7).
 *
 * His `electron/main.ts` recorded the receiver view to a PLAINTEXT `.webm` beside the exe and stored
 * an absolute `filePath` in the DB. This port REPLACES that: the captured bytes are written ENCRYPTED
 * at rest through secure-fs (AES-GCM), keyed by the record id, and the metadata (his `Recording`
 * minus the plaintext `filePath`) lives in the P1 encrypt-at-rest store. Nothing plaintext survives
 * uninstall (Global Constraint 3). The ONLY plaintext a recording ever produces is an explicit,
 * save-dialog-gated EXPORT to a user-chosen path (his `recordings:export`), never an implicit file.
 *
 * Pure over injected seams (blob write/read/delete, the export save-dialog + plaintext writer, the
 * store, and id/clock) so the whole encrypt-at-rest + export contract is unit-testable with fakes;
 * `defaultDeps()` lazily wires the production seams (secure-fs + real paths + electron dialog +
 * node:fs), so importing this module never pulls electron at load. Determinism (Global Constraint 6):
 * ids + timestamps come from the injected seams, never a renderer clock or ambient `Date.now()` in a
 * tested path.
 */

import { randomUUID } from 'node:crypto';
import { prodWebSdrStore, type WebSdrStore } from './store';
import type { WebSdrRecordingMeta } from '@shared/websdr/types';

// ---- field bounds (mirrors ipc.ts) -------------------------------------
const MAX_NAME = 200;
const MAX_MODE = 32;
const MAX_ID = 100;
const MAX_TEXT = 20000;
const MAX_URL = 4000;
const MAX_TS = 40;

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}
function optNum(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** A recording id: bounded, separator-free (so it can never build a path outside the module dir). */
function ensureId(v: unknown): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > MAX_ID || !/^[A-Za-z0-9._:-]+$/.test(v)) {
    throw new Error('Invalid recording id.');
  }
  return v;
}

/** Coerce his captured payload (ArrayBuffer/Uint8Array over IPC) to a Buffer. A non-binary payload
 *  is rejected BEFORE any blob/store write — a hostile renderer cannot smuggle a string onto disk. */
function toBuffer(d: unknown): Buffer {
  if (Buffer.isBuffer(d)) return d;
  if (d instanceof Uint8Array) return Buffer.from(d);
  if (d instanceof ArrayBuffer) return Buffer.from(new Uint8Array(d));
  if (ArrayBuffer.isView(d)) return Buffer.from(d.buffer, d.byteOffset, d.byteLength);
  throw new Error('Recording data must be binary (ArrayBuffer/Uint8Array).');
}

/** His `safeFilePart` — sanitize a receiver name into a filesystem-safe export filename part. */
function safeFilePart(s: string): string {
  return (
    s
      // eslint-disable-next-line no-control-regex
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'receiver'
  );
}

// ---- injectable deps ---------------------------------------------------

export interface RecordingsDeps {
  store: () => Promise<WebSdrStore>;
  /** Persist the captured bytes ENCRYPTED at rest, keyed by id (secure-fs). */
  writeBlob: (id: string, buf: Buffer) => Promise<void>;
  /** Read + decrypt the captured bytes for in-app playback (secure-fs). */
  readBlob: (id: string) => Promise<Buffer>;
  /** Unlink the encrypted blob for id. */
  deleteBlob: (id: string) => Promise<void>;
  /** Show the export save dialog; resolves to the chosen path or null if cancelled. */
  promptExportPath: (defaultName: string) => Promise<string | null>;
  /** Write a PLAINTEXT copy to the user-chosen export path (deliberately NOT secure-fs). */
  writePlaintext: (path: string, buf: Buffer) => Promise<void>;
  newId: () => string;
  now: () => string;
}

function defaultDeps(): RecordingsDeps {
  return {
    store: () => prodWebSdrStore(),
    newId: () => randomUUID(),
    now: () => new Date().toISOString(),
    writeBlob: async (id, buf) => {
      const [{ secureWriteFile }, paths] = await Promise.all([
        import('../storage/secure-fs'),
        import('../storage/paths'),
      ]);
      await secureWriteFile(paths.websdrRecordingBlobFile(id), buf);
    },
    readBlob: async (id) => {
      const [{ secureReadFile }, paths] = await Promise.all([
        import('../storage/secure-fs'),
        import('../storage/paths'),
      ]);
      return secureReadFile(paths.websdrRecordingBlobFile(id));
    },
    deleteBlob: async (id) => {
      const [{ rm }, paths] = await Promise.all([
        import('node:fs/promises'),
        import('../storage/paths'),
      ]);
      await rm(paths.websdrRecordingBlobFile(id), { force: true });
    },
    promptExportPath: async (defaultName) => {
      const { dialog, BrowserWindow } = await import('electron');
      const win = BrowserWindow.getFocusedWindow();
      const options = {
        title: 'Export SDR recording',
        defaultPath: defaultName,
        filters: [{ name: 'WebM video', extensions: ['webm'] }],
      };
      const res = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
      return res.canceled || !res.filePath ? null : res.filePath;
    },
    writePlaintext: async (path, buf) => {
      // PLAINTEXT on purpose: this is the user's explicit export to a location they chose. It is the
      // ONE plaintext egress of a recording, gated behind the save dialog — never an implicit write.
      const { writeFile } = await import('node:fs/promises');
      await writeFile(path, buf);
    },
  };
}

// ---- orchestration -----------------------------------------------------

export async function listRecordings(
  overrides: Partial<RecordingsDeps> = {},
): Promise<WebSdrRecordingMeta[]> {
  const deps = { ...defaultDeps(), ...overrides };
  return (await deps.store()).recordings.read();
}

/**
 * Persist a captured recording. The bytes are coerced to a Buffer and written ENCRYPTED via the
 * blob seam BEFORE the metadata lands, so a metadata record never references an absent blob. The id
 * is minted MAIN-side; `startedAt`/`endedAt` default to the injected clock when the renderer omits
 * them; `sizeBytes` is measured from the bytes, never trusted from the payload.
 */
export async function saveRecording(
  raw: Record<string, unknown>,
  overrides: Partial<RecordingsDeps> = {},
): Promise<WebSdrRecordingMeta[]> {
  const deps = { ...defaultDeps(), ...overrides };
  const buf = toBuffer(raw.data);
  const id = deps.newId();
  const now = deps.now();
  const receiverIdRaw = raw.receiverId;
  const freq = optNum(raw.frequencyHz);
  const modeRaw = raw.mode;
  const meta: WebSdrRecordingMeta = {
    id,
    receiverName: str(raw.receiverName, MAX_NAME) || 'Unknown receiver',
    sourceUrl: str(raw.sourceUrl, MAX_URL),
    startedAt: str(raw.startedAt, MAX_TS) || now,
    endedAt: str(raw.endedAt, MAX_TS) || now,
    durationMs: num(raw.durationMs),
    notes: str(raw.notes, MAX_TEXT),
    sizeBytes: buf.byteLength,
    ...(typeof receiverIdRaw === 'string' && receiverIdRaw ? { receiverId: ensureId(receiverIdRaw) } : {}),
    ...(freq !== undefined ? { frequencyHz: freq } : {}),
    ...(typeof modeRaw === 'string' && modeRaw ? { mode: modeRaw.slice(0, MAX_MODE) } : {}),
  };
  // Encrypted blob first, then the metadata — so a listed recording always has recoverable bytes.
  await deps.writeBlob(id, buf);
  return (await deps.store()).recordings.save(meta);
}

/** Read + decrypt a recording's captured bytes for in-app playback (the renderer builds a Blob URL).
 *  Returns the mime his capture used (`video/webm`) so the renderer can type the Blob. */
export async function recordingData(
  id: string,
  overrides: Partial<RecordingsDeps> = {},
): Promise<{ id: string; mime: string; bytes: Buffer }> {
  const deps = { ...defaultDeps(), ...overrides };
  const cleanId = ensureId(id);
  const bytes = await deps.readBlob(cleanId);
  return { id: cleanId, mime: 'video/webm', bytes };
}

/** Edit ONLY the notes of an existing recording (his `recordings:update`). */
export async function annotateRecording(
  id: string,
  notes: unknown,
  overrides: Partial<RecordingsDeps> = {},
): Promise<WebSdrRecordingMeta[]> {
  const deps = { ...defaultDeps(), ...overrides };
  const cleanId = ensureId(id);
  const store = await deps.store();
  const existing = await store.recordings.read();
  const found = existing.find((r) => r.id === cleanId);
  if (!found) return existing;
  return store.recordings.save({ ...found, notes: str(notes, MAX_TEXT) });
}

/** Delete a recording: unlink the encrypted blob AND drop the metadata (his `recordings:delete`). */
export async function deleteRecording(
  id: string,
  overrides: Partial<RecordingsDeps> = {},
): Promise<WebSdrRecordingMeta[]> {
  const deps = { ...defaultDeps(), ...overrides };
  const cleanId = ensureId(id);
  await deps.deleteBlob(cleanId);
  return (await deps.store()).recordings.remove(cleanId);
}

/**
 * Export a recording to a PLAINTEXT `.webm` at a user-chosen path (his `recordings:export`). Reads
 * + decrypts the blob, prompts for a destination, and writes plaintext there ONLY — the encrypted
 * at-rest copy is untouched. Returns false (no write) when the recording is unknown or the dialog
 * is cancelled.
 */
export async function exportRecording(
  id: string,
  overrides: Partial<RecordingsDeps> = {},
): Promise<boolean> {
  const deps = { ...defaultDeps(), ...overrides };
  const cleanId = ensureId(id);
  const store = await deps.store();
  const meta = (await store.recordings.read()).find((r) => r.id === cleanId);
  if (!meta) return false;
  const bytes = await deps.readBlob(cleanId);
  const stamp = meta.startedAt.replace(/[:.]/g, '-');
  const defaultName = `${stamp}_${safeFilePart(meta.receiverName)}.webm`;
  const dest = await deps.promptExportPath(defaultName);
  if (!dest) return false;
  await deps.writePlaintext(dest, bytes);
  return true;
}
