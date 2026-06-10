import { describe, it, expect } from 'vitest';
import { buildBgconnTorrc } from '../src/main/bgconn/torrc';

describe('buildBgconnTorrc', () => {
  it('isolates circuits and pins a loopback SOCKS/control with separate data dir', () => {
    const t = buildBgconnTorrc({ socksPort: 9250, controlPort: 9251, dataDir: '/d' });
    expect(t).toMatch(/SocksPort 127\.0\.0\.1:9250 IsolateSOCKSAuth IsolateDestAddr/);
    expect(t).toMatch(/ControlPort 127\.0\.0\.1:9251/);
    expect(t).toMatch(/DataDirectory \/d/);
    expect(t).toMatch(/SocksPolicy accept \*/);
  });
});
