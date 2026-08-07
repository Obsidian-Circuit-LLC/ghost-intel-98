/**
 * TG5 — SOCMINT Telegram Hunter capture-window IPC.
 *
 * The engine swap surfaces the pull-based Telegram Hunter capture window to the SOCMINT
 * Telegram tab through a small, dedicated channel set (`socmint:telegram:*`) that sits
 * ALONGSIDE the existing socmint channels — the streaming startMonitor/listItems/rank
 * seam is reused unchanged; WhatsApp is untouched.
 *
 * A single module-level `TelegramHunterCollector` holds the live capture window (the
 * Tor-proxied, WebRTC-locked `session.ts` window). connect opens/resurfaces it, gated on
 * Tor bootstrap (fail-closed, no clearnet fallback); capture/members/profile read the
 * CURRENTLY visible chat/members/profile panel and persist honesty-stamped records into
 * the encrypted case store. Profile capture keeps the account-creation date null (Telegram
 * hides it) — never fabricated.
 *
 * SECURITY: every handler validates the sender frame FIRST (`assertTrustedSender`) — the
 * capture window can host a hostile Telegram Web page, so an IPC message from a non-app
 * frame must never be honoured — then UUID-gates the caseId before any store path is built.
 * Captured records are visible-only, provenance-stamped, media host-restricted to Telegram
 * hosts and resolved to local `data:` (owned by the TG1/TG2 orchestrators); exports run
 * every scraped cell through the formula/HTML guards.
 */

import { channels } from '@shared/ipc-contracts';
import type { HarvestedItem } from '@shared/socmint/types';
import { assertTrustedSender } from '../../capture/capture-window';
import { ensureUuid } from '../../security/validate';
import {
  TelegramHunterCollector,
  tableFor,
  tableToCsv,
  tableToHtml,
  dedupItems,
  dedupKeyForItem,
  TG_COLLECTOR_VERSION,
  type TgCaptureRequest,
  type TgMemberCaptureRequest,
  type TgProfileCaptureRequest,
  type TgMessageCaptureResult,
  type TgMemberCaptureResult,
  type TgProfileCaptureResult,
  type TgExportFormat,
  type TgExportCollection,
} from './collector';
import { normalizeMessage, type RawMessage } from './extract';
import type { TgHunterStore, TgKeywordRule, ImportedItem } from './store';

/** The single live Telegram capture collector, reused across connect() calls. */
let collector: TelegramHunterCollector | null = null;

function getCollector(): TelegramHunterCollector {
  if (!collector) collector = new TelegramHunterCollector();
  return collector;
}

/** Test hook: drop the cached collector/window so each case starts clean. */
export function __resetTelegramWindowForTests(): void {
  collector = null;
}

/**
 * Read `AppSettings.socmint.telegram.captureMedia` MAIN-side (trusted) — the renderer
 * never widens capture beyond what the operator opted into. Lazy dynamic import so this
 * module never pulls the settings/store graph at import time. Falls back to `false` on any
 * read error — media capture never silently WIDENS on a settings failure (off by default).
 */
async function loadTelegramCaptureMedia(): Promise<boolean> {
  try {
    const { settingsStore } = await import('../../storage/json-fs');
    const settings = await settingsStore.read();
    return settings.socmint?.telegram?.captureMedia === true;
  } catch {
    return false;
  }
}

/**
 * Open (or resurface) the Tor-fail-closed Telegram capture window. Returns
 * `{ blocked: true }` (creating no window) when Tor is not ready — never a clearnet
 * fallback. The operator signs into Telegram Web and opens the target chat themselves.
 */
export async function connectTelegramCapture(): Promise<
  { opened: true } | { blocked: true; reason: string }
> {
  return getCollector().open();
}

/**
 * Capture the visible messages in the currently-open Telegram chat → normalized,
 * honesty-stamped `HarvestedItem`s in the encrypted socmint case store. Requires an
 * open, signed-in capture window; refuses on a locked/signed-out page (`blocked`).
 * `harvestedAt`/collector version are stamped main-side.
 */
