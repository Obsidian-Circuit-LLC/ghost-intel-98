/**
 * WebSDR Viewer — Phase-1 orchestration + IPC wiring (`registerWebSdrIpc`).
 *
 * The renderer is never trusted with a record verbatim: every save orchestration coerces each
 * field to a bounded string MAIN-side (like `x-listening/campaign-meta.ts`'s `normalizeField`),
 * mints ids + `createdAt`/`updatedAt` from injected seams (determinism — never a renderer clock),
 * and passes every receiver URL through `normalizeWebSdrUrl` (http/https-only) at the trust
 * boundary. Persistence hits the encrypt-at-rest store (`prodWebSdrStore` → secure-fs), never
 * plaintext.
 *
 * `registerWebSdrIpc` mirrors `registerXListeningIpc`: it receives the app's event-preserving
 * `safeHandleWithEvent` wrapper and every handler calls `assertTrustedSender(e)` FIRST — before a
 * single argument is read — so an IPC message from a non-app frame is rejected even when its
 * payload is garbage (the v3.24.2 "no fail-open" lesson). The receiver-view + recording channels
 * arrive in Phase 2/3.
 */

import { randomUUID } from 'node:crypto';
import { channels } from '@shared/ipc-contracts';
import { assertTrustedSender } from '../capture/capture-window';
import { normalizeWebSdrUrl } from '@shared/websdr/normalize-url';
import {
  prodWebSdrStore,
  type WebSdrStore,
} from './store';
import type {
  WebSdrReceiver,
  WebSdrReceiverType,
  WebSdrPreset,
  WebSdrNote,
  WebSdrStationMenu,
  WebSdrMenuItem,
  WebSdrEgressState,
  WebSdrEgressMode,
} from '@shared/websdr/types';
import { defaultWebSdrMenu } from '@shared/websdr/types';

// ---- field bounds ------------------------------------------------------
// Defensive caps — an annotation is not a document; these bound a hostile or fat-fingered payload
// without truncating any realistic value.
const MAX_NAME = 200;
const MAX_TITLE = 200;
const MAX_MODE = 32;
const MAX_ID = 100;
const MAX_TEXT = 20000; // notes body / receiver notes
const MAX_LABEL = 120; // station-menu item label
const MAX_MENU_ITEMS = 200;

const RECEIVER_TYPES: readonly WebSdrReceiverType[] = ['WebSDR', 'KiwiSDR', 'OpenWebRX', 'Generic'];

/** Coerce a raw field to a bounded string. Non-strings heal to '' rather than leaking into a store. */
function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

/** Coerce a raw value to a finite number, or `undefined` (an absent/garbage frequency is dropped,
 *  never persisted as NaN). */
function optNum(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** A WebSDR record id: a bounded, separator-free token. Accepts both minted UUIDs and the bundled
 *  seed ids (`kiwi-public-0001`). Rejects anything with a path separator/traversal so an id can
 *  never be used to build a store path outside the module dir. */
function ensureWebSdrId(v: unknown, context = 'id'): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > MAX_ID || !/^[A-Za-z0-9._:-]+$/.test(v)) {
    throw new Error(`Invalid ${context}.`);
  }
  return v;
}

function coerceReceiverType(v: unknown): WebSdrReceiverType {
  return typeof v === 'string' && (RECEIVER_TYPES as readonly string[]).includes(v)
    ? (v as WebSdrReceiverType)
    : 'Generic';
}

// ---- injectable orchestration deps -------------------------------------

export interface WebSdrDeps {
  store: () => Promise<WebSdrStore>;
  /** Mint a fresh record id (production: crypto.randomUUID; injected in tests for determinism). */
  newId: () => string;
  /** Injected clock — the ISO timestamp stamped onto a record (determinism). */
  now: () => string;
}

function defaultDeps(): WebSdrDeps {
  return {
    store: () => prodWebSdrStore(),
    newId: () => randomUUID(),
    now: () => new Date().toISOString(),
  };
}

// ---- directory ---------------------------------------------------------

