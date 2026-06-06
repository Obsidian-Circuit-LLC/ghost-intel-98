/**
 * Chat service (Phase 1) — the electron-aware singleton the IPC layer drives. Wires the ChatEngine
 * to resolved tor paths + per-user stores under dataRoot/chat, gated on settings.chat.networkEnabled
 * (off by default ⇒ tor is never spawned). Pushes engine events to the renderer window.
 *
 * ⚠ EXPERIMENTAL — the handshake is pending formal verification; the renderer shows a banner.
 */
import { app, dialog, type BrowserWindow } from 'electron';
import { basename, join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createServer, type AddressInfo } from 'node:net';
import { dataRoot } from '../storage/paths';
import { channels } from '@shared/ipc-contracts';
import { settingsStore } from '../storage/json-fs';
import { secureReadFile, secureWriteFile } from '../storage/secure-fs';
import { ChatEngine, type ContactStatus, type FileStatus, type QuarantineSink } from '../chat/engine';
import { TorTransport, torPaths } from '../chat/transport-tor';
import { ChatIdentityStore } from '../chat/identity-store';
import { PrekeyStore } from '../chat/prekey-store';
import { ContactStore } from '../chat/contact-store';
import { MessageStore } from '../chat/message-store';
import { safetyNumber, contactId, type IdentityKeyPair } from '../chat/identity';

const VIRT_PORT = 9001;

let engine: ChatEngine | null = null;
let identity: IdentityKeyPair | null = null;
let contactStore: ContactStore | null = null;

export interface ChatContactDTO {
  contactId: string;
  displayName: string;
  onion: string | null;
  verified: boolean;
  lastSeen: number | null;
  safetyNumber: string;
}

/** Hard cap on a file the user may pick to SEND (matches the engine's MAX_FILE_BYTES). */
const MAX_SEND_FILE_BYTES = 64 * 1024 * 1024;

function chatDir(): string {
  return join(dataRoot(), 'chat');
}
function quarantineDir(): string {
  return join(chatDir(), 'quarantine');
}
/** Quarantine file path for a transfer — encrypted at rest like all case data; the transferId (hex,
 *  validated upstream) is the filename. The user must explicitly save it out via saveFile(). */
function quarantinePath(transferId: string): string {
  return join(quarantineDir(), `${transferId}.bin`);
}
function torBundleDir(): string {
  const base = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources');
  return join(base, 'tor', 'win-x64');
}
function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as AddressInfo).port;
      s.close(() => res(port));
    });
  });
}

export function isEnabled(): boolean {
  return engine !== null;
}

export function status(): { enabled: boolean; onion: string | null } {
  return { enabled: engine !== null, onion: engine?.onionAddress() ?? null };
}

/** Build + start the engine (spawns tor, publishes the onion). Requires the opt-in setting. */
export async function enable(getWindow: () => BrowserWindow | null): Promise<{ onion: string | null }> {
  if (engine) return { onion: engine.onionAddress() };
  if (!(await settingsStore.read()).chat.networkEnabled) {
    throw new Error('Chat networking is disabled — enable it in Settings first.');
  }
  const dir = chatDir();
  await mkdir(dir, { recursive: true });
  await mkdir(join(dir, 'messages'), { recursive: true });
  await mkdir(quarantineDir(), { recursive: true });

  const identityStore = new ChatIdentityStore(join(dir, 'identity.json'));
  identity = await identityStore.loadOrCreate();
  const prekeys = new PrekeyStore(join(dir, 'prekeys.json'), identity);
  await prekeys.ensurePool();
  contactStore = new ContactStore(join(dir, 'contacts.json'));
  const messages = new MessageStore(join(dir, 'messages'));

  const [socksPort, controlPort, listenPort] = await Promise.all([freePort(), freePort(), freePort()]);
  const transport = new TorTransport({
    paths: torPaths(torBundleDir()),
    dataDir: join(dir, 'tor'),
    socksPort,
    controlPort,
    listenPort,
    virtPort: VIRT_PORT,
    onionKeyBlob: await identityStore.getOnionKey(),
    saveOnionKey: (blob) => identityStore.setOnionKey(blob)
  });

  const push = (channel: string, payload: unknown): void => getWindow()?.webContents.send(channel, payload);
  // Verified inbound files are written to the encrypted-at-rest quarantine; the user saves them out
  // explicitly via saveFile(). Bytes never round-trip through the renderer.
  const quarantine: QuarantineSink = async ({ transferId, data }) => {
    const path = quarantinePath(transferId);
    await secureWriteFile(path, Buffer.from(data));
    return path;
  };
  engine = new ChatEngine({
    identity,
    transport,
    prekeys,
    contacts: contactStore,
    messages,
    now: () => Date.now(),
    newId: () => randomUUID(),
    quarantine,
    events: {
      onMessage: (cid, m) => push(channels.chat.onMessage, { contactId: cid, message: m }),
      onContactStatus: (cid, s: ContactStatus) => push(channels.chat.onContactStatus, { contactId: cid, status: s }),
      onDelivery: (cid, id, state) => push(channels.chat.onDelivery, { contactId: cid, messageId: id, state }),
      onFileStatus: (cid, transferId, fileStatus: FileStatus, progress) =>
        push(channels.chat.onFileStatus, { contactId: cid, transferId, status: fileStatus, progress })
    }
  });
  await engine.start();
  getWindow()?.webContents.send(channels.chat.onTorStatus, { status: 'online', onion: engine.onionAddress() });
  return { onion: engine.onionAddress() };
}

