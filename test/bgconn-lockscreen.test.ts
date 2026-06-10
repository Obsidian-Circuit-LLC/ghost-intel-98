import { describe, it, expect } from 'vitest';
import { lockScreenBgconnLabel } from '../src/renderer/shell/LockScreen';

describe('lock-screen bgconn surface', () => {
  it('renders a LIVE label per active connection, or empty when none', () => {
    expect(lockScreenBgconnLabel([])).toBe('');
    expect(lockScreenBgconnLabel([{ connId: 'c1', routing: 'tor', startedAt: 0 }]))
      .toMatch(/Telegram monitor: LIVE \(tor\)/);
  });
});