export async function listReceivers(overrides: Partial<WebSdrDeps> = {}): Promise<WebSdrReceiver[]> {
  const deps = { ...defaultDeps(), ...overrides };
  return (await deps.store()).directory.read();
}

/**
 * Upsert a receiver. The url is `normalizeWebSdrUrl`-validated (http/https-only) BEFORE the store
 * is touched; every text field is coerced + bounded; the type is clamped to the allowlist; a
 * missing id is minted MAIN-side. A bad url throws (the caller surfaces it) — an invalid receiver
 * never reaches disk.
 */
export async function saveReceiver(
  raw: Record<string, unknown>,
  overrides: Partial<WebSdrDeps> = {},
): Promise<WebSdrReceiver[]> {
  const deps = { ...defaultDeps(), ...overrides };
  const url = normalizeWebSdrUrl((raw as { url?: unknown }).url);
  const idRaw = (raw as { id?: unknown }).id;
  const receiver: WebSdrReceiver = {
    id: typeof idRaw === 'string' && idRaw ? ensureWebSdrId(idRaw) : deps.newId(),
    name: str((raw as { name?: unknown }).name, MAX_NAME),
    url,
    type: coerceReceiverType((raw as { type?: unknown }).type),
    location: str((raw as { location?: unknown }).location, MAX_NAME),
    notes: str((raw as { notes?: unknown }).notes, MAX_TEXT),
    favorite: (raw as { favorite?: unknown }).favorite === true,
  };
  return (await deps.store()).directory.save(receiver);
}

/** Remove a receiver and cascade-delete every preset bound to it (his `receivers:delete`). */
export async function deleteReceiver(
  id: string,
  overrides: Partial<WebSdrDeps> = {},
): Promise<WebSdrReceiver[]> {
  const deps = { ...defaultDeps(), ...overrides };
  const cleanId = ensureWebSdrId(id);
  const store = await deps.store();
  await store.presets.removeForReceiver(cleanId);
  return store.directory.remove(cleanId);
}

// ---- presets -----------------------------------------------------------

export async function listPresets(overrides: Partial<WebSdrDeps> = {}): Promise<WebSdrPreset[]> {
  const deps = { ...defaultDeps(), ...overrides };
  return (await deps.store()).presets.read();
}

export async function savePreset(
  raw: Record<string, unknown>,
  overrides: Partial<WebSdrDeps> = {},
): Promise<WebSdrPreset[]> {
  const deps = { ...defaultDeps(), ...overrides };
  const idRaw = (raw as { id?: unknown }).id;
  const receiverIdRaw = (raw as { receiverId?: unknown }).receiverId;
  const preset: WebSdrPreset = {
    id: typeof idRaw === 'string' && idRaw ? ensureWebSdrId(idRaw) : deps.newId(),
    name: str((raw as { name?: unknown }).name, MAX_NAME),
    frequencyHz: num((raw as { frequencyHz?: unknown }).frequencyHz),
    mode: str((raw as { mode?: unknown }).mode, MAX_MODE),
    ...(typeof receiverIdRaw === 'string' && receiverIdRaw
      ? { receiverId: ensureWebSdrId(receiverIdRaw, 'receiverId') }
      : {}),
    notes: str((raw as { notes?: unknown }).notes, MAX_TEXT),
  };
  return (await deps.store()).presets.save(preset);
}

export async function deletePreset(
  id: string,
  overrides: Partial<WebSdrDeps> = {},
): Promise<WebSdrPreset[]> {
  const deps = { ...defaultDeps(), ...overrides };
  return (await deps.store()).presets.remove(ensureWebSdrId(id));
}

// ---- notes -------------------------------------------------------------

export async function listNotes(overrides: Partial<WebSdrDeps> = {}): Promise<WebSdrNote[]> {
  const deps = { ...defaultDeps(), ...overrides };
  return (await deps.store()).notes.read();
}

/**
 * Upsert a note. `createdAt`/`updatedAt` are stamped MAIN-side from the injected clock — never
 * accepted from the renderer. On an update the original `createdAt` is preserved when the renderer
 * supplies a valid ISO string; a fresh note stamps both to `now`.
 */
