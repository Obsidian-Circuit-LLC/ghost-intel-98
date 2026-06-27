/**
 * WA-T2: Sealed WhatsApp collector (implements SocmintCollector).
 *
 * Architecture:
 *   - makeWhatsAppCollector is the WhatsApp counterpart of makeMtcuteCollector.
 *     Its signature is identical: { burnerId, transport, harvestedAt }.
 *   - Every active method (connect/join/backfill/subscribe) throws a sealed-seam
 *     error until the operator completes the §5.5 supply-chain checklist and unseals
 *     the dependency. disconnect() is a deliberate no-op (nothing to close before
 *     the seam is open).
 *   - The guarded dynamic import in connect() uses the same lazy-import pattern as
 *     makeMtcuteCollector so no static @whiskeysockets/baileys reference exists
 *     anywhere in this module.
 *
 * lotusbail supply-chain context (§5.5, required before unsealing):
 *   The December 2025 lotusbail attack (malicious npm clone of @whiskeysockets/baileys,
 *   ~56k downloads) exfiltrated all WhatsApp auth tokens, messages, contact lists, and
 *   media via RSA-encrypted exfiltration. Critically it hijacked device-linking with a
 *   hard-coded pairing code, giving persistent account access that survives package
 *   uninstall. Before unsealing this seam:
 *     (1) verify scope is exactly @whiskeysockets/baileys (GitHub: WhiskeySockets/Baileys)
 *     (2) --save-exact v7.0.0-rc13 + verify package-lock.json integrity SHA-512 vs registry
 *     (3) audit whatsapp-rust-bridge (0.5.4) — WASM vs native NAPI + checksum-verify prebuilt
 *     (4) audit libsignal (^6.0.0) identity/source — unexpected author = red flag
 *     (5) confirm link-preview-js is absent from the lockfile
 *
 * Global constraints (same as collector.ts):
 *   - No static @whiskeysockets/baileys import anywhere in this file.
 *   - Transport is resolved by the caller at the egress boundary, not here.
 *   - Per-burner SOCKS isolation: opts.transport.proxy carries per-burner SOCKS5 creds.
 *   - In 'tor' mode: resolveTransport already threw SocmintTorUnavailableError when Tor
 *     was down — transport arriving here was already validated (fail-closed enforced upstream).
 *   - 'direct' mode is an explicit operator choice, never an automatic clearnet fallback.
 */

import type { HarvestedItem, MonitoredChannel } from '@shared/socmint/types';
import type { SocmintCollector } from './collector';
import type { SocmintTransport } from './tor-identity';

// ---------------------------------------------------------------------------
// Sealed seam message
// ---------------------------------------------------------------------------

/**
 * The canonical sealed-seam error message thrown by every active method until the
 * operator completes the §5.5 supply-chain checklist and unseals the Baileys import.
 * Kept as a constant so the test can assert against it without string duplication.
 */
export const WA_SEALED_MESSAGE =
  'SOCMINT: WhatsApp library not installed — pending operator supply-chain verification + library lock. Complete §5.5 checklist before unsealing.';

// ---------------------------------------------------------------------------
// Sealed collector factory
// ---------------------------------------------------------------------------

/**
 * Build a sealed WhatsApp SocmintCollector for the given burner identity.
 *
 * Transport is pre-resolved by the caller at the egress boundary (handleStartMonitor).
 * In 'tor' mode, resolveTransport already validated Tor (threw SocmintTorUnavailableError
 * if down) and opts.transport.proxy carries the per-burner SOCKS5 config.
 * In 'direct' mode, this is the operator's explicit clearnet choice — never an automatic
 * fallback.
 *
 * The @whiskeysockets/baileys import is lazy and guarded (no static import exists in this
 * module). connect() throws WA_SEALED_MESSAGE until the operator has completed the §5.5
 * supply-chain checklist and pinned the dependency.
 *
 * Post-operator-lock TODO (§5.5):
 *   tor    → new SocksProxyAgent(`socks5://${user}:${pass}@${host}:${port}`)
 *             → makeWASocket({ auth, agent, fetchAgent, logger: pino({level:'silent'}) })
 *   direct → makeWASocket({ auth, logger: pino({level:'silent'}) })
 *   Both:   register connection.update + creds.update + messages.upsert handlers.
 */
export function makeWhatsAppCollector(opts: {
  burnerId: string;
  transport: SocmintTransport;
  harvestedAt: () => string;
}): SocmintCollector {
  return {
    async connect(): Promise<void> {
      // Transport is pre-resolved at the egress boundary by the caller; in 'tor' mode
      // resolveTransport already threw SocmintTorUnavailableError when Tor was down.
      // opts.transport.proxy carries the SOCKS5 config for post-lock wiring (§5.5):
      //   tor:    new SocksProxyAgent(`socks5://${user}:${pass}@host:port`)
      //           → makeWASocket({ auth, agent, fetchAgent, logger: pino({level:'silent'}) })
      //   direct: makeWASocket({ auth, logger: pino({level:'silent'}) })
      // 'direct' mode is an operator-chosen explicit clearnet dial — never a silent fallback.
      void opts; // opts.burnerId + opts.transport used post-lock (§5.5); referenced to satisfy TS.

      // Sealed seam: lazy guarded import — no static @whiskeysockets/baileys import exists.
      // pino must be silenced (Baileys logs key material at its default level).
      // Post-lock: makeWASocket({ auth, agent?, fetchAgent?, syncFullHistory: false,
      //            logger: pino({level:'silent'}) })
      try {
        // @ts-expect-error: @whiskeysockets/baileys is intentionally absent — sealed seam pending §5.5 supply-chain checklist
        await import('@whiskeysockets/baileys');
      } catch {
        throw new Error(WA_SEALED_MESSAGE);
      }
    },

    async join(_channel: string): Promise<MonitoredChannel> {
      throw new Error(WA_SEALED_MESSAGE);
    },

    async backfill(_channelId: string, _limit: number): Promise<HarvestedItem[]> {
      throw new Error(WA_SEALED_MESSAGE);
    },

    subscribe(
      _channelIds: string[],
      _onItem: (i: HarvestedItem) => void,
    ): () => void {
      throw new Error(WA_SEALED_MESSAGE);
    },

    async disconnect(): Promise<void> {
      // No-op: nothing to close before the library seam is open.
      // Post-lock: sock.end() + flush pending auth writes (keep session for reconnect).
    },
  };
}
