import { describe, it, expect } from 'vitest';
import { newSocksCreds, laneFor } from '../src/main/bgconn/lane';

describe('BackgroundLane', () => {
  it('generates distinct SOCKS creds per call (distinct circuits)', () => {
    const a = newSocksCreds(); const b = newSocksCreds();
    expect(a.username).not.toBe(b.username);
    expect(a.password).not.toBe(b.password);
    expect(a.username).toMatch(/^[0-9a-f]{16,}$/);
  });
  it('laneFor(tor) returns the isolated SOCKS endpoint; laneFor(direct) returns direct', () => {
    const creds = newSocksCreds();
    const tor = laneFor({ routing: 'tor', socksHost: '127.0.0.1', socksPort: 9250, creds });
    expect(tor).toEqual({ direct: false, socks: { host: '127.0.0.1', port: 9250, username: creds.username, password: creds.password } });
    const direct = laneFor({ routing: 'direct' });
    expect(direct).toEqual({ direct: true });
  });
});