export async function saveNote(
  raw: Record<string, unknown>,
  overrides: Partial<WebSdrDeps> = {},
): Promise<WebSdrNote[]> {
  const deps = { ...defaultDeps(), ...overrides };
  const now = deps.now();
  const idRaw = (raw as { id?: unknown }).id;
  const isUpdate = typeof idRaw === 'string' && !!idRaw;
  const createdAtRaw = (raw as { createdAt?: unknown }).createdAt;
  const receiverIdRaw = (raw as { receiverId?: unknown }).receiverId;
  const modeRaw = (raw as { mode?: unknown }).mode;
  const freq = optNum((raw as { frequencyHz?: unknown }).frequencyHz);
  const note: WebSdrNote = {
    id: isUpdate ? ensureWebSdrId(idRaw as string) : deps.newId(),
    title: str((raw as { title?: unknown }).title, MAX_TITLE),
    body: str((raw as { body?: unknown }).body, MAX_TEXT),
    // A FRESH note is always stamped `now` MAIN-side — the renderer's createdAt is never trusted.
    // Only an UPDATE (id present) round-trips the note's original createdAt back into place.
    createdAt: isUpdate && typeof createdAtRaw === 'string' && createdAtRaw ? createdAtRaw.slice(0, 40) : now,
    updatedAt: now,
    ...(typeof receiverIdRaw === 'string' && receiverIdRaw
      ? { receiverId: ensureWebSdrId(receiverIdRaw, 'receiverId') }
      : {}),
    ...(freq !== undefined ? { frequencyHz: freq } : {}),
    ...(typeof modeRaw === 'string' && modeRaw ? { mode: modeRaw.slice(0, MAX_MODE) } : {}),
  };
  return (await deps.store()).notes.save(note);
}

export async function deleteNote(
  id: string,
  overrides: Partial<WebSdrDeps> = {},
): Promise<WebSdrNote[]> {
  const deps = { ...defaultDeps(), ...overrides };
  return (await deps.store()).notes.remove(ensureWebSdrId(id));
}

// ---- station menu ------------------------------------------------------

/** Coerce a raw station-menu payload into a clean, bounded config. Unknown/garbage heals to the
 *  default menu; each item's fields are coerced; the list is capped. */
function normalizeMenu(raw: unknown): WebSdrStationMenu {
  const items = (raw as { items?: unknown })?.items;
  if (!Array.isArray(items)) return defaultWebSdrMenu();
  const clean: WebSdrMenuItem[] = [];
  for (const it of items.slice(0, MAX_MENU_ITEMS)) {
    const key = str((it as { key?: unknown })?.key, MAX_ID);
    if (!key) continue;
    const receiverIdRaw = (it as { receiverId?: unknown })?.receiverId;
    clean.push({
      key,
      label: str((it as { label?: unknown })?.label, MAX_LABEL),
      hidden: (it as { hidden?: unknown })?.hidden === true,
      builtin: (it as { builtin?: unknown })?.builtin === true,
      ...(typeof receiverIdRaw === 'string' && receiverIdRaw && /^[A-Za-z0-9._:-]+$/.test(receiverIdRaw)
        ? { receiverId: receiverIdRaw.slice(0, MAX_ID) }
        : {}),
    });
  }
  return clean.length ? { items: clean } : defaultWebSdrMenu();
}

export async function getMenu(overrides: Partial<WebSdrDeps> = {}): Promise<WebSdrStationMenu> {
  const deps = { ...defaultDeps(), ...overrides };
  return (await deps.store()).menu.read();
}

export async function saveMenu(
  raw: unknown,
  overrides: Partial<WebSdrDeps> = {},
): Promise<WebSdrStationMenu> {
  const deps = { ...defaultDeps(), ...overrides };
  return (await deps.store()).menu.write(normalizeMenu(raw));
}

// ---- egress toggle -----------------------------------------------------

