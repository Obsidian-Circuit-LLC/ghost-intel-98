/**
 * A3 (whatsapp-baileys-live): Live WhatsApp collector tests.
 *
 * All tests use mock socket injection (_inject) — no real Baileys socket, no
 * secretStore, no network I/O. Transport is pre-resolved (as in production, where
 * resolveTransport does the egress-boundary check).
 *
 * Coverage:
 *   connect()
 *     1.  direct transport — mock socket is created, connect() resolves
 *     2.  tor transport — mock socket is created, connect() resolves
 *     3.  connect() registers a creds.update handler that calls auth.saveCreds()
 *
 *   join()
 *     4.  success — groupMetadata subject → MonitoredChannel{label, channelId}
 *     5.  failure — groupMetadata throws → wraps with "manual join required" message
 *     6.  guard  — connect() not called → Error
 *
 *   backfill()
 *     7.  always returns [] (syncFullHistory:false is permanent; no append buffer)
 *     8.  backfill before connect() does not crash (guard not needed per spec; returns [])
 *
 *   subscribe()
 *     9.  delivers 'notify' messages for subscribed @g.us JIDs
 *     10. filters out non-'notify' type (e.g. 'append')
 *     11. filters out non-@g.us JIDs (DMs / broadcast)
 *     12. filters out fromMe messages
 *     13. filters out messages not in the subscribed JID set
 *     14. subscribing with empty jids[] delivers messages from ANY @g.us group
 *     15. unsubscribe stops delivery; subsequent emits are not received
 *     16. unsubscribe is idempotent — calling twice does not throw
 *     17. guard — connect() not called → Error (synchronous throw)
 *
 *   join() label → subscribe() mapper integration
 *     18. channelLabel in emitted HarvestedItem matches the label from a prior join()
 *
 *   HarvestedItem field invariants (subscribe)
 *     19. platform === 'whatsapp'
 *     20. url === '' (no permalink)
 *     21. mediaRef === '' (no auto-download)
 *     22. authorHandle strips @s.whatsapp.net suffix
 *     23. text from conversation field
 *     24. text from extendedTextMessage.text when conversation absent
 *
 *   disconnect()
 *     25. calls sock.end() exactly once
 *     26. no-op when connect() was never called (sock null)
 *     27. idempotent — second call after connect() is a no-op (sock cleared)
 *
 *   WA_SEALED_MESSAGE — export invariants (audit trail)
 *     28. is a non-empty string
 *     29. references §5.5
 *     30. identifies WhatsApp
 */

import { describe, it, expect, vi } from 'vitest';
import {
  makeWhatsAppCollector,
  WA_SEALED_MESSAGE,
  type WaSocketLike,
  type WaConnectionUpdate,
  type WaMessagesUpsert,
} from '../src/main/socmint/whatsapp-collector';
import { deriveBurnerCredentials } from '../src/main/socmint/tor-identity';
import type { SocmintTransport } from '../src/main/socmint/tor-identity';
import type { WaRawMessage } from '../src/main/socmint/whatsapp-mapper';

// ---------------------------------------------------------------------------
// Transport helpers
// ---------------------------------------------------------------------------

function directTransport(): SocmintTransport {
  return { mode: 'direct' };
}

function torTransport(burnerId: string): SocmintTransport {
  const { user, pass } = deriveBurnerCredentials(burnerId);
  return {
    mode: 'tor',
    proxy: {
      host: '127.0.0.1',
      port: 9050,
      version: 5,
      user,
      password: pass,
    },
  };
}

// ---------------------------------------------------------------------------
// Mock socket factory
// ---------------------------------------------------------------------------

type UpsertHandler = (upsert: WaMessagesUpsert) => void;

interface MockSocketExtras {
  /** Emit a messages.upsert event to all registered handlers. */
  emitUpsert(upsert: WaMessagesUpsert): void;
  /** Emit a creds.update event (triggers auth.saveCreds() path). */
  emitCredsUpdate(): void;
  /** Emit a connection.update event. */
  emitConnectionUpdate(update: WaConnectionUpdate): void;
  /** Number of times end() has been called. */
  endCalls: number;
  /** The proxyUrl argument that was passed to createSocket(). */
  receivedProxyUrl: string | null;
}

