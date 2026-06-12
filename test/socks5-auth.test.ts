// test/socks5-auth.test.ts
import { describe, it, expect } from 'vitest';
import { buildGreeting, parseMethodSelection, buildUserPassAuth, parseUserPassReply } from '../src/main/chat/socks5';

describe('SOCKS5 RFC 1929 username/password', () => {
  it('buildGreeting() with auth offers both no-auth (0x00) and userpass (0x02)', () => {
    expect(Array.from(buildGreeting({ auth: true }))).toEqual([0x05, 0x02, 0x00, 0x02]);
    expect(Array.from(buildGreeting())).toEqual([0x05, 0x01, 0x00]); // default unchanged (chat)
  });
  it('parseMethodSelection reports the selected method', () => {
    expect(parseMethodSelection(Uint8Array.of(0x05, 0x00))).toEqual({ ok: true, method: 0x00 });
    expect(parseMethodSelection(Uint8Array.of(0x05, 0x02))).toEqual({ ok: true, method: 0x02 });
    expect(parseMethodSelection(Uint8Array.of(0x05, 0xff))).toEqual({ ok: false, method: 0xff });
    expect(parseMethodSelection(Uint8Array.of(0x05))).toBeNull();
  });
  it('buildUserPassAuth encodes VER=1, ulen, user, plen, pass', () => {
    expect(Array.from(buildUserPassAuth('ab', 'cde'))).toEqual([0x01, 2, 0x61, 0x62, 3, 0x63, 0x64, 0x65]);
  });
  it('rejects over-long credentials', () => {
    expect(() => buildUserPassAuth('x'.repeat(256), 'p')).toThrow();
  });
  it('parseUserPassReply: status 0 ok, non-zero not ok, <2 bytes null', () => {
    expect(parseUserPassReply(Uint8Array.of(0x01, 0x00))).toEqual({ ok: true });
    expect(parseUserPassReply(Uint8Array.of(0x01, 0x01))).toEqual({ ok: false });
    expect(parseUserPassReply(Uint8Array.of(0x01))).toBeNull();
  });
});