function coerceEgressMode(v: unknown): WebSdrEgressMode {
  return v === 'tor' ? 'tor' : 'clearnet';
}

export async function getEgress(overrides: Partial<WebSdrDeps> = {}): Promise<WebSdrEgressState> {
  const deps = { ...defaultDeps(), ...overrides };
  return (await deps.store()).egress.read();
}

/**
 * Persist the receiver-session egress toggle. Phase 1 only PERSISTS the choice (secure-fs); the
 * actual `session.setProxy` re-route + one-time Tor warning + path marker land in Phase 2. The
 * mode is clamped to the two-value union MAIN-side — the renderer never widens it.
 */
export async function setEgress(
  mode: unknown,
  overrides: Partial<WebSdrDeps> = {},
): Promise<WebSdrEgressState> {
  const deps = { ...defaultDeps(), ...overrides };
  return (await deps.store()).egress.write({ mode: coerceEgressMode(mode) });
}

// ---- IPC registration --------------------------------------------------

type HandleWithEvent = (
  channel: string,
  fn: (e: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown,
) => void;

/**
 * Wire every Phase-1 WebSDR channel. Every handler validates the sender frame FIRST
 * (`assertTrustedSender`) — the receiver overlay (Phase 2) hosts a hostile remote page, so an IPC
 * message from a non-app frame must never be honoured — then validates its argument shape before
 * delegating to the orchestration (which itself normalizes + bounds every field).
 */
export function registerWebSdrIpc(deps: { handle: HandleWithEvent }): void {
  const { handle } = deps;

  // ---- directory ----
  handle(channels.websdr.directoryList, (e) => {
    assertTrustedSender(e);
    return listReceivers();
  });
  handle(channels.websdr.directorySave, (e, raw) => {
    assertTrustedSender(e);
    if (!raw || typeof raw !== 'object') {
      throw new Error('Saving a receiver requires a receiver object.');
    }
    return saveReceiver(raw as Record<string, unknown>);
  });
  handle(channels.websdr.directoryDelete, (e, id) => {
    assertTrustedSender(e);
    if (typeof id !== 'string' || !id) {
      throw new Error('Deleting a receiver requires an id.');
    }
    return deleteReceiver(id);
  });

  // ---- presets ----
  handle(channels.websdr.presetsList, (e) => {
    assertTrustedSender(e);
    return listPresets();
  });
  handle(channels.websdr.presetsSave, (e, raw) => {
    assertTrustedSender(e);
    if (!raw || typeof raw !== 'object') {
      throw new Error('Saving a preset requires a preset object.');
    }
    return savePreset(raw as Record<string, unknown>);
  });
  handle(channels.websdr.presetsDelete, (e, id) => {
    assertTrustedSender(e);
    if (typeof id !== 'string' || !id) {
      throw new Error('Deleting a preset requires an id.');
    }
    return deletePreset(id);
  });

  // ---- notes ----
  handle(channels.websdr.notesList, (e) => {
    assertTrustedSender(e);
    return listNotes();
  });
  handle(channels.websdr.notesSave, (e, raw) => {
    assertTrustedSender(e);
    if (!raw || typeof raw !== 'object') {
      throw new Error('Saving a note requires a note object.');
    }
    return saveNote(raw as Record<string, unknown>);
  });
  handle(channels.websdr.notesDelete, (e, id) => {
    assertTrustedSender(e);
    if (typeof id !== 'string' || !id) {
      throw new Error('Deleting a note requires an id.');
    }
    return deleteNote(id);
  });

  // ---- station menu ----
  handle(channels.websdr.menuGet, (e) => {
    assertTrustedSender(e);
    return getMenu();
  });
  handle(channels.websdr.menuSave, (e, raw) => {
    assertTrustedSender(e);
    return saveMenu(raw);
  });

  // ---- egress toggle ----
  handle(channels.websdr.egressGet, (e) => {
    assertTrustedSender(e);
    return getEgress();
  });
  handle(channels.websdr.egressSet, (e, mode) => {
    assertTrustedSender(e);
    return setEgress(mode);
  });
}
