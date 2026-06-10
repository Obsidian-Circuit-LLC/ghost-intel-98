import { describe, it, expect, vi } from 'vitest';
import { createServer } from 'node:net';
import { resolveAll, dialPinned } from '../src/main/offensive/pin-dial';

describe('pin-dial', () => {
  it('resolveAll returns all addresses from the resolver', async () => {
    const fake = vi.fn(async () => [{ address: '10.0.0.1', family: 4 }, { address: '2001:db8::1', family: 6 }]);
    expect(await resolveAll('host', fake as never)).toEqual(['10.0.0.1', '2001:db8::1']);
  });
  it('dialPinned connects to the exact IP/port', async () => {
    const srv = createServer();
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const port = (srv.address() as { port: number }).port;
    const connected = new Promise<void>((r) => srv.once('connection', () => r()));
    const sock = await dialPinned('127.0.0.1', port);
    await connected;
    sock.destroy(); srv.close();
    expect(true).toBe(true);
  });
});