export async function captureTelegramMessages(reqArg: unknown): Promise<TgMessageCaptureResult> {
  const req = reqArg as Partial<TgCaptureRequest> | undefined;
  if (!req || typeof req.caseId !== 'string' || typeof req.channelId !== 'string') {
    throw new Error('Capturing Telegram messages requires a caseId and a target channelId.');
  }
  // UUID-gate the caseId BEFORE any store path is built (matches every peer handler).
  const caseId = ensureUuid(req.caseId, 'caseId');
  // The media toggle is read MAIN-side from settings — the renderer never gets to widen
  // capture to media beyond what the operator opted into (off by default).
  const captureMedia = await loadTelegramCaptureMedia();
  return getCollector().captureMessages(
    {
      caseId,
      jobId: typeof req.jobId === 'string' ? req.jobId : caseId,
      channelId: req.channelId,
      channelLabel: typeof req.channelLabel === 'string' ? req.channelLabel : req.channelId,
    },
    { captureMedia },
  );
}

/**
 * Capture the visible group/channel members of the currently-open chat into the encrypted
 * `members` artifact store. Reports ONLY what was collected — never a fabricated group total
 * (Telegram hides the real member/subscriber count).
 */
export async function captureTelegramMembers(reqArg: unknown): Promise<TgMemberCaptureResult> {
  const req = reqArg as Partial<TgMemberCaptureRequest> | undefined;
  if (!req || typeof req.caseId !== 'string') {
    throw new Error('Capturing Telegram members requires a caseId.');
  }
  const caseId = ensureUuid(req.caseId, 'caseId');
  const captureMedia = await loadTelegramCaptureMedia();
  return getCollector().captureGroupMembers({ caseId }, { captureMedia });
}

/**
 * Capture the visible user-profile panel currently open in the capture window into the
 * encrypted `profiles` artifact store. Reports ONLY what was captured (0 or 1 panel) and
 * NEVER a fabricated account-creation date (`normalizeProfile` keeps it null).
 */
export async function captureTelegramProfile(reqArg: unknown): Promise<TgProfileCaptureResult> {
  const req = reqArg as Partial<TgProfileCaptureRequest> | undefined;
  if (!req || typeof req.caseId !== 'string') {
    throw new Error('Capturing a Telegram profile requires a caseId.');
  }
  const caseId = ensureUuid(req.caseId, 'caseId');
  const captureMedia = await loadTelegramCaptureMedia();
  return getCollector().captureUserProfile({ caseId }, { captureMedia });
}

export interface TgExportResult {
  format: TgExportFormat;
  /** Which collection was exported (messages / members / profiles). */
  collection: TgExportCollection;
  /** Number of records in the export — honest (what the case actually holds). */
  count: number;
  encoding: 'utf8';
  data: string;
  mime: string;
}

/**
 * Read the records for `collection` from the encrypted stores. Messages live in the shared
 * socmint case store (telegram-filtered); members and profiles live in their per-tool
 * artifact stores. A profile export reflects exactly what profile capture persisted — no
 * fabricated rows, and the account-creation date stays null (Telegram hides it).
 */
async function readExportRecords(id: string, collection: TgExportCollection): Promise<unknown[]> {
  if (collection === 'members') {
    const { prodTgHunterStore } = await import('./store');
    const store = await prodTgHunterStore();
    return store.members.read(id);
  }
  if (collection === 'profiles') {
    const { prodTgHunterStore } = await import('./store');
    const store = await prodTgHunterStore();
    return store.profiles.read(id);
  }
  const { listItems } = await import('../store');
  return (await listItems(id)).filter((it) => it.platform === 'telegram');
}

/**
 * Export a case's captured Telegram `collection` in `format`. Reads the records from the
 * encrypted stores; CSV runs every scraped cell through the RFC-4180 + formula guard and HTML
 * runs every field through the HTML-entity guard (via the pure `collector.ts` serializers).
 * JSON is the raw stored records (already honesty-stamped). `count` is honest.
 */
export async function exportTelegramItems(
  caseId: string,
  format: TgExportFormat,
  collection: TgExportCollection = 'messages',
): Promise<TgExportResult> {
  const id = ensureUuid(caseId, 'caseId');
  const records = await readExportRecords(id, collection);
  const count = records.length;
  if (format === 'csv') {
    const data = tableToCsv(tableFor(collection, records));
    return { format, collection, count, encoding: 'utf8', data, mime: 'text/csv' };
  }
  if (format === 'html') {
    const data = tableToHtml(tableFor(collection, records));
    return { format, collection, count, encoding: 'utf8', data, mime: 'text/html' };
  }
  return {
    format: 'json',
    collection,
    count,
    encoding: 'utf8',
    data: JSON.stringify(records, null, 2),
    mime: 'application/json',
  };
}

