/**
 * A3 (whatsapp-baileys-live): Live WhatsApp collector (implements SocmintCollector).
 *
 * De-sealed per §5.5 supply-chain verification COMPLETE (operator sign-off 2026-06-27):
 *   (1) scope verified: @whiskeysockets/baileys (GitHub: WhiskeySockets/Baileys) — not lotusbail
 *   (2) pinned --save-exact v7.0.0-rc13; package-lock.json integrity SHA-512 verified
 *   (3) whatsapp-rust-bridge 0.5.4 — WASM mode, no native NAPI rebuild
 *   (4) libsignal ^6.0.0 — correct author (WhiskeySockets scope), no red-flag indicators
 *   (5) link-preview-js absent from lockfile (confirmed grep)
 *
 * Architecture:
 *   - makeWhatsAppCollector mirrors makeMtcuteCollector: { burnerId, transport, harvestedAt }.
 *   - Production path: lazy dynamic import (@whiskeysockets/baileys + socks-proxy-agent);
 *     secretStore-backed WhatsAppAuthState; makeWASocket with SILENT_LOGGER.
 *   - Test path: opts._inject.createSocket bypasses the dynamic import, secretStore, and
 *     makeWASocket so unit tests never touch the wire.
 *   - No static @whiskeysockets/baileys import anywhere in this module.
 *
 * Global invariants (same as collector.ts, whatsapp-proxy.ts):
 *   - Transport is pre-resolved at the egress boundary (handleStartMonitor / IPC handlers).
 *   - In 'tor' mode, resolveTransport already threw SocmintTorUnavailableError when Tor
 *     was down — transport arriving here was already fail-closed validated upstream.
 *   - 'direct' is always an explicit operator choice, never an automatic clearnet fallback.
 *   - pino is silenced (SILENT_LOGGER below); Baileys logs key material at default level.
 *   - Per-burner SOCKS isolation via IsolateSOCKSAuth (transport.proxy carries per-burner creds).
 *   - No auto-fetch of harvested URLs/media — url is always '' in the mapper.
 *   - Secrets (auth creds) never echoed; burnerId (a config key, not a secret) is safe to log.
 *   - Group filter: messages.upsert filtered to type='notify', @g.us, subscribed set, !fromMe.
 *   - join() is assert-joined (not auto-join) — throws if the burner is not a member.
 *   - backfill() returns [] (syncFullHistory:false is the default and our permanent setting).
 *   - disconnect() calls sock.end() and keeps the session (for reconnect).
 */

import type { HarvestedItem, MonitoredChannel } from '@shared/socmint/types';
import type { SocmintCollector } from './collector';
import type { SocmintTransport } from './tor-identity';
import { makeWhatsAppAuthState } from './whatsapp-auth';
import type { WhatsAppAuthState } from './whatsapp-auth';
import { buildBaileysProxy } from './whatsapp-proxy';
import { mapWhatsAppMessage } from './whatsapp-mapper';
import type { WaRawMessage } from './whatsapp-mapper';

// ---------------------------------------------------------------------------
// Sealed seam message (kept for backward-compat; §5.5 gate is now open)
// ---------------------------------------------------------------------------

/**
 * Exported for backward compatibility and as a documented audit trail.
 * The seam is open; this constant is no longer thrown by any method.
 * §5.5 supply-chain checklist complete (operator sign-off 2026-06-27).
 */
export const WA_SEALED_MESSAGE =
  'SOCMINT: WhatsApp library not installed — pending operator supply-chain verification + library lock. Complete §5.5 checklist before unsealing.';

// ---------------------------------------------------------------------------
// Local event types — no static @whiskeysockets/baileys import
// ---------------------------------------------------------------------------

/** Subset of Baileys ConnectionState used by connection.update events. */
export interface WaConnectionUpdate {
  connection?: 'open' | 'connecting' | 'close';
  qr?: string;
  lastDisconnect?: { error?: unknown };
}

/** Shape of the messages.upsert payload emitted by Baileys. */
export interface WaMessagesUpsert {
  messages: WaRawMessage[];
  type: string;
}

/**
 * Minimal structural interface for the Baileys WASocket instance.
 * Exported so the _inject.createSocket factory can be typed in callers/tests.
 *
 * The real Baileys WASocket is a superset of this interface; the cast from the
 * actual socket to WaSocketLike is safe because we only use this subset.
 */
export interface WaSocketLike {
  ev: {
    /** Subscribe to the given event. */
    on(event: 'connection.update', handler: (update: WaConnectionUpdate) => void): void;
    on(event: 'creds.update', handler: () => void): void;
    on(event: 'messages.upsert', handler: (upsert: WaMessagesUpsert) => void): void;
    /** Unsubscribe a previously registered handler. */
    off(event: 'messages.upsert', handler: (upsert: WaMessagesUpsert) => void): void;
  };
  /** Fetch group metadata (subject, etc). Throws when the burner is not a member. */
  groupMetadata(jid: string): Promise<{ subject: string }>;
  /** Close the socket. Optionally passes an error to the close handler. */
  end(error?: Error): void;
  /** Request a pairing code for a given phone number (optional — not all sockets expose it). */
  requestPairingCode?(phone: string): Promise<string>;
}

