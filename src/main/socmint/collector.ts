/**
 * Task 5: Collector interface + MockCollector + mtcute adapter (live, A2).
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
 *     clearnet choice. connect() loads the StringSession from secretStore (per
 *     burnerId), builds a TelegramClient with SocksProxyTcpTransport for tor / default
 *     transport for direct, and connects. join, backfill, subscribe, disconnect all
 *     operate on the live client.
 *
 * Global constraints:
 *   - Transport is resolved by the caller at the egress boundary, not here.
 *   - Per-burner SOCKS isolation: in 'tor' mode, opts.transport.proxy carries the
 *     per-burner SOCKS5 creds derived by burnerProxyConfig (IsolateSOCKSAuth isolation).
 *   - No static @mtcute/* import anywhere in this file.
 *   - Burner credentials (sessionString, apiId, apiHash) are loaded from secretStore
 *     and NEVER echoed to renderer, logs, or any user-visible surface.
 *   - opts._inject is for unit-test mock injection ONLY; production code never sets it.
 */

import type { HarvestedItem, MonitoredChannel } from '@shared/socmint/types';
import type { SocmintTransport } from './tor-identity';
import { harvestedItemId } from './utils';

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
// Minimal local interfaces — mtcute Message/Peer/Client surface
//
// Declared locally to avoid any static @mtcute/* import in this file.
// They structurally mirror the relevant subset of the mtcute TelegramClient API.
// ---------------------------------------------------------------------------

/** Minimal peer shape (User or Chat) used by the Telegram mapper. */
interface TgPeer {
  id: number;
  /** Human-readable name (displayName on both User and Chat). */
  displayName: string;
  /** Public username, if any. Null when the peer has no username. */
  username?: string | null;
}

/** Minimal message shape used by the Telegram mapper. */
interface TgMessage {
  id: number;
  text: string;
  sender: TgPeer;
  chat: TgPeer;
  date: Date;
  /** Null for text-only messages. The `.type` string distinguishes media kind. */
  media: { type: string } | null;
  /**
   * Permalink to this message. Only valid for public channels/groups.
   * Accessing this getter may throw MtArgumentError for private channels.
   */
  readonly link: string;
}

/** Minimal emitter shape used for onNewMessage subscription. */
interface TgEmitter<T> {
  add(handler: (val: T) => void): void;
  remove(handler: (val: T) => void): void;
}

/** Minimal join-chat result — only the fields we act on. */
interface TgJoinResult {
  status: 'ok' | 'request_sent' | 'webview';
  chat?: TgPeer;
}

/**
 * Minimal facade for the mtcute TelegramClient used by this collector.
 * Exported so tests can implement it as a mock without importing the real library.
 */