function isTgExportFormat(v: unknown): v is TgExportFormat {
  return v === 'json' || v === 'csv' || v === 'html';
}

function isTgExportCollection(v: unknown): v is TgExportCollection {
  return v === 'messages' || v === 'members' || v === 'profiles';
}

// ---- import (Telegram Desktop JSON export → encrypted imports store) -----

export interface TgImportResult {
  /** True when the operator dismissed the file picker — nothing was imported (honest, not an error). */
  canceled: boolean;
  /** Source filename (basename), present only on a completed import. */
  name?: string;
  /** How many messages the LFI-guarded parser actually extracted from the export. */
  itemCount?: number;
  /** Total import sets held by the case after this one (deduped by source file). */
  setCount?: number;
}

/**
 * Seam the import handler needs so tests never open a real dialog / touch the filesystem.
 * Production wiring (`prodImportDeps`) lazily imports electron/node so importing this module
 * never evaluates them.
 */
export interface TgImportDeps {
  /** Show the native open-file picker; resolves to an absolute path or null when canceled. */
  pickExportFile(): Promise<string | null>;
  /** Read the picked file as utf8 text. */
  readTextFile(path: string): Promise<string>;
  /** ISO clock for `importedAt` — injected so tests are deterministic. */
  now(): string;
  /** The encrypt-at-rest imports store (injected so tests never touch electron/secure-fs). */
  store(): Promise<TgHunterStore>;
  /** The case's existing Telegram items in the SHARED socmint store (telegram-filtered) —
   *  read for content-based cross-source dedup (captured ⟷ imported become one record). */
  listTelegramItems(caseId: string): Promise<HarvestedItem[]>;
  /** Upsert normalized imported messages into the SHARED socmint case store (the same store
   *  live capture writes) — id-deduped, so imported messages reach Harvested Items/exports/scans. */
  upsertItems(caseId: string, items: HarvestedItem[]): Promise<{ added: number; skipped: number }>;
}

async function defaultPickExportFile(): Promise<string | null> {
  const { dialog, BrowserWindow } = await import('electron');
  const opts = {
    properties: ['openFile'] as Array<'openFile'>,
    filters: [{ name: 'Telegram Desktop export', extensions: ['json'] }],
  };
  const win = BrowserWindow.getFocusedWindow();
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  if (res.canceled || res.filePaths.length === 0) return null;
  return res.filePaths[0];
}

const prodImportDeps: TgImportDeps = {
  pickExportFile: defaultPickExportFile,
  readTextFile: async (p) => {
    const { readFile } = await import('node:fs/promises');
    return (await readFile(p)).toString('utf8');
  },
  now: () => new Date().toISOString(),
  store: async () => {
    const { prodTgHunterStore } = await import('./store');
    return prodTgHunterStore();
  },
  listTelegramItems: async (caseId) => {
    const { listItems } = await import('../store');
    return (await listItems(caseId)).filter((it) => it.platform === 'telegram');
  },
  upsertItems: async (caseId, items) => {
    const { upsertItems } = await import('../store');
    return upsertItems(caseId, items);
  },
};

/**
 * Adapt one parsed `ImportedItem` (Telegram Desktop export) into the `RawMessage` shape the
 * shared honesty normalizer consumes. A Desktop export carries a display name (`from`) but no
 * @handle and no avatar — so `authorUsername`/`authorProfileUrl`/`avatar` are '' (honest: no
 * fabricated handle/permalink), and `normalizeMessage` derives a DETERMINISTIC content-keyed
 * id, keeping the visible display name only when it is not a mere echo of an (absent) handle.
 */
function importedToRaw(item: ImportedItem): RawMessage {
  return {
    chat: item.chatName,
    author: item.author,
    authorUsername: '',
    authorProfileUrl: '',
    timestamp: item.timestamp,
    text: item.text,
    links: Array.isArray(item.links) ? item.links : [],
    avatar: '',
    eventType: '',
    messageId: item.messageId,
  };
}

