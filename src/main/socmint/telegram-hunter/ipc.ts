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
 * Tor bootstrap (fail-closed, no clearnet fallback); capture/members read the CURRENTLY
 * visible chat/members and persist honesty-stamped records into the encrypted case store.
 *
 * SECURITY: every handler validates the sender frame FIRST (`assertTrustedSender`) — the
 * capture window can host a hostile Telegram Web page, so an IPC message from a non-app
 * frame must never be honoured — then UUID-gates the caseId before any store path is built.
 * Captured records are visible-only, provenance-stamped, media host-restricted to Telegram
 * hosts and resolved to local `data:` (owned by the TG1/TG2 orchestrators); exports run
 * every scraped cell through the formula/HTML guards.
 */

import { channels } from '@shared/ipc-contracts';
import { assertTrustedSender } from '../../capture/capture-window';
import { ensureUuid } from '../../security/validate';
import {
  TelegramHunterCollector,
  tableFor,
  tableToCsv,
  tableToHtml,
  type TgCaptureRequest,
  type TgMemberCaptureRequest,
  type TgMessageCaptureResult,
  type TgMemberCaptureResult,
  type TgExportFormat,
  type TgExportCollection,
} from './collector';

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
  return getCollector().captureMessages({
    caseId,
    jobId: typeof req.jobId === 'string' ? req.jobId : caseId,
    channelId: req.channelId,
    channelLabel: typeof req.channelLabel === 'string' ? req.channelLabel : req.channelId,
  });
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
  return getCollector().captureGroupMembers({ caseId });
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
 * socmint case store (telegram-filtered); members live in the per-tool `members` artifact
 * store. Profiles have no persistence store yet (TG3 delivered only the pure normalizer), so
 * a profile export is honestly EMPTY until profile capture is wired — it never fabricates rows.
 */
async function readExportRecords(id: string, collection: TgExportCollection): Promise<unknown[]> {
  if (collection === 'members') {
    const { prodTgHunterStore } = await import('./store');
    const store = await prodTgHunterStore();
    return store.members.read(id);
  }
  if (collection === 'profiles') {
    return [];
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
}
