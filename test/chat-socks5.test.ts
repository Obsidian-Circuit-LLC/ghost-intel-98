import { describe, it, expect } from 'vitest';
import {
  buildGreeting,
  parseMethodSelection,
  buildConnectDomain,
  parseConnectReply,
  socksReplyMessage,
  Socks5Error
} from '../src/main/chat/socks5';

const ONION = `${'a'.repeat(56)}.onion`;

describe('SOCKS5 client codec', () => {
  it('builds a no-auth greeting', () => {
    expect(Array.from(buildGreeting())).toEqual([0x05, 1, 0x00]);
  });

  it('parses method selection (waits for 2 bytes; ok only for no-auth)', () => {
    expect(parseMethodSelection(Uint8Array.of(0x05))).toBeNull();
    expect(parseMethodSelection(Uint8Array.of(0x05, 0x00))).toEqual({ ok: true });
    expect(parseMethodSelection(Uint8Array.of(0x05, 0xff))).toEqual({ ok: false });
    expect(() => parseMethodSelection(Uint8Array.of(0x04, 0x00))).toThrow(Socks5Error);
  });

  it('builds a CONNECT request to an onion domain', () => {
    const req = buildConnectDomain(ONION, 9001);
    expect(req[0]).toBe(0x05); // ver
    expect(req[1]).toBe(0x01); // connect
    expect(req[3]).toBe(0x03); // domain
    expect(req[4]).toBe(ONION.length); // host len
    expect(new TextDecoder().decode(req.slice(5, 5 + ONION.length))).toBe(ONION);
    const port = (req[5 + ONION.length] << 8) | req[6 + ONION.length];
    expect(port).toBe(9001);
  });

  it('rejects bad host/port on CONNECT', () => {
    expect(() => buildConnectDomain('', 1)).toThrow(Socks5Error);
    expect(() => buildConnectDomain('a'.repeat(256), 1)).toThrow(Socks5Error);
    expect(() => buildConnectDomain(ONION, 0)).toThrow(Socks5Error);
    expect(() => buildConnectDomain(ONION, 70000)).toThrow(Socks5Error);
  });

  it('parses a CONNECT reply (IPv4 bind), success + consumed length', () => {
    // ver, rep=0, rsv, atyp=ipv4, 4 addr bytes, 2 port bytes = 10 total
    const reply = Uint8Array.of(0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0x23, 0x28);
    expect(parseConnectReply(reply.slice(0, 4))).toBeNull(); // header only, ipv4 needs 10
    expect(parseConnectReply(reply.slice(0, 9))).toBeNull(); // incomplete
    expect(parseConnectReply(reply)).toEqual({ ok: true, rep: 0, consumed: 10 });
  });

  it('parses a CONNECT reply (domain bind) and a failure code', () => {
    const dom = Uint8Array.of(0x05, 0x00, 0x00, 0x03, 3, 0x61, 0x62, 0x63, 0x00, 0x50); // 3-char domain
    expect(parseConnectReply(dom)).toEqual({ ok: true, rep: 0, consumed: 4 + 1 + 3 + 2 });
    const fail = Uint8Array.of(0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0); // rep=5 refused
    expect(parseConnectReply(fail)).toEqual({ ok: false, rep: 0x05, consumed: 10 });
  });

  it('throws on bad version / atyp in reply', () => {
    expect(() => parseConnectReply(Uint8Array.of(0x04, 0, 0, 1, 0, 0, 0, 0, 0, 0))).toThrow(Socks5Error);
    expect(() => parseConnectReply(Uint8Array.of(0x05, 0, 0, 0x09, 0, 0))).toThrow(Socks5Error);
  });

  it('maps reply codes to messages', () => {
    expect(socksReplyMessage(0x00)).toMatch(/succeeded/);
    expect(socksReplyMessage(0x05)).toMatch(/refused/);
    expect(socksReplyMessage(0x42)).toMatch(/unknown/);
  });
});