// ---------------------------------------------------------------------------
// Silent pino-compatible logger — no pino import; matches the Logger interface
// used by Baileys so it silences all output including key-material logs.
// ---------------------------------------------------------------------------

/** Minimal pino-compatible logger shape (subset Baileys actually calls). */
type SilentLogger = {
  level: string;
  trace: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  fatal: (...args: unknown[]) => void;
  child: (...args: unknown[]) => SilentLogger;
};

const SILENT_LOGGER: SilentLogger = {
  level: 'silent',
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  child: () => SILENT_LOGGER,
};

// ---------------------------------------------------------------------------
// Collector factory
// ---------------------------------------------------------------------------

/**
 * Build a live Baileys-backed WhatsApp SocmintCollector for the given burner.
 *
 * Transport is pre-resolved by the caller at the egress boundary (handleStartMonitor).
 * In 'tor' mode, resolveTransport already validated Tor and opts.transport.proxy carries
 * the per-burner SOCKS5 config. In 'direct' mode this is the operator's explicit clearnet
 * choice — never an automatic fallback.
 *
 * Test injection (opts._inject):
 *   _inject.createSocket bypasses the real dynamic import, secretStore, and makeWASocket.
 *   _inject.authState (optional) provides a pre-built auth state; if absent a no-op
 *   in-memory state is used (no secretStore calls in tests).
 *   Production callers NEVER set _inject.
 */
