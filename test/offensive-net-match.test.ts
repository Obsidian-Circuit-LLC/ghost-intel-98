import { describe, it, expect } from 'vitest';
import { normalizeIp, cidrContains } from '../src/main/offensive/net-match';

describe('net-match', () => {
  it('normalizes IPv4-mapped IPv6 to IPv4', () => {
    expect(normalizeIp('::ffff:10.0.0.5')).toBe('10.0.0.5');
  });
  it('strips IPv6 zone ids', () => {
    expect(normalizeIp('fe80::1%eth0')).toBe('fe80::1');
  });
  it('IPv4 CIDR contains an in-range address', () => {
    expect(cidrContains('10.0.0.0/8', '10.1.2.3')).toBe(true);
    expect(cidrContains('10.0.0.0/8', '11.0.0.1')).toBe(false);
  });
  it('IPv4 /8 exclude catches an IPv4-mapped-IPv6 target', () => {
    expect(cidrContains('10.0.0.0/8', normalizeIp('::ffff:10.9.9.9'))).toBe(true);
  });
  it('IPv6 CIDR containment', () => {
    expect(cidrContains('2001:db8::/32', '2001:db8:1::1')).toBe(true);
    expect(cidrContains('2001:db8::/32', '2001:db9::1')).toBe(false);
  });
  it('host-route /32 and /128 exact match', () => {
    expect(cidrContains('127.0.0.1/32', '127.0.0.1')).toBe(true);
    expect(cidrContains('::1/128', '::1')).toBe(true);
  });
});
