import { describe, it, expect } from 'vitest';
import { hostFromStreamUrl } from '../src/main/services/hostinfo/extract';

describe('hostFromStreamUrl', () => {
  it('extracts an IP literal + port from a stream url', () => {
    expect(hostFromStreamUrl('http://190.210.250.149:91/mjpg/video.mjpg')).toEqual({ host: '190.210.250.149', isIpLiteral: true, port: '91' });
  });
  it('extracts a hostname (no port) and marks it non-literal', () => {
    expect(hostFromStreamUrl('https://cam.example.com/stream')).toEqual({ host: 'cam.example.com', isIpLiteral: false });
  });
  it('detects an IPv6 literal', () => {
    const r = hostFromStreamUrl('http://[2001:db8::1]:8080/v');
    expect(r?.isIpLiteral).toBe(true);
    expect(r?.host).toBe('2001:db8::1');
  });
  it('returns null for an unparseable url', () => {
    expect(hostFromStreamUrl('not a url')).toBeNull();
  });
});