export interface MtcuteClientLike {
  importSession(session: string): Promise<void>;
  connect(): Promise<void>;
  /** Start the updates polling loop. Must be called after connect() to receive onNewMessage. */
  startUpdatesLoop?(): Promise<void>;
  joinChat(chatId: string | number): Promise<TgJoinResult>;
  getHistory(chatId: string | number, params?: { limit?: number }): Promise<TgMessage[]>;
  onNewMessage: TgEmitter<TgMessage>;
  disconnect(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Telegram message mapper (private — called from backfill and subscribe)
// ---------------------------------------------------------------------------

const BURNER_KEY_PREFIX = 'socmint.burner.';

/**
 * Map a raw TgMessage to a HarvestedItem.
 *
 * Invariants:
 *   - url is the mtcute-generated permalink if available; falls back to '' for
 *     private channels that don't support permalinks (never throws).
 *   - mediaRef is always '' — analyst-triggered save only; never auto-download.
 *   - authorHandle is the @username if present, otherwise displayName.
 *     Bidi/homoglyph-guard is the renderer's responsibility.
 *   - channelLabel is attacker-controlled; renderer must render as textContent only.
 *   - text is attacker-controlled; renderer must render as textContent only.
 */
function mapTelegramMessage(
  msg: TgMessage,
  harvestedAt: () => string,
  provenance: HarvestedItem['provenance'],
): HarvestedItem {
  const channelId = String(msg.chat.id);
  const messageId = String(msg.id);
  const authorId = String(msg.sender.id);
  const authorHandle = msg.sender.username ? `@${msg.sender.username}` : msg.sender.displayName;
  const channelLabel = msg.chat.displayName;
  const publishedAt = msg.date.toISOString();

  // Permalink: safe to attempt but may throw for private channels (spec §4 no-auto-fetch).
  let url = '';
  try {
    url = msg.link;
  } catch {
    url = '';
  }

  const mediaType = msg.media?.type;

  const item: HarvestedItem = {
    id: harvestedItemId('telegram', channelId, messageId),
    platform: 'telegram',
    channelId,
    channelLabel,
    authorId,
    authorHandle,
    messageId,
    text: msg.text,
    mediaRef: '',
    url,
    publishedAt,
    harvestedAt: harvestedAt(),
    provenance,
  };

  if (mediaType !== undefined) {
    item.mediaType = mediaType;
  }

  return item;
}

// ---------------------------------------------------------------------------
// Live mtcute adapter
// ---------------------------------------------------------------------------

/**
 * Build a live mtcute-backed SocmintCollector for the given burner identity.
 *
 * Transport is pre-resolved by the caller at the egress boundary (handleStartMonitor).
 * In 'tor' mode, resolveTransport already validated Tor (threw SocmintTorUnavailableError
 * if down) and opts.transport.proxy carries the per-burner SOCKS5 config.
 * In 'direct' mode, this is the operator's explicit clearnet choice — never an automatic
 * fallback.
 *
 * Lifecycle:
 *   connect()  — lazy import @mtcute/node; load sessionString/apiId/apiHash from
 *                secretStore; build TelegramClient with SocksProxyTcpTransport (tor)
 *                or default transport (direct); importSession; connect; startUpdatesLoop.
 *   join()     — resolve + join the channel; returns MonitoredChannel.
 *   backfill() — getHistory mapped to HarvestedItem[].
 *   subscribe()— register onNewMessage handler; filter by channelId set; return unsub fn.
 *   disconnect()— disconnect the client.
 *
 * Cred safety:
 *   sessionString, apiId, apiHash are read from secretStore and never echoed to logs,
 *   renderer, or any user-visible surface. On error, the message mentions the burnerId
 *   (a config key, not a secret) but never any credential value.
 *
 * Test injection:
 *   opts._inject.createClient bypasses the real dynamic import and secretStore so unit
 *   tests never hit the wire. Production callers never set _inject.
 */
export function makeMtcuteCollector(opts: {
  burnerId: string;
  transport: SocmintTransport;
  harvestedAt: () => string;
  /**
   * Test-only: inject a mock client factory.
   * When set, connect() uses createClient() and skips the real dynamic import and
   * secretStore. NEVER set in production — only in unit tests.
   */
  _inject?: {
    createClient: () => MtcuteClientLike;
  };
}): SocmintCollector {
  // Active client — null until connect(), cleared on disconnect().
  let client: MtcuteClientLike | null = null;

  return {
    async connect(): Promise<void> {
      // Transport is pre-resolved at the egress boundary by the caller; in 'tor' mode
      // resolveTransport already threw SocmintTorUnavailableError when Tor was down.
      // 'direct' mode is an operator-chosen explicit clearnet dial — never a silent fallback.

      let rawClient: MtcuteClientLike;

      if (opts._inject) {
        // ─── Test path ────────────────────────────────────────────────────────
        // Use the injected factory; skip real import and secretStore.
        rawClient = opts._inject.createClient();
      } else {
        // ─── Production path ─────────────────────────────────────────────────
        // Lazy dynamic import — no static @mtcute/* import exists in this module.
        const { TelegramClient, SocksProxyTcpTransport, MemoryStorage } =
          await import('@mtcute/node');

        // Load burner credentials from the OS-encrypted secretStore.
        // Credentials are NEVER echoed — only the burnerId (a config key) appears in errors.
        const { secretStore } = await import('../secrets/index');
        const safeBurnerId = opts.burnerId.replace(/[/\\]/g, '_');
        const sessionString = await secretStore.get(
          `${BURNER_KEY_PREFIX}${safeBurnerId}.sessionString`,
        );
        if (!sessionString) {
          throw new Error(`SOCMINT: no session stored for burner '${opts.burnerId}'`);
        }
        const apiIdStr = await secretStore.get(`${BURNER_KEY_PREFIX}${safeBurnerId}.apiId`);
        const apiHash = await secretStore.get(`${BURNER_KEY_PREFIX}${safeBurnerId}.apiHash`);
        if (!apiIdStr || !apiHash) {
          throw new Error(`SOCMINT: missing apiId/apiHash for burner '${opts.burnerId}'`);
        }
        const apiId = parseInt(apiIdStr, 10);
        if (!Number.isFinite(apiId)) {
          throw new Error(`SOCMINT: invalid apiId for burner '${opts.burnerId}'`);
        }

        // Build transport:
        //   tor   → SocksProxyTcpTransport with per-burner IsolateSOCKSAuth creds.
        //   direct → omit transport (mtcute default TCP; operator-chosen clearnet).
        const transport =
          opts.transport.mode === 'tor'
            ? new SocksProxyTcpTransport(opts.transport.proxy)
            : undefined;

        const telegramClient = new TelegramClient({
          apiId,
          apiHash,
          storage: new MemoryStorage(),
          // logLevel 0 = silent: suppress all mtcute internal log output.
          // Credentials must never appear in logs; silencing the library logger
          // removes any risk of the library emitting session strings or API hashes.
          logLevel: 0,
          ...(transport !== undefined ? { transport } : {}),
        });

        // Import the persisted StringSession before connecting.
        // This replaces the need for interactive login on each restart.
        await telegramClient.importSession(sessionString);

        rawClient = telegramClient as unknown as MtcuteClientLike;
      }

      // Connect and start the updates loop so onNewMessage fires.
      await rawClient.connect();
      await rawClient.startUpdatesLoop?.();
      client = rawClient;
    },

    async join(channel: string): Promise<MonitoredChannel> {
      if (!client) throw new Error('SOCMINT: connect() must be called before join()');
      const result = await client.joinChat(channel);
      if (result.status === 'ok' && result.chat) {
        return {
          channelId: String(result.chat.id),
          label: result.chat.displayName,
          keywords: [],
        };
      }
      // join request sent or webview guard — return a partial entry with the raw identifier
      // so the caller can track the channel even before approval.
      return { channelId: channel, label: channel, keywords: [] };
    },

    async backfill(channelId: string, limit: number): Promise<HarvestedItem[]> {
      if (!client) throw new Error('SOCMINT: connect() must be called before backfill()');
      // The canonical channelId is mtcute's marked-id string (e.g. "-1001234567890";
      // see join() and subscribe()'s String(msg.chat.id) filter). mtcute's getHistory
      // resolves a STRING as a @username (its resolvePeer sends marked-id strings to
      // contacts.resolveUsername → USERNAME_INVALID), and only a NUMBER triggers
      // ID-based peer resolution. Coerce the stored marked id back to a number here.
      const peer = Number(channelId);
      if (!Number.isFinite(peer)) {
        throw new Error(`SOCMINT: backfill() requires a numeric channel id, got "${channelId}"`);
      }
      // getHistory returns ArrayPaginated<Message, offset> which is a Message[] with extras.
      const messages = await client.getHistory(peer, { limit });
      const provenance: HarvestedItem['provenance'] = {
        collectorVersion: '1.0.0',
        jobId: '',
        caseId: '',
      };
      return messages.map((msg) => mapTelegramMessage(msg, opts.harvestedAt, provenance));
    },

    subscribe(channelIds: string[], onItem: (i: HarvestedItem) => void): () => void {
      if (!client) throw new Error('SOCMINT: connect() must be called before subscribe()');
      const watchedIds = new Set(channelIds);
      const provenance: HarvestedItem['provenance'] = {
        collectorVersion: '1.0.0',
        jobId: '',
        caseId: '',
      };

      const handler = (msg: TgMessage): void => {
        const chatId = String(msg.chat.id);
        // If channelIds is empty, deliver all messages; otherwise filter to the subscribed set.
        if (watchedIds.size > 0 && !watchedIds.has(chatId)) return;
        onItem(mapTelegramMessage(msg, opts.harvestedAt, provenance));
      };

      client.onNewMessage.add(handler);

      let removed = false;
      return (): void => {
        if (removed) return;
        removed = true;
        client?.onNewMessage.remove(handler);
      };
    },

    async disconnect(): Promise<void> {
      if (!client) return;
      const c = client;
      client = null;
      await c.disconnect();
    },
  };
}
