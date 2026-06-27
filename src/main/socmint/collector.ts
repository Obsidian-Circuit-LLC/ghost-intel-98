/**
 * Task 5: Collector interface + MockCollector + sealed mtcute adapter.
 *
 * Architecture:
 *   - SocmintCollector is the stable swap interface (GramJS ↔ mtcute); implementing
 *     it decouples the rest of the SOCMINT pipeline from the concrete MTProto library.
 *   - MockCollector is a deterministic, in-memory implementation for tests and dev.
 *     It exposes push() so callers can inject items into active subscribers.
 *   - makeMtcuteCollector receives a pre-resolved SocmintTransport (resolved at the
 *     egress boundary in handleStartMonitor, not here). In 'tor' mode the transport
 *     was already validated (threw SocmintTorUnavailableError if Tor was down) before
 *     the collector is constructed. In 'direct' mode it is the operator's explicit
 *     clearnet choice. connect() is still a sealed seam: it throws 'not installed'
 *     until the operator completes the live smoke test and pins the dependency (spec §7).
 *
 * Global constraints:
 *   - Transport is resolved by the caller at the egress boundary, not here.
 *   - Per-burner SOCKS isolation: in 'tor' mode, opts.transport.proxy carries the
 *     per-burner SOCKS5 creds derived by burnerProxyConfig (IsolateSOCKSAuth isolation).
 *   - No static @mtcute/* import anywhere in this file.
 */

import type { HarvestedItem, MonitoredChannel } from '@shared/socmint/types';
import type { SocmintTransport } from './tor-identity';

// ---------------------------------------------------------------------------
// Interface + events
// ---------------------------------------------------------------------------

export interface CollectorEvents {
  onItem(cb: (raw: HarvestedItem) => void): void;
}

export interface SocmintCollector {
  connect(): Promise<void>;
  join(channel: string): Promise<MonitoredChannel>;
  backfill(channelId: string, limit: number): Promise<HarvestedItem[]>;
  /** Subscribe to live items for the given channel IDs. Returns an unsubscribe function. */
  subscribe(channelIds: string[], onItem: (i: HarvestedItem) => void): () => void;
  disconnect(): Promise<void>;
}

// ---------------------------------------------------------------------------
// MockCollector — deterministic, in-memory
// ---------------------------------------------------------------------------

/**
 * In-memory collector for tests and dev mode.
 *
 * Call push() to deliver an item to all currently registered subscribers,
 * mirroring the live collector's onMessage behaviour without real network I/O.
 */
export class MockCollector implements SocmintCollector {
  private readonly joined: MonitoredChannel[] = [];
  private handlers: Array<(i: HarvestedItem) => void> = [];

  async connect(): Promise<void> {}

  async join(channel: string): Promise<MonitoredChannel> {
    const mc: MonitoredChannel = { channelId: channel, label: channel, keywords: [] };
    this.joined.push(mc);
    return mc;
  }

  async backfill(_channelId: string, _limit: number): Promise<HarvestedItem[]> {
    return [];
  }

  subscribe(_channelIds: string[], onItem: (i: HarvestedItem) => void): () => void {
    this.handlers.push(onItem);
    let active = true;
    return (): void => {
      if (!active) return;
      active = false;
      this.handlers = this.handlers.filter((h) => h !== onItem);
    };
  }

  async disconnect(): Promise<void> {
    this.handlers = [];
  }

  /**
   * Test / dev helper: deliver item to all active subscribers synchronously.
   * Mirrors what the live collector does when a new message arrives on a channel.
   */
  push(item: HarvestedItem): void {
    // Snapshot handlers so a subscriber that unsubscribes during iteration is handled safely.
    for (const h of [...this.handlers]) h(item);
  }
}

// ---------------------------------------------------------------------------
// Sealed mtcute adapter
// ---------------------------------------------------------------------------

/**
 * Build an mtcute-backed SocmintCollector for the given burner identity.
 *
 * Transport is pre-resolved by the caller at the egress boundary (handleStartMonitor).
 * In 'tor' mode, resolveTransport already validated Tor (threw SocmintTorUnavailableError
 * if down) and opts.transport.proxy carries the per-burner SOCKS5 config.
 * In 'direct' mode, this is the operator's explicit clearnet choice — never an automatic
 * fallback.
 *
 * The @mtcute/node import is lazy and guarded (no static import exists in this module).
 * connect() throws 'SOCMINT: Telegram library not installed — pending operator smoke test +
 * library lock (spec §7)' until the operator has run the live smoke test and pinned the dep.
 *
 * Post-operator-lock TODO (spec §7.3):
 *   tor  → new SocksProxyTcpTransport(opts.transport.proxy)
 *   direct → default TCP transport
 */
export function makeMtcuteCollector(opts: {
  burnerId: string;
  transport: SocmintTransport;
  harvestedAt: () => string;
}): SocmintCollector {
  return {
    async connect(): Promise<void> {
      // Transport is pre-resolved at the egress boundary by the caller; in 'tor' mode
      // resolveTransport already threw SocmintTorUnavailableError when Tor was down.
      // opts.transport.proxy carries the SOCKS5 config for post-lock wiring (spec §7.3).
      // 'direct' mode is an operator-chosen explicit clearnet dial — never a silent fallback.
      void opts; // opts.burnerId + opts.transport used post-lock (spec §7.3); referenced here to satisfy TS.

      // Sealed seam: lazy guarded import — no static @mtcute/* import exists anywhere.
      // Post-lock transport wiring (spec §7.3):
      //   tor: new SocksProxyTcpTransport(opts.transport.proxy)
      //   direct: default TCP transport
      try {
        // @ts-expect-error: @mtcute/node is intentionally absent — sealed seam pending operator smoke test (spec §7)
        await import('@mtcute/node');
      } catch {
        throw new Error(
          'SOCMINT: Telegram library not installed — pending operator smoke test + library lock (spec §7)',
        );
      }
    },

    async join(_channel: string): Promise<MonitoredChannel> {
      throw new Error(
        'SOCMINT: Telegram library not installed — pending operator smoke test + library lock (spec §7)',
      );
    },

    async backfill(_channelId: string, _limit: number): Promise<HarvestedItem[]> {
      throw new Error(
        'SOCMINT: Telegram library not installed — pending operator smoke test + library lock (spec §7)',
      );
    },

    subscribe(
      _channelIds: string[],
      _onItem: (i: HarvestedItem) => void,
    ): () => void {
      throw new Error(
        'SOCMINT: Telegram library not installed — pending operator smoke test + library lock (spec §7)',
      );
    },

    async disconnect(): Promise<void> {
      // No-op: nothing to close before the library seam is open.
    },
  };
}