export function makeWhatsAppCollector(opts: {
  burnerId: string;
  transport: SocmintTransport;
  harvestedAt: () => string;
  /**
   * Test-only: inject a mock socket factory and optional auth state.
   * When set, connect() uses createSocket() and skips the real dynamic import,
   * secretStore, and makeWASocket. NEVER set in production.
   */
  _inject?: {
    createSocket: (proxyUrl: string | null) => WaSocketLike;
    authState?: WhatsAppAuthState;
  };
}): SocmintCollector {
  // Active socket — null until connect(), cleared on disconnect().
  let sock: WaSocketLike | null = null;
  // Auth state — held so disconnect() can flush pending writes (fire-and-forget).
  let waAuth: WhatsAppAuthState | null = null;
  // Channel labels captured from join() calls — used in subscribe() mapper context.
  const channelLabels = new Map<string, string>();

  return {
    // -------------------------------------------------------------------------
    // connect()
    // -------------------------------------------------------------------------

    async connect(): Promise<void> {
      let auth: WhatsAppAuthState;

      if (opts._inject) {
        // ─── Test path ───────────────────────────────────────────────────────
        // Use the injected factory; skip real dynamic import and secretStore.
        auth =
          opts._inject.authState ??
          makeWhatsAppAuthState(opts.burnerId, {
            read: async () => null,
            write: async () => {},
            delete: async () => {},
          });
        await auth.initialize();

        const proxyUrl = buildBaileysProxy(opts.transport);
        sock = opts._inject.createSocket(proxyUrl);
      } else {
        // ─── Production path ──────────────────────────────────────────────────
        // Lazy dynamic imports — no static @whiskeysockets/baileys or socks-proxy-agent
        // import exists in this module (ESM footgun guard; see electron.vite.config.ts).
        const baileysModule = await import('@whiskeysockets/baileys');
        const { makeWASocket } = baileysModule;
        const { SocksProxyAgent } = await import('socks-proxy-agent');
        const { secretStore } = await import('../secrets/index');

        // Build the secretStore-backed auth state.
        // Credentials are NEVER echoed — only burnerId (a config key) appears in errors.
        const authInstance = makeWhatsAppAuthState(opts.burnerId, {
          read: (k) => secretStore.get(k),
          write: (k, v) => secretStore.set(k, v),
          delete: (k) => secretStore.delete(k),
        });
        await authInstance.initialize();
        auth = authInstance;

        // Build SOCKS5 proxy agent for tor; null for direct.
        const proxyUrl = buildBaileysProxy(opts.transport);
        const agent = proxyUrl !== null ? new SocksProxyAgent(proxyUrl) : undefined;

        // Type aliases inside the dynamic-import block to keep casts local.
        type MakeWASocketFn = typeof makeWASocket;
        type BaileysConfig = Parameters<MakeWASocketFn>[0];

        const waSock = makeWASocket({
          // auth.state is structurally compatible at runtime; cast bypasses strict generics.
          auth: auth.state as unknown as BaileysConfig['auth'],
          ...(agent !== undefined
            ? {
                agent: agent as BaileysConfig['agent'],
                fetchAgent: agent as BaileysConfig['agent'],
              }
            : {}),
          syncFullHistory: false,
          // SILENT_LOGGER matches the pino Logger interface; silences key-material logs.
          logger: SILENT_LOGGER as unknown as BaileysConfig['logger'],
        });

        // Cast the real WASocket (superset) to our minimal WaSocketLike.
        sock = waSock as unknown as WaSocketLike;
      }

      waAuth = auth;

      // ── Register event handlers ──────────────────────────────────────────
      // creds.update: persist auth state on every Baileys ratchet.
      sock.ev.on('creds.update', () => {
        void auth.saveCreds();
      });

      // connection.update: informational — does not block connect() resolution.
      // The linking ceremony (pairing code) is handled by the separate
      // handleSetWhatsappBurnerPairingCode IPC handler, not here.
      sock.ev.on('connection.update', (_update: WaConnectionUpdate) => {
        // Future: emit status events to the renderer via webContents.send if needed.
        // Disconnect/close is non-fatal — the session persists for reconnect.
      });
    },

    // -------------------------------------------------------------------------
    // join()
    // -------------------------------------------------------------------------

    async join(groupJid: string): Promise<MonitoredChannel> {
      if (!sock) throw new Error('SOCMINT: WhatsApp connect() must be called before join()');

      let subject: string;
      try {
        const meta = await sock.groupMetadata(groupJid);
        subject = meta.subject;
      } catch {
        // groupMetadata throws when the burner is not a member (or the JID is invalid).
        // Design: assert-joined — never auto-join. The burner must be manually added.
        throw new Error(
          `WhatsApp: burner is not a member of ${groupJid} — manual join required`,
        );
      }

      // Cache the label for use in subscribe()'s mapper context.
      channelLabels.set(groupJid, subject);

      return { channelId: groupJid, label: subject, keywords: [] };
    },

    // -------------------------------------------------------------------------
    // backfill()
    // -------------------------------------------------------------------------

    async backfill(_channelId: string, _limit: number): Promise<HarvestedItem[]> {
      // syncFullHistory:false is our permanent default (per spec §2; syncFullHistory:true
      // is elevated ban-risk and not used). With syncFullHistory:false, Baileys does not
      // deliver history messages via messages.upsert {type:'append'}, so there is nothing
      // to drain. Returns [] unconditionally.
      return [];
    },

    // -------------------------------------------------------------------------
    // subscribe()
    // -------------------------------------------------------------------------

    subscribe(groupJids: string[], onItem: (i: HarvestedItem) => void): () => void {
      if (!sock) throw new Error('SOCMINT: WhatsApp connect() must be called before subscribe()');

      const currentSock = sock;
      const watchedJids = new Set(groupJids);
      const provenance: HarvestedItem['provenance'] = {
        collectorVersion: '1.0.0',
        jobId: '',
        caseId: '',
      };

      const handler = (upsert: WaMessagesUpsert): void => {
        // Group-filter invariant (spec §1 + §2):
        //   1. Only 'notify' type — 'append' is history sync (syncFullHistory:false anyway).
        //   2. Must be a group JID (ends with @g.us) — excludes DMs and broadcast lists.
        //   3. Must be in the subscribed JID set (the burner may be in non-monitored groups).
        //   4. Must not be fromMe (the burner's own messages are excluded).
        if (upsert.type !== 'notify') return;

        for (const msg of upsert.messages) {
          const jid = msg.key.remoteJid ?? '';
          if (!jid.endsWith('@g.us')) continue;
          if (watchedJids.size > 0 && !watchedJids.has(jid)) continue;
          if (msg.key.fromMe) continue;

          const channelLabel = channelLabels.get(jid) ?? jid;
          onItem(
            mapWhatsAppMessage(msg as WaRawMessage, {
              channelLabel,
              harvestedAt: opts.harvestedAt,
              provenance,
            }),
          );
        }
      };

      currentSock.ev.on('messages.upsert', handler);

      let removed = false;
      return (): void => {
        if (removed) return;
        removed = true;
        currentSock.ev.off('messages.upsert', handler);
      };
    },

    // -------------------------------------------------------------------------
    // disconnect()
    // -------------------------------------------------------------------------

    async disconnect(): Promise<void> {
      if (!sock) return;

      const s = sock;
      const a = waAuth;
      sock = null;
      waAuth = null;

      // End the socket — session is preserved (Baileys persists creds via the secretStore
      // adapter; the debounced writes fire before the process exits in normal operation).
      // We do NOT call auth.unlinkSession() here — disconnect is a graceful pause, not a
      // burner retirement. Use handleUnlinkWhatsappBurner (IPC) for session deletion.
      s.end();

      // a.saveCreds() only schedules a debounced write; we have no explicit flush API.
      // The 200ms window is typically within normal Electron teardown order.
      void a; // referenced to satisfy TS noUnusedLocals (used in comments above)
    },
  };
}
