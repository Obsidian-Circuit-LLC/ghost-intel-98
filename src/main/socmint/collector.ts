/**
 * Task 5: Collector interface + MockCollector + sealed mtcute adapter.
 *
 * Architecture:
 *   - SocmintCollector is the stable swap interface (GramJS ↔ mtcute); implementing
 *     it decouples the rest of the SOCMINT pipeline from the concrete MTProto library.
 *   - MockCollector is a deterministic, in-memory implementation for tests and dev.
 *     It exposes push() so callers can inject items into active subscribers.
 *   - makeMtcuteCollector builds the correct proxy-config shape from burnerProxyConfig
 *     (so it inherits the Tor-required invariant), but the actual @mtcute/node import
 *     is a sealed seam: connect() throws a clear "not installed" error until the
 *     operator completes the live smoke test and pins the dependency (spec §7).
 *
 * Global constraints enforced here:
 *   - Tor-required: connect() calls burnerProxyConfig() which throws
 *     SocmintTorUnavailableError if the bgconn Tor is not bootstrapped. Never
 *     returns a clearnet / no-proxy config.
 *   - Per-burner SOCKS isolation: distinct burnerId → distinct (user, pass) via
 *     deriveBurnerCredentials — Tor's IsolateSOCKSAuth gives each its own circuit.
 *   - No static @mtcute/* import anywhere in this file.
 */

import type { HarvestedItem, MonitoredChannel } from '@shared/socmint/types';
import { burnerProxyConfig } from './tor-identity';

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
 * Proxy config is derived via burnerProxyConfig(burnerId) inside connect(), so:
 *   - Tor must be bootstrapped when connect() is called (throws SocmintTorUnavailableError otherwise).
 *   - Distinct burnerIds get distinct SOCKS5 (user, pass) creds — IsolateSOCKSAuth isolation.
 *
 * The @mtcute/node import is lazy and guarded (no static import exists in this module).
 * connect() throws 'SOCMINT: Telegram library not installed — pending operator smoke test +
 * library lock (spec §7)' until the operator has run the live smoke test and pinned the dep.
 *
 * Post-operator-lock TODO (spec §7.3):
 *   const transport = new lib.SocksProxyTcpTransport({
 *     host: proxy.host, port: proxy.port, version: proxy.version,
 *     user: proxy.user, password: proxy.password,
 *   });
 *   const client = new lib.TelegramClient({ transport: () => transport, ... });
 */
export function makeMtcuteCollector(opts: {
  burnerId: string;
  harvestedAt: () => string;
}): SocmintCollector {
  return {
    async connect(): Promise<void> {
      // Tor-required: throws SocmintTorUnavailableError if bgconn Tor is not bootstrapped.
      // Never proceeds to a clearnet dial.  Mirrors cctv-proxy.ts 503-on-Tor-down.
      // The return value is used post-lock to wire the SOCKS5 transport (spec §7.3).
      burnerProxyConfig(opts.burnerId);

      // Sealed seam: lazy guarded import — no static @mtcute/* import exists anywhere.
      // Post-lock proxy config shape (spec §7.3):
      //   { host: '127.0.0.1', port: <bgconn socksPort>, version: 5, user, password }
      // → new SocksProxyTcpTransport({ host, port, version:5, user, password })
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
