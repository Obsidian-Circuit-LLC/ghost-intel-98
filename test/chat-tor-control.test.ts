import { describe, it, expect } from 'vitest';
import {
  buildAuthenticate,
  buildAddOnionNew,
  buildAddOnionFromKey,
  parseReply,
  parseAddOnionResult,
  TorControlError
} from '../src/main/chat/tor-control';

describe('Tor control codec', () => {
  it('builds AUTHENTICATE from a hex cookie; rejects non-hex', () => {
    expect(buildAuthenticate('deadBEEF01')).toBe('AUTHENTICATE deadBEEF01\r\n');
    expect(() => buildAuthenticate('xyz')).toThrow(TorControlError);
  });

  it('builds ADD_ONION NEW and from-key commands', () => {
    expect(buildAddOnionNew(9001, '127.0.0.1', 49001)).toBe('ADD_ONION NEW:ED25519-V3 Port=9001,127.0.0.1:49001\r\n');
    expect(buildAddOnionFromKey('ED25519-V3:AAAA', 9001, '127.0.0.1', 49001)).toBe(
      'ADD_ONION ED25519-V3:AAAA Port=9001,127.0.0.1:49001\r\n'
    );
    expect(() => buildAddOnionFromKey('bad', 9001, '127.0.0.1', 49001)).toThrow(TorControlError);
    expect(() => buildAddOnionNew(0, '127.0.0.1', 49001)).toThrow(TorControlError);
  });

  it('parses a single-line final reply', () => {
    expect(parseReply('250 OK\r\n')).toEqual({ code: 250, lines: ['OK'], ok: true });
    expect(parseReply('515 Bad authentication\r\n')).toEqual({ code: 515, lines: ['Bad authentication'], ok: false });
  });

  it('returns null until a reply is terminated', () => {
    expect(parseReply('250-ServiceID=abc\r\n')).toBeNull(); // mid-line, no final yet
    expect(parseReply('250-ServiceID=abc')).toBeNull();
  });

  it('parses a multi-line ADD_ONION reply and extracts ServiceID + PrivateKey', () => {
    const text =
      '250-ServiceID=exampleonionaddressbase32\r\n' +
      '250-PrivateKey=ED25519-V3:SOMEBASE64KEY==\r\n' +
      '250 OK\r\n';
    const reply = parseReply(text);
    expect(reply).not.toBeNull();
    expect(reply?.ok).toBe(true);
    const res = parseAddOnionResult(reply!);
    expect(res.serviceId).toBe('exampleonionaddressbase32');
    expect(res.privateKey).toBe('ED25519-V3:SOMEBASE64KEY==');
  });

  it('parseAddOnionResult: re-publish reply with no PrivateKey is fine; missing ServiceID throws', () => {
    const noKey = parseReply('250-ServiceID=abc\r\n250 OK\r\n')!;
    expect(parseAddOnionResult(noKey)).toEqual({ serviceId: 'abc' });
    const missing = parseReply('250 OK\r\n')!;
    expect(() => parseAddOnionResult(missing)).toThrow(TorControlError);
    const failed = parseReply('512 Bad arguments\r\n')!;
    expect(() => parseAddOnionResult(failed)).toThrow(TorControlError);
  });
});
