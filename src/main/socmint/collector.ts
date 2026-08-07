/**
 * SocmintCollector interface + MockCollector.
 *
 * `SocmintCollector` is the stable swap interface that decouples the rest of the SOCMINT
 * pipeline (store/rank/filter/IPC) from the concrete collection engine. The live Telegram
 * engine is the Tor-fail-closed capture-window collector `TelegramHunterCollector`
 * (`telegram-hunter/collector.ts`), which replaced the retired mtcute streaming adapter
 * (TG5). WhatsApp has its own `makeWhatsAppCollector`. `MockCollector` is a deterministic,
 * in-memory implementation for tests and dev — it exposes `push()` so callers can inject
 * items into active subscribers.
 */

import type { HarvestedItem, MonitoredChannel } from '@shared/socmint/types';

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
