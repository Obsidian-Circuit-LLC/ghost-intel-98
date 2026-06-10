import { describe, it, expect } from 'vitest';
import { BGCONN_LOCK_EXEMPT_CHANNELS } from '../src/shared/ipc-contracts';

describe('bgconn IPC lock exemption', () => {
  it('exposes status + stop as lock-exempt (operator can see/kill a monitor while locked), NOT start/configure', () => {
    expect(BGCONN_LOCK_EXEMPT_CHANNELS).toContain('bgconn:status');
    expect(BGCONN_LOCK_EXEMPT_CHANNELS).toContain('bgconn:stop');
    expect(BGCONN_LOCK_EXEMPT_CHANNELS).not.toContain('bgconn:start');
    expect(BGCONN_LOCK_EXEMPT_CHANNELS).not.toContain('bgconn:configure');
    expect(BGCONN_LOCK_EXEMPT_CHANNELS).not.toContain('bgconn:clearCredentials');
  });
});
