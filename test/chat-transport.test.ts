import { describe, it, expect } from 'vitest';
import {
  createPipe,
  InMemoryNetwork,
  InMemoryTransport,
  TransportError,
  type ChatStream
} from '../src/main/chat/transport';

// In-memory streams deliver via queueMicrotask; flush the microtask queue between act + assert.
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function collect(stream: ChatStream): Uint8Array[] {
  const got: Uint8Array[] = [];
  stream.onData((d) => got.push(d));
  return got;
}

describe('chat transport — in-memory pipe', () => {
  it('delivers bytes in both directions', async () => {
    const [a, b] = createPipe();
    const atB = collect(b);
    const atA = collect(a);
    a.send(Uint8Array.from([1, 2, 3]));
    b.send(Uint8Array.from([9, 8]));
    await flush();
    expect(atB.map((u) => Array.from(u))).toEqual([[1, 2, 3]]);
    expect(atA.map((u) => Array.from(u))).toEqual([[9, 8]]);
  });

  it('copies the buffer so the caller can reuse it', async () => {
    const [a, b] = createPipe();
    const atB = collect(b);
    const buf = Uint8Array.from([1, 2, 3]);
    a.send(buf);
    buf[0] = 99; // mutate after send
    await flush();
    expect(Array.from(atB[0])).toEqual([1, 2, 3]); // delivered the pre-mutation snapshot
  });

  it('propagates close to the peer and fires onClose once', async () => {
    const [a, b] = createPipe();
    let aClosed = 0;
    let bClosed = 0;
    a.onClose(() => (aClosed += 1));
    b.onClose(() => (bClosed += 1));
    a.close();
    await flush();
    expect(a.closed).toBe(true);
    expect(b.closed).toBe(true);
    expect(aClosed).toBe(1);
    expect(bClosed).toBe(1);
    a.close(); // idempotent
    expect(aClosed).toBe(1);
  });

  it('send after close is a no-op (no throw, no delivery)', async () => {
    const [a, b] = createPipe();
    const atB = collect(b);
    a.close();
    await flush();
    expect(() => a.send(Uint8Array.from([1]))).not.toThrow();
    await flush();
    expect(atB).toHaveLength(0);
  });
});

describe('chat transport — InMemoryNetwork + InMemoryTransport', () => {
  it('dial reaches the target node\'s onConnection and both ends exchange bytes', async () => {
    const net = new InMemoryNetwork();
    const tA = new InMemoryTransport(net, 'aaaa.onion');
    const tB = new InMemoryTransport(net, 'bbbb.onion');

    let inbound: ChatStream | null = null;
    tB.onConnection((s) => (inbound = s));
    await tB.start();
    tA.onConnection(() => {});
    await tA.start();

    const dialed = await tA.dial('bbbb.onion');
    await flush();
    expect(inbound).not.toBeNull();

    const atListener = collect(inbound as unknown as ChatStream);
    const atDialer = collect(dialed);
    dialed.send(Uint8Array.from([7]));
    (inbound as unknown as ChatStream).send(Uint8Array.from([4, 2]));
    await flush();
    expect(atListener.map((u) => Array.from(u))).toEqual([[7]]);
    expect(atDialer.map((u) => Array.from(u))).toEqual([[4, 2]]);
  });

  it('reports onionAddress only once started', async () => {
    const net = new InMemoryNetwork();
    const t = new InMemoryTransport(net, 'cccc.onion');
    expect(t.onionAddress()).toBeNull();
    t.onConnection(() => {});
    await t.start();
    expect(t.onionAddress()).toBe('cccc.onion');
    await t.stop();
    expect(t.onionAddress()).toBeNull();
  });

  it('rejects dialing an unknown / unstarted onion and dialing before start', async () => {
    const net = new InMemoryNetwork();
    const t = new InMemoryTransport(net, 'dddd.onion');
    await expect(t.dial('nowhere.onion')).rejects.toThrow(TransportError); // not started
    t.onConnection(() => {});
    await t.start();
    await expect(t.dial('nowhere.onion')).rejects.toThrow(TransportError); // no such node
  });

  it('requires onConnection before start', async () => {
    const net = new InMemoryNetwork();
    const t = new InMemoryTransport(net, 'eeee.onion');
    await expect(t.start()).rejects.toThrow(TransportError);
  });
});
