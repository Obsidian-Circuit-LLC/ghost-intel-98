/**
 * Task 5: Collector interface + MockCollector + sealed mtcute adapter.
 *
 * Tests:
 *  1. MockCollector: connect/join/backfill/subscribe/unsubscribe/disconnect.
 *  2. makeMtcuteCollector: connect() rejects with the sealed-seam message when
 *     @mtcute/node is absent (it is always absent in this build). This is true
 *     regardless of transport — Tor resolution moved out of connect() to
 *     resolveTransport() at the egress boundary (handleStartMonitor).
 *  3. burnerProxyConfig carries version:5 and per-burner creds (called directly,
 *     not via collector).
 *
 * Note: The Tor-down behavior for the collector (previously tested as
 * "connect() throws SocmintTorUnavailableError") is no longer valid — transport
 * resolution was moved to resolveTransport() at the egress boundary. Those
 * invariants are now covered by resolveTransport tests in socmint-tor-identity.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setBgTor, _resetBgTorForTest } from '../src/main/bgconn/tor-singleton';
import type { BgconnTor } from '../src/main/bgconn/tor';
import { MockCollector, makeMtcuteCollector } from '../src/main/socmint/collector';
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
// makeMtcuteCollector — sealed seam (Tor bootstrapped)
// ---------------------------------------------------------------------------

describe('makeMtcuteCollector — sealed seam', () => {
  beforeEach(() => {
    setBgTor(makeMockTor(true, 9999));
  });

  afterEach(() => {
    _resetBgTorForTest();
  });

  it('connect() rejects with the sealed-seam error message (direct transport)', async () => {
    const collector = makeMtcuteCollector({
      burnerId: 'test-burner',
      transport: { mode: 'direct' },
      harvestedAt: () => new Date().toISOString(),
    });
    await expect(collector.connect()).rejects.toThrow(
      'SOCMINT: Telegram library not installed — pending operator smoke test + library lock (spec §7)',
    );
  });

  it('connect() rejects with an Error instance (direct transport)', async () => {
    const collector = makeMtcuteCollector({
      burnerId: 'test-burner',
      transport: { mode: 'direct' },
      harvestedAt: () => '',
    });
    await expect(collector.connect()).rejects.toBeInstanceOf(Error);
  });

  it('connect() rejects with the sealed-seam error message (tor transport)', async () => {
    const proxy = burnerProxyConfig('test-burner-tor');
    const collector = makeMtcuteCollector({
      burnerId: 'test-burner-tor',
      transport: { mode: 'tor', proxy },
      harvestedAt: () => '',
    });
    await expect(collector.connect()).rejects.toThrow(
      'SOCMINT: Telegram library not installed — pending operator smoke test + library lock (spec §7)',
    );
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
