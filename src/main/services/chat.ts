/**
 * Chat service (Phase 1) — the electron-aware singleton the IPC layer drives. Wires the ChatEngine
 * to resolved tor paths + per-user stores under dataRoot/chat, gated on settings.chat.networkEnabled
 * (off by default ⇒ tor is never spawned). Pushes engine events to the renderer window.
 *
 * The handshake is formally verified internally (symbolic + computational); independent external
 * audit + FIPS module remain the only unmet gates.
 */
import { app, dialog, type BrowserWindow } from 'electron';
import { basename, join } from 'node:path';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createServer, type AddressInfo } from 'node:net';
import { dataRoot } from '../storage/paths';
import { channels } from '@shared/ipc-contracts';
import { settingsStore, fileStore } from '../storage/json-fs';
import { secureReadFile, secureWriteFile } from '../storage/secure-fs';
import { ChatEngine, type ContactStatus, type FileStatus, type QuarantineSink } from '../chat/engine';
import { TorTransport, torPaths } from '../chat/transport-tor';
import { ChatIdentityStore } from '../chat/identity-store';
import { PrekeyStore } from '../chat/prekey-store';
import { ContactStore } from '../chat/contact-store';
import { MessageStore } from '../chat/message-store';
import { GroupStore } from '../chat/group-store';
import { safetyNumber, contactId, type IdentityKeyPair } from '../chat/identity';
import { setMlkemProvider } from '../chat/crypto';
import { MlkemSidecar } from './mlkem-sidecar';

const VIRT_PORT = 9001;

let engine: ChatEngine | null = null;
let identity: IdentityKeyPair | null = null;
let contactStore: ContactStore | null = null;
let mlkem: MlkemSidecar | null = null;
let enabling: Promise<{ onion: string | null }> | null = null;
let stallTimer: ReturnType<typeof setInterval> | null = null;

/** Reap inbound transfers idle longer than this (slow-loris / stalled-peer memory guard). */
const TRANSFER_IDLE_MS = 2 * 60 * 1000;
const STALL_SWEEP_MS = 30 * 1000;

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
// Serialize enable: a double-trigger (double-click / IPC retry / retry-after-failure) must not spawn a
// second tor + ML-KEM helper. Return the in-flight start if one is already underway.
export function enable(getWindow: () => BrowserWindow | null): Promise<{ onion: string | null }> {
  if (engine) return Promise.resolve({ onion: engine.onionAddress() });
  if (enabling) return enabling;
  enabling = enableImpl(getWindow).finally(() => { enabling = null; });
  return enabling;
}

async function enableImpl(getWindow: () => BrowserWindow | null): Promise<{ onion: string | null }> {
  if (!(await settingsStore.read()).chat.networkEnabled) {
    throw new Error('Chat networking is disabled — enable it in Settings first.');
  }
  const dir = chatDir();
  await mkdir(dir, { recursive: true });
  await mkdir(join(dir, 'messages'), { recursive: true });
  await mkdir(join(dir, 'groups', 'messages'), { recursive: true });
  await mkdir(quarantineDir(), { recursive: true });

  // The ML-KEM provider must be live BEFORE any prekey is minted (ensurePool → keygen). Start the
  // AWS-LC FIPS sidecar and install it as crypto.ts's ML-KEM backend; fail-closed if it won't start.
  // If anything later in enable() throws, stop it so the helper process can't orphan.
  const km = new MlkemSidecar();
  await km.start();
  mlkem = km;
  setMlkemProvider(km);
  try {
  const identityStore = new ChatIdentityStore(join(dir, 'identity.json'));
  identity = await identityStore.loadOrCreate();
  const prekeys = new PrekeyStore(join(dir, 'prekeys.json'), identity);
  await prekeys.ensurePool();
  contactStore = new ContactStore(join(dir, 'contacts.json'));
  const messages = new MessageStore(join(dir, 'messages'));
  const groups = new GroupStore(join(dir, 'groups.json'));
  // group history is keyed by groupId (32-hex), not contactId (64-hex)
  const groupMessages = new MessageStore(join(dir, 'groups', 'messages'), undefined, /^[0-9a-f]{32}$/);

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
    groups,
    groupMessages,
    now: () => Date.now(),
    newId: () => randomUUID(),
    quarantine,
    events: {
      onMessage: (cid, m) => push(channels.chat.onMessage, { contactId: cid, message: m }),
      onContactStatus: (cid, s: ContactStatus) => push(channels.chat.onContactStatus, { contactId: cid, status: s }),
      onDelivery: (cid, id, state) => push(channels.chat.onDelivery, { contactId: cid, messageId: id, state }),
      onFileStatus: (cid, transferId, fileStatus: FileStatus, progress) =>
        push(channels.chat.onFileStatus, { contactId: cid, transferId, status: fileStatus, progress }),
      onGroupMessage: (groupId, m) => push(channels.chat.onGroupMessage, { groupId, message: m }),
      onGroupInvite: (groupId) => push(channels.chat.onGroupInvite, { groupId })
    }
  });
  await engine.start();
  await sweepOrphanQuarantine(); // drop quarantine bins no history row references (crash / prune leftovers)
  const eng = engine;
  stallTimer = setInterval(() => { void eng.sweepStalledTransfers(TRANSFER_IDLE_MS); }, STALL_SWEEP_MS);
  if (typeof stallTimer.unref === 'function') stallTimer.unref();
  getWindow()?.webContents.send(channels.chat.onTorStatus, { status: 'online', onion: engine.onionAddress() });
  return { onion: engine.onionAddress() };
  } catch (e) {
    setMlkemProvider(null);
    try { km.stop(); } catch { /* already gone */ }
    mlkem = null;
    throw e;
  }
}