export async function disable(): Promise<void> {
  await engine?.stop();
  engine = null;
  identity = null;
  contactStore = null;
}

function requireEngine(): ChatEngine {
  if (!engine) throw new Error('Chat is not enabled');
  return engine;
}

export function createInvite(): Promise<string> {
  return requireEngine().createInvite();
}
export function acceptInvite(link: string): Promise<string> {
  return requireEngine().acceptInvite(link);
}
export function send(cid: string, text: string): Promise<string> {
  return requireEngine().send(cid, text);
}

/** Pick a file via the OS dialog (bytes stay in main — never crosses from the renderer) and stream it
 *  to a contact. Returns the message id, or null if the user cancelled. */
export async function sendFile(cid: string, getWindow: () => BrowserWindow | null): Promise<string | null> {
  const eng = requireEngine();
  const win = getWindow();
  const res = win
    ? await dialog.showOpenDialog(win, { properties: ['openFile'] })
    : await dialog.showOpenDialog({ properties: ['openFile'] });
  if (res.canceled || res.filePaths.length === 0) return null;
  const path = res.filePaths[0];
  const { readFile, stat } = await import('node:fs/promises');
  const { size } = await stat(path);
  if (size > MAX_SEND_FILE_BYTES) throw new Error(`File too large (max ${MAX_SEND_FILE_BYTES / (1024 * 1024)} MiB).`);
  if (size === 0) throw new Error('Refusing to send an empty file.');
  const buf = await readFile(path);
  const name = basename(path);
  const mime = mimeFromName(name);
  return eng.sendFile(cid, name, mime, new Uint8Array(buf));
}

/** Save a quarantined inbound file out to a user-chosen path (decrypting from the at-rest store).
 *  Returns the saved path, or null if cancelled. */
export async function saveFile(cid: string, transferId: string, getWindow: () => BrowserWindow | null): Promise<string | null> {
  requireEngine();
  const hist = await history(cid);
  const msg = hist.find((m) => m.kind === 'file' && m.file?.transferId === transferId);
  if (!msg?.file || msg.file.status !== 'complete') throw new Error('File is not available to save.');
  const win = getWindow();
  const res = win
    ? await dialog.showSaveDialog(win, { defaultPath: msg.file.name })
    : await dialog.showSaveDialog({ defaultPath: msg.file.name });
  if (res.canceled || !res.filePath) return null;
  const data = await secureReadFile(quarantinePath(transferId)); // decrypts from the at-rest store
  await writeFile(res.filePath, data);
  return res.filePath;
}

/** Minimal extension→MIME guess (advisory only; the receiver treats files as untrusted regardless). */
function mimeFromName(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  const map: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', json: 'application/json',
    zip: 'application/zip', mp4: 'video/mp4', mp3: 'audio/mpeg', wav: 'audio/wav'
  };
  return map[ext] ?? 'application/octet-stream';
}

export function history(cid: string): ReturnType<ChatEngine['history']> {
  return requireEngine().history(cid);
}

export async function listContacts(): Promise<ChatContactDTO[]> {
  if (!contactStore || !identity) return [];
  const ours = identity.publicKeys;
  return (await contactStore.list()).map((c) => ({
    contactId: c.contactId,
    displayName: c.displayName,
    onion: c.onion,
    verified: c.verified,
    lastSeen: c.lastSeen,
    safetyNumber: safetyNumber(ours, c.identity)
  }));
}

/** On app shutdown: stop the engine (kills tor, closes the onion). */
export async function shutdown(): Promise<void> {
  await disable();
}

export { contactId };