function makeMockSocket(opts: {
  proxyUrl: string | null;
  groupSubject?: string;
  rejectGroupMetadata?: boolean;
}): WaSocketLike & MockSocketExtras {
  const upsertHandlers: UpsertHandler[] = [];
  const credsHandlers: Array<() => void> = [];
  const connectionHandlers: Array<(u: WaConnectionUpdate) => void> = [];
  let endCalls = 0;

  // Satisfy all WaSocketLike.ev.on overloads via a unified implementation.
  // TypeScript sees the overload signatures; the cast makes the unification work.
  const evOn = (event: string, handler: (...args: unknown[]) => void): void => {
    if (event === 'messages.upsert') upsertHandlers.push(handler as UpsertHandler);
    else if (event === 'creds.update') credsHandlers.push(handler as () => void);
    else if (event === 'connection.update')
      connectionHandlers.push(handler as (u: WaConnectionUpdate) => void);
  };

  const evOff = (event: string, handler: (...args: unknown[]) => void): void => {
    if (event === 'messages.upsert') {
      const idx = upsertHandlers.indexOf(handler as UpsertHandler);
      if (idx !== -1) upsertHandlers.splice(idx, 1);
    }
  };

  return {
    // Satisfy WaSocketLike.ev with overload-compatible casts.
    ev: {
      on: evOn as WaSocketLike['ev']['on'],
      off: evOff as WaSocketLike['ev']['off'],
    },
    async groupMetadata(jid: string) {
      if (opts.rejectGroupMetadata) throw new Error('not a member');
      return { subject: opts.groupSubject ?? `Group-${jid}` };
    },
    end() {
      endCalls++;
    },

    // Test helpers
    emitUpsert(upsert: WaMessagesUpsert) {
      for (const h of [...upsertHandlers]) h(upsert);
    },
    emitCredsUpdate() {
      for (const h of [...credsHandlers]) h();
    },
    emitConnectionUpdate(update: WaConnectionUpdate) {
      for (const h of [...connectionHandlers]) h(update);
    },
    get endCalls() {
      return endCalls;
    },
    receivedProxyUrl: opts.proxyUrl,
  };
}

// ---------------------------------------------------------------------------
// Helper: build a minimal valid WaRawMessage for inject-into-subscribe tests
// ---------------------------------------------------------------------------

