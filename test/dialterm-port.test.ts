import { describe, it, expect } from 'vitest';
import { nextPortOnProtocolChange, DEFAULT_PORTS } from '../src/renderer/modules/dialterm/port';

describe('nextPortOnProtocolChange', () => {
  it('fills the protocol default when the current port is a known default', () => {
    expect(nextPortOnProtocolChange(22, 'telnet')).toBe(DEFAULT_PORTS.telnet); // 23
    expect(nextPortOnProtocolChange(21, 'ssh')).toBe(DEFAULT_PORTS.ssh);       // 22
  });
  it('fills the protocol default when the current port is empty/zero', () => {
    expect(nextPortOnProtocolChange(0, 'ftp')).toBe(DEFAULT_PORTS.ftp);        // 21
  });
  it('preserves a user-entered custom port across a protocol change', () => {
    expect(nextPortOnProtocolChange(2222, 'telnet')).toBe(2222);
    expect(nextPortOnProtocolChange(8022, 'ssh')).toBe(8022);
  });
});