/**
 * Import an operator-picked Telegram Desktop `result.json` export into the encrypted per-case
 * imports store. The parse is the LFI-hardened `parseTelegramExport` — media that escapes the
 * chosen export root (the file's own directory) is DROPPED, never dereferenced. No egress: the
 * operator picks a LOCAL file; nothing is fetched. `itemCount`/`setCount` are honest counts.
 */
export async function importTelegramExport(
  reqArg: unknown,
  deps: TgImportDeps = prodImportDeps,
): Promise<TgImportResult> {
  const req = reqArg as { caseId?: unknown } | undefined;
  if (!req || typeof req.caseId !== 'string') {
    throw new Error('Importing a Telegram export requires a caseId.');
  }
  // UUID-gate the caseId BEFORE any store path is built (matches every peer handler).
  const caseId = ensureUuid(req.caseId, 'caseId');
  const file = await deps.pickExportFile();
  if (!file) return { canceled: true };
  const { dirname, basename } = await import('node:path');
  const root = dirname(file);
  const raw = await deps.readTextFile(file);
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error('The selected file is not a valid Telegram Desktop JSON export.');
  }
  const { parseTelegramExport } = await import('./store');
  const items = parseTelegramExport(root, json);
  // id === sourceFile basename so re-importing the same export UPSERTS (deterministic key,
  // never a clock-derived id): the store dedups by (sourceFile, id).
  const name = basename(file);
  const store = await deps.store();
  // Keep the import SET as an audit record (which file, which messages, when)…
  const setCount = await store.imports.add(caseId, {
    id: name,
    name,
    sourceFile: file,
    items,
    importedAt: deps.now(),
  });

  // …but the messages themselves MUST reach the SHARED socmint case store — the same store
  // live capture writes (collector.ts) — so imported messages show up in Harvested Items,
  // exports, and keyword scans. Normalize each ImportedItem into an honesty-stamped
  // HarvestedItem (platform telegram, visible-capture, verified:false), collapse duplicates
  // WITHIN the batch by content key (`dedupItems`/`dedupKeyForItem`), then drop any whose
  // content already exists in the case (a live-captured message OR a previously imported one)
  // so a captured message and the same imported message become ONE record — the persistent
  // `store.dedup` index records the seen content keys for the cross-source guarantee.
  const harvestedAt = deps.now();
  const normalized = items.map((it) =>
    normalizeMessage(importedToRaw(it), {
      caseId,
      jobId: name,
      collectorVersion: TG_COLLECTOR_VERSION,
      harvestedAt,
      channelId: it.chatId,
      channelLabel: it.chatName,
    }),
  );
  const batch = dedupItems(normalized, dedupKeyForItem);
  const seen = new Set<string>((await deps.listTelegramItems(caseId)).map((it) => dedupKeyForItem(it)));
  for (const k of await store.dedup.read(caseId)) seen.add(k);
  const fresh: HarvestedItem[] = [];
  for (const h of batch) {
    const k = dedupKeyForItem(h);
    if (seen.has(k)) continue;
    seen.add(k);
    await store.dedup.add(caseId, k);
    fresh.push(h);
  }
  if (fresh.length > 0) await deps.upsertItems(caseId, fresh);

  return { canceled: false, name, itemCount: items.length, setCount };
}

// ---- keyword-watch (persist literal terms + scan captured messages) ------

export interface TgKeywordMatch {
  text: string;
  authorHandle: string;
  channelLabel: string;
  /** Which watch terms this record literally matched. */
  terms: string[];
}

export interface TgKeywordScanResult {
  /** The full persisted watch-term set after this call (each matched LITERALLY, no RegExp). */
  rules: TgKeywordRule[];
  /** How many captured Telegram messages were scanned. */
  scanned: number;
  /** How many of them matched at least one term. */
  matched: number;
  /** A bounded preview of the matches (visible fields only). */
  matches: TgKeywordMatch[];
}

/** Seam so the scan handler can be unit-tested without the electron/store graph. */
export interface TgKeywordScanDeps {
  now(): string;
  /** The case's captured Telegram messages (already telegram-filtered). */
  listTelegramItems(caseId: string): Promise<HarvestedItem[]>;
  store(): Promise<TgHunterStore>;
}

