/**
 * WA-T1: WhatsApp message → HarvestedItem mapper.
 *
 * No static @whiskeysockets/baileys import anywhere in this file (sealed seam §5.5).
 * The local interfaces below mirror the proto.IWebMessageInfo / MessageKey shape
 * from Baileys v7.0.0-rc13 without pulling in the library.
 *
 * Invariants (per design spec §1 + §5.3/§5.4):
 *  - url is always '' — no public WhatsApp permalink; do NOT build wa.me links (analyst trap).
 *  - mediaRef is always '' — analyst-triggered save only; never auto-download.
 *  - authorHandle strips '@s.whatsapp.net'; bidi/homoglyph-guard happens in the renderer.
 *  - channelLabel is attacker-controlled; renderer must render as textContent only.
 *  - text is attacker-controlled; renderer must render as textContent only.
 *  - publishedAt uses messageTimestamp (seconds epoch × 1000); falls back to harvestedAt()
 *    when the field is absent (e.g. protocol messages with no timestamp).
 */

import type { HarvestedItem, SocmintPlatform } from '@shared/socmint/types';
import { harvestedItemId } from './utils';

// ---------------------------------------------------------------------------
// Local interfaces — Baileys proto.IWebMessageInfo subset (no library import)
// ---------------------------------------------------------------------------

/**
 * Subset of Baileys proto.IWebMessageInfo.key sufficient for mapping.
 * Declared locally to avoid any static @whiskeysockets/baileys import.
 */
export interface WaMessageKey {
  id?: string | null;
  remoteJid?: string | null;
  /** Sender JID for group messages (absent on DMs where fromMe=false from own device). */
  participant?: string | null;
  fromMe?: boolean | null;
}

/**
 * Subset of Baileys WAProto.Message sufficient for text extraction + media detection.
 * Declared locally to avoid any static @whiskeysockets/baileys import.
 */
export interface WaMessageContent {
  conversation?: string | null;
  extendedTextMessage?: { text?: string | null } | null;
  imageMessage?: object | null;
  videoMessage?: object | null;
  audioMessage?: object | null;
  documentMessage?: object | null;
}

/**
 * Subset of Baileys proto.IWebMessageInfo sufficient for mapWhatsAppMessage.
 * `messageTimestamp` may be a protobufjs Long (has `.toNumber()`) or a plain number.
 */
export interface WaRawMessage {
  key: WaMessageKey;
  message?: WaMessageContent | null;
  messageTimestamp?: number | { toNumber(): number } | null;
}

// ---------------------------------------------------------------------------
// Mapper context (injected deps)
// ---------------------------------------------------------------------------

export interface WaMapperContext {
  /**
   * Group subject fetched from sock.groupMetadata(jid).subject before mapping.
   * Attacker-controlled — render as textContent only; never innerHTML.
   */
  channelLabel: string;
  /** Injected clock — never inline Date.now() inside pure mapper code. */
  harvestedAt: () => string;
  provenance: {
    collectorVersion: string;
    jobId: string;
    caseId: string;
    keyword?: string;
  };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function resolveTimestampMs(
  ts: number | { toNumber(): number } | null | undefined,
): number {
  if (ts == null) return 0;
  if (typeof ts === 'number') return ts * 1000;
  // protobufjs Long — convert then scale
  return ts.toNumber() * 1000;
}

function detectMediaType(
  msg: WaMessageContent | null | undefined,
): string | undefined {
  if (!msg) return undefined;
  if (msg.imageMessage) return 'image';
  if (msg.videoMessage) return 'video';
  if (msg.audioMessage) return 'audio';
  if (msg.documentMessage) return 'document';
  return undefined;
}

// ---------------------------------------------------------------------------
// Public mapper
// ---------------------------------------------------------------------------

/**
 * Map a raw Baileys proto.IWebMessageInfo to a HarvestedItem.
 *
 * Called inside the sealed makeWhatsAppCollector (WA-T2) once the library seam
 * is open; also unit-tested standalone in WA-T1 (this file only needs utils.ts).
 *
 * Group-filter invariant (enforced by the collector, not here):
 *   messages.upsert events are pre-filtered to `remoteJid.endsWith('@g.us')` AND
 *   the subscribed-group-JID set before this mapper is called.
 */
export function mapWhatsAppMessage(
  msg: WaRawMessage,
  ctx: WaMapperContext,
): HarvestedItem {
  const platform: SocmintPlatform = 'whatsapp';
  const channelId = msg.key.remoteJid ?? '';
  const messageId = msg.key.id ?? '';
  const authorId = msg.key.participant ?? '';
  // Strip JID suffix — bidi/homoglyph-guard is the renderer's responsibility.
  const authorHandle = authorId.replace('@s.whatsapp.net', '');

  const text =
    msg.message?.conversation ??
    msg.message?.extendedTextMessage?.text ??
    '';

  const mediaType = detectMediaType(msg.message);
  const timestampMs = resolveTimestampMs(msg.messageTimestamp);
  const publishedAt =
    timestampMs > 0 ? new Date(timestampMs).toISOString() : ctx.harvestedAt();

  const item: HarvestedItem = {
    id: harvestedItemId(platform, channelId, messageId),
    platform,
    channelId,
    channelLabel: ctx.channelLabel,
    authorId,
    authorHandle,
    messageId,
    text,
    mediaRef: '',
    url: '',
    publishedAt,
    harvestedAt: ctx.harvestedAt(),
    provenance: ctx.provenance,
  };

  if (mediaType !== undefined) {
    item.mediaType = mediaType;
  }

  return item;
}