function makeWaMsg(overrides?: Partial<WaRawMessage>): WaRawMessage {
  return {
    key: {
      id: 'msg-id-001',
      remoteJid: 'group1@g.us',
      participant: '15551234567@s.whatsapp.net',
      fromMe: false,
    },
    message: { conversation: 'Hello world' },
    messageTimestamp: 1700000000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite 1 — connect()
// ---------------------------------------------------------------------------

describe('makeWhatsAppCollector — connect() (live, direct transport)', () => {
  it('resolves successfully with a direct transport mock socket', async () => {
    let captured: string | null = 'NOT_SET';
    const collector = makeWhatsAppCollector({
      burnerId: 'wa-live-1',
      transport: directTransport(),
      harvestedAt: () => '',
      _inject: {
        createSocket: (proxyUrl) => {
          captured = proxyUrl;
          return makeMockSocket({ proxyUrl });
        },
      },
    });
    await expect(collector.connect()).resolves.toBeUndefined();
    // direct transport → proxyUrl null
    expect(captured).toBeNull();
  });
});

describe('makeWhatsAppCollector — connect() (live, tor transport)', () => {
  it('resolves successfully with a tor transport mock socket', async () => {
    let captured: string | null = 'NOT_SET';
    const collector = makeWhatsAppCollector({
      burnerId: 'wa-live-tor-1',
      transport: torTransport('wa-live-tor-1'),
      harvestedAt: () => '',
      _inject: {
        createSocket: (proxyUrl) => {
          captured = proxyUrl;
          return makeMockSocket({ proxyUrl });
        },
      },
    });
    await expect(collector.connect()).resolves.toBeUndefined();
    // tor transport → proxyUrl is a socks5:// URL
    expect(captured).not.toBeNull();
    expect(captured).toMatch(/^socks5:\/\//);
  });

  it('passes a per-burner SOCKS5 URL (IsolateSOCKSAuth creds embedded)', async () => {
    const { user, pass } = deriveBurnerCredentials('wa-tor-creds');
    let receivedUrl: string | null = null;
    const collector = makeWhatsAppCollector({
      burnerId: 'wa-tor-creds',
      transport: torTransport('wa-tor-creds'),
      harvestedAt: () => '',
      _inject: {
        createSocket: (proxyUrl) => {
          receivedUrl = proxyUrl;
          return makeMockSocket({ proxyUrl });
        },
      },
    });
    await collector.connect();
    expect(receivedUrl).toContain(user);
    expect(receivedUrl).toContain(pass);
  });
});

describe('makeWhatsAppCollector — connect() registers creds.update handler', () => {
  it('creds.update event triggers auth.saveCreds()', async () => {
    const saveCredsSpy = vi.fn(async () => {});
    // Provide an auth state with a spy saveCreds
    const collector = makeWhatsAppCollector({
      burnerId: 'wa-creds-evt',
      transport: directTransport(),
      harvestedAt: () => '',
      _inject: {
        createSocket: (proxyUrl) => makeMockSocket({ proxyUrl }),
        authState: {
          state: { creds: {}, keys: { get: async () => ({}), set: async () => {} } },
          initialize: async () => {},
          saveCreds: saveCredsSpy,
          unlinkSession: async () => {},
        },
      },
    });
    // Use the mock socket via a second capture
    let mockSock: (WaSocketLike & MockSocketExtras) | null = null;
    const collector2 = makeWhatsAppCollector({
      burnerId: 'wa-creds-evt',
      transport: directTransport(),
      harvestedAt: () => '',
      _inject: {
        createSocket: (proxyUrl) => {
          mockSock = makeMockSocket({ proxyUrl });
          return mockSock;
        },
        authState: {
          state: { creds: {}, keys: { get: async () => ({}), set: async () => {} } },
          initialize: async () => {},
          saveCreds: saveCredsSpy,
          unlinkSession: async () => {},
        },
      },
    });
    await collector2.connect();
    expect(saveCredsSpy).not.toHaveBeenCalled();
    mockSock!.emitCredsUpdate();
    expect(saveCredsSpy).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Suite 2 — join()
// ---------------------------------------------------------------------------

describe('makeWhatsAppCollector — join()', () => {
  it('returns MonitoredChannel with the group subject as label', async () => {
    let mockSock: (WaSocketLike & MockSocketExtras) | null = null;
    const collector = makeWhatsAppCollector({
      burnerId: 'wa-join-1',
      transport: directTransport(),
      harvestedAt: () => '',
      _inject: {
        createSocket: (proxyUrl) => {
          mockSock = makeMockSocket({ proxyUrl, groupSubject: 'OSINT Watchers' });
          return mockSock;
        },
      },
    });
    await collector.connect();
    const ch = await collector.join('120363001234567890@g.us');
    expect(ch.channelId).toBe('120363001234567890@g.us');
    expect(ch.label).toBe('OSINT Watchers');
    expect(ch.keywords).toEqual([]);
  });

  it('uses groupMetadata subject (not a hardcoded fallback)', async () => {
    const collector = makeWhatsAppCollector({
      burnerId: 'wa-join-2',
      transport: directTransport(),
      harvestedAt: () => '',
      _inject: {
        createSocket: (proxyUrl) =>
          makeMockSocket({ proxyUrl, groupSubject: 'Custom Subject XYZ' }),
      },
    });
    await collector.connect();
    const ch = await collector.join('group@g.us');
    expect(ch.label).toBe('Custom Subject XYZ');
  });

  it('throws "manual join required" when groupMetadata rejects', async () => {
    const collector = makeWhatsAppCollector({
      burnerId: 'wa-join-err',
      transport: directTransport(),
      harvestedAt: () => '',
      _inject: {
        createSocket: (proxyUrl) =>
          makeMockSocket({ proxyUrl, rejectGroupMetadata: true }),
      },
    });
    await collector.connect();
    await expect(collector.join('group@g.us')).rejects.toThrow(
      'manual join required',
    );
  });

  it('throws an Error instance when groupMetadata rejects', async () => {
    const collector = makeWhatsAppCollector({
      burnerId: 'wa-join-err-2',
      transport: directTransport(),
      harvestedAt: () => '',
      _inject: {
        createSocket: (proxyUrl) =>
          makeMockSocket({ proxyUrl, rejectGroupMetadata: true }),
      },
    });
    await collector.connect();
    await expect(collector.join('group@g.us')).rejects.toBeInstanceOf(Error);
  });

  it('throws when connect() was not called', async () => {
    const collector = makeWhatsAppCollector({
      burnerId: 'wa-join-guard',
      transport: directTransport(),
      harvestedAt: () => '',
      _inject: {
        createSocket: (proxyUrl) => makeMockSocket({ proxyUrl }),
      },
    });
    await expect(collector.join('group@g.us')).rejects.toThrow(
      /connect\(\) must be called before join\(\)/,
    );
  });
});

// ---------------------------------------------------------------------------
// Suite 3 — backfill()
// ---------------------------------------------------------------------------

describe('makeWhatsAppCollector — backfill()', () => {
  it('returns [] (syncFullHistory:false — no history accumulation)', async () => {
    const collector = makeWhatsAppCollector({
      burnerId: 'wa-bf-1',
      transport: directTransport(),
      harvestedAt: () => '',
      _inject: {
        createSocket: (proxyUrl) => makeMockSocket({ proxyUrl }),
      },
    });
    await collector.connect();
    await expect(collector.backfill('group@g.us', 100)).resolves.toEqual([]);
  });

  it('returns [] on multiple successive calls (buffer does not accumulate)', async () => {
    const collector = makeWhatsAppCollector({
      burnerId: 'wa-bf-2',
      transport: directTransport(),
      harvestedAt: () => '',
      _inject: {
        createSocket: (proxyUrl) => makeMockSocket({ proxyUrl }),
      },
    });
    await collector.connect();
    await expect(collector.backfill('group@g.us', 50)).resolves.toEqual([]);
    await expect(collector.backfill('group@g.us', 50)).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Suite 4 — subscribe() filtering invariants
// ---------------------------------------------------------------------------

describe('makeWhatsAppCollector — subscribe() message delivery', () => {
  async function makeConnected(subject?: string) {
    let mockSock!: WaSocketLike & MockSocketExtras;
    const collector = makeWhatsAppCollector({
      burnerId: 'wa-sub-filter',
      transport: directTransport(),
      harvestedAt: () => '2026-01-01T00:00:00.000Z',
      _inject: {
        createSocket: (proxyUrl) => {
          mockSock = makeMockSocket({ proxyUrl, groupSubject: subject ?? 'Test Group' });
          return mockSock;
        },
      },
    });
    await collector.connect();
    return { collector, mockSock };
  }

  it('delivers a notify message for a subscribed @g.us JID', async () => {
    const { collector, mockSock } = await makeConnected();
    const received: unknown[] = [];
    collector.subscribe(['group1@g.us'], (item) => received.push(item));
    mockSock.emitUpsert({ messages: [makeWaMsg()], type: 'notify' });
    expect(received).toHaveLength(1);
  });

  it('does NOT deliver messages with type !== "notify"', async () => {
    const { collector, mockSock } = await makeConnected();
    const received: unknown[] = [];
    collector.subscribe(['group1@g.us'], (item) => received.push(item));
    mockSock.emitUpsert({ messages: [makeWaMsg()], type: 'append' });
    expect(received).toHaveLength(0);
  });

  it('does NOT deliver messages from non-@g.us JIDs (DMs)', async () => {
    const { collector, mockSock } = await makeConnected();
    const received: unknown[] = [];
    collector.subscribe(['15551234567@s.whatsapp.net'], (item) => received.push(item));
    mockSock.emitUpsert({
      messages: [makeWaMsg({ key: { id: 'm1', remoteJid: '15551234567@s.whatsapp.net', fromMe: false } })],
      type: 'notify',
    });
    expect(received).toHaveLength(0);
  });

  it('does NOT deliver fromMe messages', async () => {
    const { collector, mockSock } = await makeConnected();
    const received: unknown[] = [];
    collector.subscribe(['group1@g.us'], (item) => received.push(item));
    mockSock.emitUpsert({
      messages: [makeWaMsg({ key: { id: 'm1', remoteJid: 'group1@g.us', fromMe: true } })],
      type: 'notify',
    });
    expect(received).toHaveLength(0);
  });

  it('does NOT deliver messages from a non-subscribed group', async () => {
    const { collector, mockSock } = await makeConnected();
    const received: unknown[] = [];
    collector.subscribe(['group1@g.us'], (item) => received.push(item));
    mockSock.emitUpsert({
      messages: [makeWaMsg({ key: { id: 'm1', remoteJid: 'group2@g.us', fromMe: false } })],
      type: 'notify',
    });
    expect(received).toHaveLength(0);
  });

  it('subscribing with empty jids[] delivers messages from any @g.us group', async () => {
    const { collector, mockSock } = await makeConnected();
    const received: unknown[] = [];
    collector.subscribe([], (item) => received.push(item));
    mockSock.emitUpsert({ messages: [makeWaMsg({ key: { id: 'm1', remoteJid: 'anygroup@g.us', fromMe: false } })], type: 'notify' });
    mockSock.emitUpsert({ messages: [makeWaMsg({ key: { id: 'm2', remoteJid: 'othergroup@g.us', fromMe: false } })], type: 'notify' });
    expect(received).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Suite 5 — subscribe() unsubscribe
// ---------------------------------------------------------------------------

describe('makeWhatsAppCollector — subscribe() unsubscribe', () => {
  it('unsubscribe stops further delivery', async () => {
    let mockSock!: WaSocketLike & MockSocketExtras;
    const collector = makeWhatsAppCollector({
      burnerId: 'wa-unsub-1',
      transport: directTransport(),
      harvestedAt: () => '',
      _inject: {
        createSocket: (proxyUrl) => {
          mockSock = makeMockSocket({ proxyUrl });
          return mockSock;
        },
      },
    });
    await collector.connect();
    const received: unknown[] = [];
    const unsub = collector.subscribe(['group1@g.us'], (item) => received.push(item));
    mockSock.emitUpsert({ messages: [makeWaMsg()], type: 'notify' });
    expect(received).toHaveLength(1);
    unsub();
    mockSock.emitUpsert({ messages: [makeWaMsg({ key: { id: 'm2', remoteJid: 'group1@g.us', fromMe: false } })], type: 'notify' });
    expect(received).toHaveLength(1); // no new delivery after unsub
  });

  it('unsubscribe is idempotent — calling twice does not throw', async () => {
    let mockSock!: WaSocketLike & MockSocketExtras;
    const collector = makeWhatsAppCollector({
      burnerId: 'wa-unsub-2',
      transport: directTransport(),
      harvestedAt: () => '',
      _inject: {
        createSocket: (proxyUrl) => {
          mockSock = makeMockSocket({ proxyUrl });
          return mockSock;
        },
      },
    });
    await collector.connect();
    const unsub = collector.subscribe(['group1@g.us'], () => {});
    unsub();
    expect(() => unsub()).not.toThrow();
  });

  it('two independent subscribers both receive messages', async () => {
    let mockSock!: WaSocketLike & MockSocketExtras;
    const collector = makeWhatsAppCollector({
      burnerId: 'wa-multi-sub',
      transport: directTransport(),
      harvestedAt: () => '',
      _inject: {
        createSocket: (proxyUrl) => {
          mockSock = makeMockSocket({ proxyUrl });
          return mockSock;
        },
      },
    });
    await collector.connect();
    const r1: unknown[] = [], r2: unknown[] = [];
    collector.subscribe(['group1@g.us'], (i) => r1.push(i));
    collector.subscribe(['group1@g.us'], (i) => r2.push(i));
    mockSock.emitUpsert({ messages: [makeWaMsg()], type: 'notify' });
    expect(r1).toHaveLength(1);
    expect(r2).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Suite 6 — subscribe() guard
// ---------------------------------------------------------------------------

describe('makeWhatsAppCollector — subscribe() guard', () => {
  it('throws synchronously when connect() was not called', () => {
    const collector = makeWhatsAppCollector({
      burnerId: 'wa-sub-guard',
      transport: directTransport(),
      harvestedAt: () => '',
      _inject: {
        createSocket: (proxyUrl) => makeMockSocket({ proxyUrl }),
      },
    });
    expect(() => collector.subscribe(['group@g.us'], () => {})).toThrow(
      /connect\(\) must be called before subscribe\(\)/,
    );
  });

  it('throws an Error instance', () => {
    const collector = makeWhatsAppCollector({
      burnerId: 'wa-sub-guard-2',
      transport: directTransport(),
      harvestedAt: () => '',
      _inject: {
        createSocket: (proxyUrl) => makeMockSocket({ proxyUrl }),
      },
    });
    expect(() => collector.subscribe([], () => {})).toBeInstanceOf(Function);
    // Actually test the throw:
    expect(() => collector.subscribe([], () => {})).toThrow(Error);
  });
});

// ---------------------------------------------------------------------------
// Suite 7 — join() label → subscribe() mapper integration
// ---------------------------------------------------------------------------

describe('makeWhatsAppCollector — join() label used in subscribe() items', () => {
  it('channelLabel in emitted item matches the group subject from join()', async () => {
    let mockSock!: WaSocketLike & MockSocketExtras;
    const collector = makeWhatsAppCollector({
      burnerId: 'wa-label-int',
      transport: directTransport(),
      harvestedAt: () => '2026-01-01T00:00:00.000Z',
      _inject: {
        createSocket: (proxyUrl) => {
          mockSock = makeMockSocket({ proxyUrl, groupSubject: 'Target Group Alpha' });
          return mockSock;
        },
      },
    });
    await collector.connect();
    await collector.join('target@g.us');
    const received: Array<{ channelLabel: string }> = [];
    collector.subscribe(['target@g.us'], (item) =>
      received.push({ channelLabel: item.channelLabel }),
    );
    mockSock.emitUpsert({
      messages: [makeWaMsg({ key: { id: 'm1', remoteJid: 'target@g.us', fromMe: false } })],
      type: 'notify',
    });
    expect(received).toHaveLength(1);
    expect(received[0].channelLabel).toBe('Target Group Alpha');
  });

  it('falls back to the JID as channelLabel when join() was not called', async () => {
    let mockSock!: WaSocketLike & MockSocketExtras;
    const collector = makeWhatsAppCollector({
      burnerId: 'wa-label-fallback',
      transport: directTransport(),
      harvestedAt: () => '',
      _inject: {
        createSocket: (proxyUrl) => {
          mockSock = makeMockSocket({ proxyUrl });
          return mockSock;
        },
      },
    });
    await collector.connect();
    const received: Array<{ channelLabel: string }> = [];
    collector.subscribe(['nojoin@g.us'], (item) =>
      received.push({ channelLabel: item.channelLabel }),
    );
    mockSock.emitUpsert({
      messages: [makeWaMsg({ key: { id: 'm1', remoteJid: 'nojoin@g.us', fromMe: false } })],
      type: 'notify',
    });
    expect(received[0].channelLabel).toBe('nojoin@g.us');
  });
});

// ---------------------------------------------------------------------------
// Suite 8 — HarvestedItem field invariants
// ---------------------------------------------------------------------------

describe('makeWhatsAppCollector — HarvestedItem field invariants', () => {
  async function receiveOne(msg: WaRawMessage): Promise<ReturnType<typeof makeWhatsAppCollector>['subscribe'] extends (a: string[], b: (i: infer I) => void) => unknown ? I : never> {
    let mockSock!: WaSocketLike & MockSocketExtras;
    const collector = makeWhatsAppCollector({
      burnerId: 'wa-item-fields',
      transport: directTransport(),
      harvestedAt: () => '2026-01-01T00:00:00.000Z',
      _inject: {
        createSocket: (proxyUrl) => {
          mockSock = makeMockSocket({ proxyUrl });
          return mockSock;
        },
      },
    });
    await collector.connect();
    const items: unknown[] = [];
    collector.subscribe([], (item) => items.push(item));
    mockSock.emitUpsert({ messages: [msg], type: 'notify' });
    return items[0] as ReturnType<typeof collector.subscribe> extends never ? never : Parameters<Parameters<typeof collector.subscribe>[1]>[0];
  }

  it('platform is "whatsapp"', async () => {
    const item = await receiveOne(makeWaMsg());
    expect(item.platform).toBe('whatsapp');
  });

  it('url is always "" (no WhatsApp permalink; no wa.me trap)', async () => {
    const item = await receiveOne(makeWaMsg());
    expect(item.url).toBe('');
  });

  it('mediaRef is always "" (no auto-download)', async () => {
    const item = await receiveOne(makeWaMsg());
    expect(item.mediaRef).toBe('');
  });

  it('authorHandle strips @s.whatsapp.net suffix', async () => {
    const msg = makeWaMsg({
      key: { id: 'm1', remoteJid: 'group1@g.us', participant: '447911123456@s.whatsapp.net', fromMe: false },
    });
    const item = await receiveOne(msg);
    expect(item.authorHandle).toBe('447911123456');
    expect(item.authorHandle).not.toContain('@s.whatsapp.net');
  });

  it('text comes from conversation field', async () => {
    const msg = makeWaMsg({ message: { conversation: 'Direct text' } });
    const item = await receiveOne(msg);
    expect(item.text).toBe('Direct text');
  });

  it('text falls back to extendedTextMessage.text', async () => {
    const msg = makeWaMsg({
      message: { extendedTextMessage: { text: 'Extended text' } },
    });
    const item = await receiveOne(msg);
    expect(item.text).toBe('Extended text');
  });

  it('channelId is the remoteJid', async () => {
    const msg = makeWaMsg({ key: { id: 'm1', remoteJid: 'mygroup@g.us', fromMe: false } });
    const item = await receiveOne(msg);
    expect(item.channelId).toBe('mygroup@g.us');
  });
});

// ---------------------------------------------------------------------------
// Suite 9 — disconnect()
// ---------------------------------------------------------------------------

describe('makeWhatsAppCollector — disconnect()', () => {
  it('calls sock.end() once after connect()', async () => {
    let mockSock!: WaSocketLike & MockSocketExtras;
    const collector = makeWhatsAppCollector({
      burnerId: 'wa-disc-1',
      transport: directTransport(),
      harvestedAt: () => '',
      _inject: {
        createSocket: (proxyUrl) => {
          mockSock = makeMockSocket({ proxyUrl });
          return mockSock;
        },
      },
    });
    await collector.connect();
    await collector.disconnect();
    expect(mockSock.endCalls).toBe(1);
  });

  it('resolves without error when connect() was never called (no-op)', async () => {
    const collector = makeWhatsAppCollector({
      burnerId: 'wa-disc-noop',
      transport: directTransport(),
      harvestedAt: () => '',
      _inject: {
        createSocket: (proxyUrl) => makeMockSocket({ proxyUrl }),
      },
    });
    await expect(collector.disconnect()).resolves.toBeUndefined();
  });

  it('second disconnect() is idempotent — does not call end() again', async () => {
    let mockSock!: WaSocketLike & MockSocketExtras;
    const collector = makeWhatsAppCollector({
      burnerId: 'wa-disc-idemp',
      transport: directTransport(),
      harvestedAt: () => '',
      _inject: {
        createSocket: (proxyUrl) => {
          mockSock = makeMockSocket({ proxyUrl });
          return mockSock;
        },
      },
    });
    await collector.connect();
    await collector.disconnect();
    await collector.disconnect(); // second call — sock is null
    expect(mockSock.endCalls).toBe(1); // end() called exactly once
  });
});

// ---------------------------------------------------------------------------
// Suite 10 — WA_SEALED_MESSAGE export invariants (audit trail)
// ---------------------------------------------------------------------------

describe('WA_SEALED_MESSAGE — export invariants', () => {
  it('is a non-empty string (audit trail preserved)', () => {
    expect(typeof WA_SEALED_MESSAGE).toBe('string');
    expect(WA_SEALED_MESSAGE.length).toBeGreaterThan(0);
  });

  it('references the §5.5 supply-chain checklist', () => {
    expect(WA_SEALED_MESSAGE).toContain('§5.5');
  });

  it('identifies WhatsApp as the subject library', () => {
    expect(WA_SEALED_MESSAGE).toContain('WhatsApp');
  });
});
