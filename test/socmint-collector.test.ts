/**
 * Task 5 / A2: Collector interface + MockCollector + live mtcute adapter.
 *
 * Tests:
 *  1. MockCollector: connect/join/backfill/subscribe/unsubscribe/disconnect.
 *  2. makeMtcuteCollector (live, A2): all methods exercised via an injected
 *     mock MtcuteClientLike — no real network, no secretStore, no Tor.
 *     The _inject.createClient factory bypasses the real dynamic import so
 *     unit tests never hit the wire.
 *  3. burnerProxyConfig: version:5 + per-burner creds (via tor-identity directly).
 *
 * Note: The old "sealed seam" tests (connect() rejects with 'not installed')
 * are replaced by the live mock-injection tests here — the seam is now open
 * and @mtcute/node is installed.  The Tor-down / transport-resolution invariants
 * remain in socmint-tor-identity.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setBgTor, _resetBgTorForTest } from '../src/main/bgconn/tor-singleton';
import type { BgconnTor } from '../src/main/bgconn/tor';
import {
  MockCollector,
  makeMtcuteCollector,
  type MtcuteClientLike,
} from '../src/main/socmint/collector';
import {
  deriveBurnerCredentials,
  burnerProxyConfig,
} from '../src/main/socmint/tor-identity';
import type { HarvestedItem } from '../src/shared/socmint/types';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeMockTor(bootstrapped: boolean, port: number): BgconnTor {
  return {
    isBootstrapped: () => bootstrapped,
    socksPort: () => port,
    start: async () => {},
    stop: async () => {},
  } as unknown as BgconnTor;
}

function makeItem(overrides: Partial<HarvestedItem> = {}): HarvestedItem {
  return {
    id: 'test-item-id',
    platform: 'telegram',
    authorHandle: 'test_user',
    authorId: '12345',
    text: 'Hello world',
    channelId: '-100123',
    channelLabel: 'Test Channel',
    messageId: '42',
    publishedAt: '2026-01-01T00:00:00Z',
    harvestedAt: '2026-01-01T00:01:00Z',
    url: 'https://t.me/test/42',
    provenance: { collectorVersion: '1.0.0', jobId: 'job1', caseId: 'case1' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// MockMtcuteClient — implements MtcuteClientLike for unit tests.
// No real network, no secretStore, no Tor.
// ---------------------------------------------------------------------------

type TgHandler = (msg: TgTestMessage) => void;

interface TgTestMessage {
  id: number;
  text: string;
  sender: { id: number; displayName: string; username: string | null };
  chat: { id: number; displayName: string };
  date: Date;
  media: { type: string } | null;
  readonly link: string;
}

class MockMtcuteClient implements MtcuteClientLike {
  connectCalled = false;
  disconnectCalled = false;
  importSessionCalled = false;
  startUpdatesLoopCalled = false;

  private _handlers: TgHandler[] = [];
  readonly onNewMessage = {
    add: (h: TgHandler) => { this._handlers.push(h); },
    remove: (h: TgHandler) => { this._handlers = this._handlers.filter((x) => x !== h); },
  };

  // Configurable responses
  joinResult: { status: 'ok'; chat: { id: number; displayName: string } } = {
    status: 'ok',
    chat: { id: -100999, displayName: 'Mock Channel' },
  };
  historyResult: TgTestMessage[] = [];

  async importSession(_session: string): Promise<void> {
    this.importSessionCalled = true;
  }

  async connect(): Promise<void> {
    this.connectCalled = true;
  }

  async startUpdatesLoop(): Promise<void> {
    this.startUpdatesLoopCalled = true;
  }

  async joinChat(_chatId: string | number): Promise<{ status: 'ok'; chat: { id: number; displayName: string } }> {
    return this.joinResult;
  }

  async getHistory(
    _chatId: string | number,
    _params?: { limit?: number },
  ): Promise<TgTestMessage[]> {
    return this.historyResult;
  }

  async disconnect(): Promise<void> {
    this.disconnectCalled = true;
  }

  /** Test helper: push a synthetic message to all active onNewMessage handlers. */
  pushMessage(msg: TgTestMessage): void {
    for (const h of [...this._handlers]) h(msg);
  }
}