const prodKeywordScanDeps: TgKeywordScanDeps = {
  now: () => new Date().toISOString(),
  listTelegramItems: async (caseId) => {
    const { listItems } = await import('../store');
    return (await listItems(caseId)).filter((it) => it.platform === 'telegram');
  },
  store: async () => {
    const { prodTgHunterStore } = await import('./store');
    return prodTgHunterStore();
  },
};

/**
 * Persist any new literal keyword-watch terms, then scan the case's captured Telegram messages
 * against the FULL persisted term set. Matching is `matchKeywords` — a literal `.includes`, never
 * `new RegExp` on operator input (ReDoS/injection). Reports only what was scanned/matched; the
 * preview carries visible fields only. Never fabricates a match or a count.
 */
export async function scanTelegramKeywords(
  reqArg: unknown,
  deps: TgKeywordScanDeps = prodKeywordScanDeps,
): Promise<TgKeywordScanResult> {
  const req = reqArg as { caseId?: unknown; terms?: unknown } | undefined;
  if (!req || typeof req.caseId !== 'string') {
    throw new Error('Scanning Telegram keywords requires a caseId.');
  }
  const caseId = ensureUuid(req.caseId, 'caseId');
  const store = await deps.store();
  const addedAt = deps.now();
  const terms = Array.isArray(req.terms) ? req.terms : [];
  for (const t of terms) {
    const term = typeof t === 'string' ? t.trim() : '';
    if (term) await store.keywordWatch.add(caseId, term, addedAt);
  }
  const rules = await store.keywordWatch.read(caseId);
  const items = await deps.listTelegramItems(caseId);
  const { matchKeywords } = await import('./collector');
  const hits = matchKeywords(items, rules);
  const matches: TgKeywordMatch[] = hits.slice(0, 200).map(({ record, hits: rhits }) => ({
    text: record.text,
    authorHandle: record.authorHandle,
    channelLabel: record.channelLabel,
    terms: rhits.map((r) => r.term),
  }));
  return { rules, scanned: items.length, matched: hits.length, matches };
}

type HandleWithEvent = (
  channel: string,
  fn: (e: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown,
) => void;

/**
 * Wire the Telegram Hunter capture channels. The injected `handle` MUST be the
 * event-PRESERVING wrapper (register.ts supplies `safeHandleWithEvent`) so every handler
 * can validate the sender frame — the capture window can host hostile remote content.
 */
export function registerTelegramHunterIpc(deps: { handle: HandleWithEvent }): void {
  deps.handle(channels.socmint.telegram.connect, (e) => {
    assertTrustedSender(e);
    return connectTelegramCapture();
  });
  deps.handle(channels.socmint.telegram.capture, (e, reqArg) => {
    assertTrustedSender(e);
    return captureTelegramMessages(reqArg);
  });
  deps.handle(channels.socmint.telegram.captureMembers, (e, reqArg) => {
    assertTrustedSender(e);
    return captureTelegramMembers(reqArg);
  });
  deps.handle(channels.socmint.telegram.captureProfile, (e, reqArg) => {
    assertTrustedSender(e);
    return captureTelegramProfile(reqArg);
  });
  deps.handle(channels.socmint.telegram.exportItems, (e, reqArg) => {
    assertTrustedSender(e);
    const req = reqArg as { caseId?: unknown; format?: unknown; collection?: unknown } | undefined;
    if (!req || typeof req.caseId !== 'string') {
      throw new Error('Exporting Telegram items requires a caseId.');
    }
    if (!isTgExportFormat(req.format)) {
      throw new Error("Exporting Telegram items requires a format ('json', 'csv', or 'html').");
    }
    // Collection is optional and defaults to messages; reject only an explicit bad value.
    if (req.collection !== undefined && !isTgExportCollection(req.collection)) {
      throw new Error("Exporting Telegram items requires a collection ('messages', 'members', or 'profiles').");
    }
    return exportTelegramItems(req.caseId, req.format, req.collection ?? 'messages');
  });
  deps.handle(channels.socmint.telegram.importExport, (e, reqArg) => {
    assertTrustedSender(e);
    return importTelegramExport(reqArg);
  });
  deps.handle(channels.socmint.telegram.keywordScan, (e, reqArg) => {
    assertTrustedSender(e);
    return scanTelegramKeywords(reqArg);
  });
}