export async function disable(): Promise<void> {
  if (stallTimer) { clearInterval(stallTimer); stallTimer = null; }
  await engine?.stop();
  engine = null;
  identity = null;
  contactStore = null;
  setMlkemProvider(null);
  mlkem?.stop();
  mlkem = null;
}

/** Delete quarantine bins that no message-history row references — leftovers from a crash mid-transfer
 *  or from history pruning evicting a file row. For child-protection work, unreferenced (and therefore
 *  un-saveable / undeletable-from-UI) received material must not linger on disk. */
async function sweepOrphanQuarantine(): Promise<void> {
  if (!contactStore || !engine) return;
  let bins: string[];
  try {
    bins = (await readdir(quarantineDir())).filter((f) => /^[0-9a-f]{32}\.bin$/.test(f));
  } catch {
    return; // dir absent → nothing to sweep
  }
  const referenced = new Set<string>();
  for (const c of await contactStore.list()) {
    for (const m of await engine.history(c.contactId)) {
      if (m.kind === 'file' && m.file) referenced.add(`${m.file.transferId}.bin`);
    }
  }
  await Promise.all(
    bins.filter((b) => !referenced.has(b)).map((b) => rm(join(quarantineDir(), b), { force: true }).catch(() => {}))
  );
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

/** Share a case attachment into a 1:1 chat: read its decrypted bytes from the case store and stream
 *  them as a Phase-2 file transfer. caseId/fileName are validated at the IPC boundary; the path is
 *  confined under the per-case attachments dir by attachmentAbsolutePath. Returns the message id. */
export async function shareAttachment(cid: string, caseId: string, fileName: string): Promise<string> {
  const eng = requireEngine();
  const path = fileStore.attachmentAbsolutePath(caseId, fileName);
  const buf = await secureReadFile(path); // decrypts from the at-rest case store
  if (buf.length === 0) throw new Error('Attachment is empty.');
  if (buf.length > MAX_SEND_FILE_BYTES) throw new Error(`Attachment too large to share (max ${MAX_SEND_FILE_BYTES / (1024 * 1024)} MiB).`);
  const meta = (await fileStore.listAttachments(caseId)).find((a) => a.fileName === fileName);
  const name = meta?.originalName ?? fileName;
  return eng.sendFile(cid, name, mimeFromName(name), new Uint8Array(buf));
}

/** Decrypt a completed inbound file from the at-rest quarantine. Returns the peer-supplied name (the
 *  caller MUST sanitize it before using it as a path) + the plaintext bytes. The actual disk write is
 *  done by the IPC layer's hardened saveBufferWithDialog (sanitize + symlink-refuse + atomic). */
export async function getQuarantinedFile(cid: string, transferId: string): Promise<{ name: string; data: Buffer }> {
  requireEngine();
  const msg = (await history(cid)).find((m) => m.kind === 'file' && m.file?.transferId === transferId);
  if (!msg?.file || msg.file.status !== 'complete') throw new Error('File is not available to save.');
  const data = await secureReadFile(quarantinePath(transferId)); // decrypts from the at-rest store
  return { name: msg.file.name, data };
}

/** Remove a quarantine bin once the user has saved it out (don't retain received material longer than
 *  the user chose to). Best-effort. */
export async function deleteQuarantine(transferId: string): Promise<void> {
  await rm(quarantinePath(transferId), { force: true }).catch(() => {});
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

// ---- groups (Phase 3, client-side fan-out) ----
export function createGroup(name: string, memberIds: string[]): Promise<string> {
  return requireEngine().createGroup(name, memberIds);
}
export function listGroups(): ReturnType<ChatEngine['listGroups']> {
  return requireEngine().listGroups();
}
export function groupHistory(groupId: string): ReturnType<ChatEngine['groupHistory']> {
  return requireEngine().groupHistory(groupId);
}
export function sendGroup(groupId: string, text: string): Promise<string> {
  return requireEngine().sendGroup(groupId, text);
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

/** Mark a contact verified / unverified. Set true only after the human has compared the safety number
 *  out-of-band — this is the step the formal auth proofs assume (pinning-as-verified). Until then the UI
 *  shows the contact as UNVERIFIED (TOFU-pinned, MITM-possible-on-first-contact). */
export async function setVerified(cid: string, verified: boolean): Promise<void> {
  if (!contactStore) throw new Error('chat is not enabled');
  await contactStore.update(cid, { verified });
}

/** On app shutdown: stop the engine (kills tor, closes the onion). */
export async function shutdown(): Promise<void> {
  await disable();
}

export { contactId };
