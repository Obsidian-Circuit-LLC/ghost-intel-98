import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { BgconnTor } from '../src/main/bgconn/tor';

function fakeProc() {
  const p: any = new EventEmitter();
  p.stdout = new EventEmitter(); p.stderr = new EventEmitter();
  p.kill = vi.fn(() => { p.emit('exit', 0, null); });
  p.killed = false;
  return p;
}

describe('BgconnTor', () => {
  it('starts, becomes bootstrapped on the Tor log line, exposes the socks port, and stops', async () => {
    const proc = fakeProc();
    const spawn = vi.fn(() => proc) as never;
    const tor = new BgconnTor({ torExe: '/tor', dataDir: '/d', socksPort: 9250, controlPort: 9251, spawn,
      writeFile: async () => {} });
    expect(tor.isBootstrapped()).toBe(false);
    const started = tor.start();
    proc.stdout.emit('data', Buffer.from('... Bootstrapped 100% (done): Done\n'));
    await started;
    expect(tor.isBootstrapped()).toBe(true);
    expect(tor.socksPort()).toBe(9250);
    await tor.stop();
    expect(proc.kill).toHaveBeenCalled();
  });
});
