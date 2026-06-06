/**
 * Chat service (Phase 1) — the electron-aware singleton the IPC layer drives. Wires the ChatEngine
 * to resolved tor paths + per-user stores under dataRoot/chat, gated on settings.chat.networkEnabled
 * (off by default ⇒ tor is never spawned). Pushes engine events to the renderer window.
 *
 * ⚠ EXPERIMENTAL — the handshake is pending formal verification; the renderer shows a banner.
 */
import { app, type BrowserWindow } from 'electron';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createServer, type AddressInfo } from 'node:net';
import { dataRoot } from '../storage/paths';
import { channels } from '@shared/ipc-contracts';
import { settingsStore } from '../storage/json-fs';
import { ChatEngine, type ContactStatus } from '../chat/engine';
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

function chatDir(): string {
  return join(dataRoot(), 'chat');
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
  engine = new ChatEngine({
    identity,
    transport,
    prekeys,
    contacts: contactStore,
    messages,
    now: () => Date.now(),
    newId: () => randomUUID(),
    events: {
      onMessage: (cid, m) => push(channels.chat.onMessage, { contactId: cid, message: m }),
      onContactStatus: (cid, s: ContactStatus) => push(channels.chat.onContactStatus, { contactId: cid, status: s }),
      onDelivery: (cid, id, state) => push(channels.chat.onDelivery, { contactId: cid, messageId: id, state })
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