function makeTgMessage(overrides: Partial<TgTestMessage> = {}): TgTestMessage {
  return {
    id: 42,
    text: 'Hello from Telegram',
    sender: { id: 12345, displayName: 'TestUser', username: 'testuser' },
    chat: { id: -100999, displayName: 'Mock Channel' },
    date: new Date('2026-01-01T00:00:00Z'),
    media: null,
    get link() { return 'https://t.me/mockchannel/42'; },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// MockCollector
// ---------------------------------------------------------------------------

describe('MockCollector — connect / join / backfill', () => {
  it('connect() resolves without error', async () => {
    const mock = new MockCollector();
    await expect(mock.connect()).resolves.toBeUndefined();
  });

  it('join() returns a MonitoredChannel with the given channelId and label', async () => {
    const mock = new MockCollector();
    await mock.connect();
    const mc = await mock.join('-100999');
    expect(mc.channelId).toBe('-100999');
    expect(mc.label).toBe('-100999');
    expect(Array.isArray(mc.keywords)).toBe(true);
  });

  it('backfill() resolves to an array', async () => {
    const mock = new MockCollector();
    await mock.connect();
    const items = await mock.backfill('-100999', 10);
    expect(Array.isArray(items)).toBe(true);
  });
});

describe('MockCollector — subscribe / push / unsubscribe', () => {
  it('subscribe delivers items pushed via push()', async () => {
    const mock = new MockCollector();
    await mock.connect();
    await mock.join('-100123');

    const received: HarvestedItem[] = [];
    mock.subscribe(['-100123'], (item) => received.push(item));

    const item1 = makeItem({ id: 'item-1' });
    const item2 = makeItem({ id: 'item-2' });
    mock.push(item1);
    mock.push(item2);

    expect(received).toHaveLength(2);
    expect(received[0].id).toBe('item-1');
    expect(received[1].id).toBe('item-2');
  });

  it('unsubscribe() stops item delivery to that subscriber', async () => {
    const mock = new MockCollector();
    await mock.connect();

    const received: HarvestedItem[] = [];
    const unsubscribe = mock.subscribe(['-100123'], (item) => received.push(item));

    mock.push(makeItem({ id: 'before-unsub' }));
    expect(received).toHaveLength(1);

    unsubscribe();

    mock.push(makeItem({ id: 'after-unsub' }));
    expect(received).toHaveLength(1); // no new items
  });

  it('multiple subscribers each receive pushed items independently', async () => {
    const mock = new MockCollector();
    await mock.connect();

    const a: HarvestedItem[] = [];
    const b: HarvestedItem[] = [];
    mock.subscribe([], (i) => a.push(i));
    mock.subscribe([], (i) => b.push(i));

    mock.push(makeItem({ id: 'shared-item' }));

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it('unsubscribing one subscriber does not affect others', async () => {
    const mock = new MockCollector();
    await mock.connect();

    const a: HarvestedItem[] = [];
    const b: HarvestedItem[] = [];
    const unsubA = mock.subscribe([], (i) => a.push(i));
    mock.subscribe([], (i) => b.push(i));

    unsubA();

    mock.push(makeItem({ id: 'after-unsub-a' }));

    expect(a).toHaveLength(0);
    expect(b).toHaveLength(1);
  });

  it('unsubscribe is idempotent — calling it twice does not throw', async () => {
    const mock = new MockCollector();
    await mock.connect();

    const received: HarvestedItem[] = [];
    const unsub = mock.subscribe([], (i) => received.push(i));
    unsub();
    expect(() => unsub()).not.toThrow();

    mock.push(makeItem());
    expect(received).toHaveLength(0);
  });
});

describe('MockCollector — disconnect', () => {
  it('disconnect() clears all subscribers so no further items are delivered', async () => {
    const mock = new MockCollector();
    await mock.connect();

    const received: HarvestedItem[] = [];
    mock.subscribe([], (i) => received.push(i));

    mock.push(makeItem({ id: 'before-disconnect' }));
    expect(received).toHaveLength(1);

    await mock.disconnect();

    mock.push(makeItem({ id: 'after-disconnect' }));
    expect(received).toHaveLength(1);
  });

  it('disconnect() resolves without error', async () => {
    const mock = new MockCollector();
    await mock.connect();
    await expect(mock.disconnect()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// makeMtcuteCollector — live implementation exercised via mock client injection
// ---------------------------------------------------------------------------

describe('makeMtcuteCollector — connect / disconnect (mock client)', () => {
  it('connect() calls client.connect() and startUpdatesLoop()', async () => {
    const mockClient = new MockMtcuteClient();
    const collector = makeMtcuteCollector({
      burnerId: 'test-burner',
      transport: { mode: 'direct' },
      harvestedAt: () => '2026-01-01T00:00:00Z',
      _inject: { createClient: () => mockClient },
    });

    await collector.connect();

    expect(mockClient.connectCalled).toBe(true);
    expect(mockClient.startUpdatesLoopCalled).toBe(true);
  });

  it('disconnect() calls client.disconnect()', async () => {
    const mockClient = new MockMtcuteClient();
    const collector = makeMtcuteCollector({
      burnerId: 'test-burner',
      transport: { mode: 'direct' },
      harvestedAt: () => '2026-01-01T00:00:00Z',
      _inject: { createClient: () => mockClient },
    });

    await collector.connect();
    await collector.disconnect();

    expect(mockClient.disconnectCalled).toBe(true);
  });

  it('disconnect() before connect() is a no-op', async () => {
    const mockClient = new MockMtcuteClient();
    const collector = makeMtcuteCollector({
      burnerId: 'test-burner',
      transport: { mode: 'direct' },
      harvestedAt: () => '2026-01-01T00:00:00Z',
      _inject: { createClient: () => mockClient },
    });

    await expect(collector.disconnect()).resolves.toBeUndefined();
    expect(mockClient.disconnectCalled).toBe(false);
  });

  it('connect() works with tor transport (mock client)', async () => {
    setBgTor(makeMockTor(true, 9999));
    try {
      const mockClient = new MockMtcuteClient();
      const proxy = burnerProxyConfig('test-burner-tor');
      const collector = makeMtcuteCollector({
        burnerId: 'test-burner-tor',
        transport: { mode: 'tor', proxy },
        harvestedAt: () => '2026-01-01T00:00:00Z',
        _inject: { createClient: () => mockClient },
      });

      await collector.connect();
      expect(mockClient.connectCalled).toBe(true);
    } finally {
      _resetBgTorForTest();
    }
  });
});

describe('makeMtcuteCollector — join (mock client)', () => {
  it('join() calls joinChat and returns a MonitoredChannel with numeric channelId', async () => {
    const mockClient = new MockMtcuteClient();
    mockClient.joinResult = { status: 'ok', chat: { id: -100999, displayName: 'Alpha Channel' } };

    const collector = makeMtcuteCollector({
      burnerId: 'test-burner',
      transport: { mode: 'direct' },
      harvestedAt: () => '2026-01-01T00:00:00Z',
      _inject: { createClient: () => mockClient },
    });
    await collector.connect();
    const mc = await collector.join('@alphachannel');

    expect(mc.channelId).toBe('-100999');
    expect(mc.label).toBe('Alpha Channel');
    expect(Array.isArray(mc.keywords)).toBe(true);
  });

  it('join() before connect() throws a descriptive error', async () => {
    const mockClient = new MockMtcuteClient();
    const collector = makeMtcuteCollector({
      burnerId: 'test-burner',
      transport: { mode: 'direct' },
      harvestedAt: () => '',
      _inject: { createClient: () => mockClient },
    });

    await expect(collector.join('@some')).rejects.toThrow('connect() must be called before join()');
  });
});

describe('makeMtcuteCollector — backfill (mock client)', () => {
  it('backfill() maps TgMessages to HarvestedItems', async () => {
    const mockClient = new MockMtcuteClient();
    mockClient.historyResult = [
      makeTgMessage({ id: 1, text: 'First', date: new Date('2026-01-01T00:00:00Z') }),
      makeTgMessage({ id: 2, text: 'Second', date: new Date('2026-01-01T00:01:00Z') }),
    ];

    const collector = makeMtcuteCollector({
      burnerId: 'test-burner',
      transport: { mode: 'direct' },
      harvestedAt: () => '2026-01-01T00:02:00Z',
      _inject: { createClient: () => mockClient },
    });
    await collector.connect();
    const items = await collector.backfill('-100999', 10);

    expect(items).toHaveLength(2);
    expect(items[0].text).toBe('First');
    expect(items[0].platform).toBe('telegram');
    expect(items[0].messageId).toBe('1');
    expect(items[0].channelId).toBe('-100999');
    expect(items[0].publishedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(items[0].harvestedAt).toBe('2026-01-01T00:02:00Z');
    expect(items[1].text).toBe('Second');
  });

  it('backfill() produces deterministic item IDs (SHA-256 of platform:channelId:messageId)', async () => {
    const { createHash } = await import('node:crypto');
    const mockClient = new MockMtcuteClient();
    mockClient.historyResult = [makeTgMessage({ id: 77 })];

    const collector = makeMtcuteCollector({
      burnerId: 'test-burner',
      transport: { mode: 'direct' },
      harvestedAt: () => '2026-01-01T00:00:00Z',
      _inject: { createClient: () => mockClient },
    });
    await collector.connect();
    const [item] = await collector.backfill('-100999', 1);

    const expectedId = createHash('sha256')
      .update('telegram:-100999:77', 'utf8')
      .digest('hex');
    expect(item.id).toBe(expectedId);
  });

  it('backfill() sets authorHandle from username when present', async () => {
    const mockClient = new MockMtcuteClient();
    mockClient.historyResult = [
      makeTgMessage({ sender: { id: 1, displayName: 'Full Name', username: 'myhandle' } }),
    ];

    const collector = makeMtcuteCollector({
      burnerId: 'test-burner',
      transport: { mode: 'direct' },
      harvestedAt: () => '2026-01-01T00:00:00Z',
      _inject: { createClient: () => mockClient },
    });
    await collector.connect();
    const [item] = await collector.backfill('-100999', 1);

    expect(item.authorHandle).toBe('@myhandle');
    expect(item.authorId).toBe('1');
  });

  it('backfill() falls back to displayName when username is null', async () => {
    const mockClient = new MockMtcuteClient();
    mockClient.historyResult = [
      makeTgMessage({ sender: { id: 2, displayName: 'Anonymous', username: null } }),
    ];

    const collector = makeMtcuteCollector({
      burnerId: 'test-burner',
      transport: { mode: 'direct' },
      harvestedAt: () => '2026-01-01T00:00:00Z',
      _inject: { createClient: () => mockClient },
    });
    await collector.connect();
    const [item] = await collector.backfill('-100999', 1);

    expect(item.authorHandle).toBe('Anonymous');
  });

  it('backfill() captures mediaType when media is present', async () => {
    const mockClient = new MockMtcuteClient();
    mockClient.historyResult = [makeTgMessage({ media: { type: 'photo' } })];

    const collector = makeMtcuteCollector({
      burnerId: 'test-burner',
      transport: { mode: 'direct' },
      harvestedAt: () => '2026-01-01T00:00:00Z',
      _inject: { createClient: () => mockClient },
    });
    await collector.connect();
    const [item] = await collector.backfill('-100999', 1);

    expect(item.mediaType).toBe('photo');
  });

  it('backfill() sets mediaRef to empty string (no auto-download)', async () => {
    const mockClient = new MockMtcuteClient();
    mockClient.historyResult = [makeTgMessage({ media: { type: 'video' } })];

    const collector = makeMtcuteCollector({
      burnerId: 'test-burner',
      transport: { mode: 'direct' },
      harvestedAt: () => '2026-01-01T00:00:00Z',
      _inject: { createClient: () => mockClient },
    });
    await collector.connect();
    const [item] = await collector.backfill('-100999', 1);

    expect(item.mediaRef).toBe('');
  });

  it('backfill() url falls back to empty string when link getter throws', async () => {
    const mockClient = new MockMtcuteClient();
    const badMsg: TgTestMessage = {
      ...makeTgMessage(),
      get link(): string {
        throw new Error('no permalink for private channel');
      },
    };
    mockClient.historyResult = [badMsg];

    const collector = makeMtcuteCollector({
      burnerId: 'test-burner',
      transport: { mode: 'direct' },
      harvestedAt: () => '2026-01-01T00:00:00Z',
      _inject: { createClient: () => mockClient },
    });
    await collector.connect();
    const [item] = await collector.backfill('-100999', 1);

    expect(item.url).toBe('');
  });

  it('backfill() before connect() throws a descriptive error', async () => {
    const mockClient = new MockMtcuteClient();
    const collector = makeMtcuteCollector({
      burnerId: 'test-burner',
      transport: { mode: 'direct' },
      harvestedAt: () => '',
      _inject: { createClient: () => mockClient },
    });

    await expect(collector.backfill('-100999', 10)).rejects.toThrow(
      'connect() must be called before backfill()',
    );
  });
});

describe('makeMtcuteCollector — subscribe (mock client)', () => {
  it('subscribe receives items for subscribed channel', async () => {
    const mockClient = new MockMtcuteClient();
    const collector = makeMtcuteCollector({
      burnerId: 'test-burner',
      transport: { mode: 'direct' },
      harvestedAt: () => '2026-01-01T00:00:00Z',
      _inject: { createClient: () => mockClient },
    });
    await collector.connect();

    const received: HarvestedItem[] = [];
    collector.subscribe(['-100999'], (i) => received.push(i));

    mockClient.pushMessage(makeTgMessage({ id: 10, text: 'Live message' }));

    expect(received).toHaveLength(1);
    expect(received[0].text).toBe('Live message');
    expect(received[0].platform).toBe('telegram');
  });

  it('subscribe filters out messages for non-subscribed channels', async () => {
    const mockClient = new MockMtcuteClient();
    const collector = makeMtcuteCollector({
      burnerId: 'test-burner',
      transport: { mode: 'direct' },
      harvestedAt: () => '2026-01-01T00:00:00Z',
      _inject: { createClient: () => mockClient },
    });
    await collector.connect();

    const received: HarvestedItem[] = [];
    // Subscribe to channel -100111 only.
    collector.subscribe(['-100111'], (i) => received.push(i));

    // Push a message for -100999 (different channel).
    mockClient.pushMessage(makeTgMessage({ id: 1, chat: { id: -100999, displayName: 'Other' } }));
    expect(received).toHaveLength(0);

    // Push a message for -100111 (subscribed).
    mockClient.pushMessage(makeTgMessage({ id: 2, chat: { id: -100111, displayName: 'Mine' } }));
    expect(received).toHaveLength(1);
  });

  it('subscribe with empty channelIds delivers all messages', async () => {
    const mockClient = new MockMtcuteClient();
    const collector = makeMtcuteCollector({
      burnerId: 'test-burner',
      transport: { mode: 'direct' },
      harvestedAt: () => '2026-01-01T00:00:00Z',
      _inject: { createClient: () => mockClient },
    });
    await collector.connect();

    const received: HarvestedItem[] = [];
    collector.subscribe([], (i) => received.push(i));

    mockClient.pushMessage(makeTgMessage({ id: 1 }));
    mockClient.pushMessage(makeTgMessage({ id: 2 }));

    expect(received).toHaveLength(2);
  });

  it('unsubscribe() stops delivery', async () => {
    const mockClient = new MockMtcuteClient();
    const collector = makeMtcuteCollector({
      burnerId: 'test-burner',
      transport: { mode: 'direct' },
      harvestedAt: () => '2026-01-01T00:00:00Z',
      _inject: { createClient: () => mockClient },
    });
    await collector.connect();

    const received: HarvestedItem[] = [];
    const unsub = collector.subscribe([], (i) => received.push(i));

    mockClient.pushMessage(makeTgMessage({ id: 1 }));
    expect(received).toHaveLength(1);

    unsub();

    mockClient.pushMessage(makeTgMessage({ id: 2 }));
    expect(received).toHaveLength(1); // no new delivery after unsub
  });

  it('unsubscribe() is idempotent', async () => {
    const mockClient = new MockMtcuteClient();
    const collector = makeMtcuteCollector({
      burnerId: 'test-burner',
      transport: { mode: 'direct' },
      harvestedAt: () => '2026-01-01T00:00:00Z',
      _inject: { createClient: () => mockClient },
    });
    await collector.connect();

    const unsub = collector.subscribe([], vi.fn());
    unsub();
    expect(() => unsub()).not.toThrow();
  });

  it('multiple subscribers each receive messages independently', async () => {
    const mockClient = new MockMtcuteClient();
    const collector = makeMtcuteCollector({
      burnerId: 'test-burner',
      transport: { mode: 'direct' },
      harvestedAt: () => '2026-01-01T00:00:00Z',
      _inject: { createClient: () => mockClient },
    });
    await collector.connect();

    const a: HarvestedItem[] = [];
    const b: HarvestedItem[] = [];
    collector.subscribe([], (i) => a.push(i));
    collector.subscribe([], (i) => b.push(i));

    mockClient.pushMessage(makeTgMessage({ id: 99 }));

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it('subscribe() before connect() throws a descriptive error', async () => {
    const mockClient = new MockMtcuteClient();
    const collector = makeMtcuteCollector({
      burnerId: 'test-burner',
      transport: { mode: 'direct' },
      harvestedAt: () => '',
      _inject: { createClient: () => mockClient },
    });

    expect(() => collector.subscribe([], vi.fn())).toThrow(
      'connect() must be called before subscribe()',
    );
  });
});

// ---------------------------------------------------------------------------
// burnerProxyConfig — Tor credentials (exercised via tor-identity directly)
// ---------------------------------------------------------------------------

describe('burnerProxyConfig — Tor credentials (tor bootstrapped)', () => {
  beforeEach(() => {
    setBgTor(makeMockTor(true, 9999));
  });

  afterEach(() => {
    _resetBgTorForTest();
  });

  it('proxy config has version:5 and the correct host for the given burnerId', () => {
    const burnerId = 'test-burner-proxy';
    const proxy = burnerProxyConfig(burnerId);
    expect(proxy.version).toStrictEqual(5);
    expect(proxy.host).toBe('127.0.0.1');
    expect(proxy.port).toBe(9999);
  });

  it('proxy config carries creds from deriveBurnerCredentials for the burnerId', () => {
    const burnerId = 'test-burner-creds';
    const proxy = burnerProxyConfig(burnerId);
    const { user, pass } = deriveBurnerCredentials(burnerId);
    expect(proxy.user).toBe(user);
    expect(proxy.password).toBe(pass);
  });

  it('proxy config has distinct creds for distinct burnerIds (IsolateSOCKSAuth isolation)', () => {
    const cfg1 = burnerProxyConfig('burner-alpha-collector');
    const cfg2 = burnerProxyConfig('burner-beta-collector');
    expect(cfg1.user).not.toBe(cfg2.user);
    expect(cfg1.password).not.toBe(cfg2.password);
    // Both still share the same loopback SOCKS port.
    expect(cfg1.port).toBe(9999);
    expect(cfg2.port).toBe(9999);
  });
});
