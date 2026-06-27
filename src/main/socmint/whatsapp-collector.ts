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
//
// buildBaileysSocketConfig is placed after SILENT_LOGGER (which it uses).

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
// buildBaileysSocketConfig — pure, exported, unit-testable
// ---------------------------------------------------------------------------

/**
 * Build the makeWASocket configuration object.
 *
 * Pure function: no Baileys import, no network I/O, no secretStore access.
 * Exported so ipc.ts can reuse it in handleSetWhatsappBurnerPairingCode
 * without duplicating the logger / syncFullHistory / agent wiring.
 *
 * @param _transport  Pre-resolved transport.  Included for documentation and
 *                    future use; agent presence already encodes tor vs direct.
 * @param auth        WhatsApp auth state whose `.state` is passed to makeWASocket.
 * @param agent       SocksProxyAgent instance (tor mode) or `undefined` (direct).
 *                    When provided, both `agent` and `fetchAgent` are set so that
 *                    Baileys' WS upgrade AND its internal fetch calls both route
 *                    through the same SOCKS5 circuit.
 * @returns           Plain config object assignable to Parameters<typeof makeWASocket>[0].
 */
export function buildBaileysSocketConfig(
  _transport: SocmintTransport,
  auth: WhatsAppAuthState,
  agent: unknown | undefined,
): Record<string, unknown> {
  const config: Record<string, unknown> = {
    // auth.state is structurally compatible at runtime; import type keeps this sealed.
    auth: auth.state,
    syncFullHistory: false,
    // SILENT_LOGGER silences all Baileys output including key-material at default level.
    logger: SILENT_LOGGER as unknown,
  };
  if (agent !== undefined) {
    config['agent'] = agent;
    config['fetchAgent'] = agent;
  }
  return config;
}

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
      // createSock is a closure that re-creates a fresh WaSocketLike using the same auth
      // and proxy config.  It is called once initially and again on 515 (restartRequired)
      // closes where Baileys cannot auto-reconnect and a fresh socket is required.
      let createSock: () => WaSocketLike;

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
        createSock = () => opts._inject!.createSocket(proxyUrl);
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

        // Type alias inside the dynamic-import block to keep casts local.
        type BaileysConfig = Parameters<typeof makeWASocket>[0];
        const config = buildBaileysSocketConfig(opts.transport, auth, agent) as BaileysConfig;

        // createSock is captured by the 515-restart handler so each restart gets a fresh
        // socket with the same config (no re-importing modules or re-reading secretStore).
        createSock = () => makeWASocket(config) as unknown as WaSocketLike;
      }

      waAuth = auth;

      // Create the initial socket and register the creds-persistence handler.
      sock = createSock();
      sock.ev.on('creds.update', () => { void auth.saveCreds(); });

      // Await connection:open before returning — prevents callers from calling join()
      // or subscribe() before the session is confirmed active (connect-before-open race fix).
      //
      // Close codes handled:
      //   401 (loggedOut)        — reject immediately; session permanently invalidated.
      //   515 (restartRequired)  — Baileys cannot auto-reconnect; recreate the socket and
      //                            continue waiting.  This is the standard Baileys restart
      //                            flow and is required for freshly-paired burners whose
      //                            first startMonitor triggers a server-side session refresh.
      //   other close codes      — wait; a reconnect or further close event may follow.
      //   timeout (60 s)         — reject.
      const CONNECT_TIMEOUT_MS = 60_000;
      const RESTART_REQUIRED = 515; // DisconnectReason.restartRequired
      const LOGGED_OUT = 401;       // DisconnectReason.loggedOut

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(
            new Error(
              'SOCMINT: WhatsApp connect() timed out (60 s) waiting for connection:open',
            ),
          );
        }, CONNECT_TIMEOUT_MS);

        // wire() registers a connection.update handler on socket `s`.  On a 515 close it
        // tears down `s`, creates a replacement, and calls itself on the new socket so the
        // outer promise continues waiting for the eventual 'open'.
        const wire = (s: WaSocketLike): void => {
          s.ev.on('connection.update', (update: WaConnectionUpdate) => {
            if (update.connection === 'open') {
              clearTimeout(timer);
              resolve();
              return;
            }
            if (update.connection === 'close') {
              const statusCode = (
                (update.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)
                  ?.output?.statusCode
              );
              if (statusCode === LOGGED_OUT) {
                clearTimeout(timer);
                reject(new Error('SOCMINT: WhatsApp session logged out — re-pair required'));
                return;
              }
              if (statusCode === RESTART_REQUIRED) {
                // 515 restartRequired: Baileys will NOT reconnect on its own — a fresh socket
                // is mandatory.  End the current socket, create a replacement, register
                // handlers, then continue waiting for connection:open on the new socket.
                const prev = sock!;
                sock = createSock();
                sock.ev.on('creds.update', () => { void auth.saveCreds(); });
                wire(sock);
                try { prev.end?.(); } catch { /* ignore */ }
                return;
              }
              // Other close codes: wait — a reconnect or further close event may follow.
            }
          });
        };

        wire(sock!);
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
