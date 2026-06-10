import { describe, it, expect } from 'vitest';
import { OffensiveSession } from '../src/main/offensive/session';
import { parseScopeManifest } from '../src/main/offensive/scope-manifest';

const NOW = Date.parse('2026-06-10T00:00:00Z');
const mk = (id: string) => parseScopeManifest({ manifestId: id, mode: 'lab', expiresAt: '2999-01-01T00:00:00Z',
  include: [{ kind: 'cidr', value: '127.0.0.1/32' }] }, NOW);

describe('OffensiveSession', () => {
  it('per-scan: every scan needs a fresh confirm', () => {
    const s = new OffensiveSession(() => NOW);
    s.load(mk('e'), 'per-scan');
    expect(s.mayScan()).toBe(false);
    s.confirm(); expect(s.mayScan()).toBe(true);
    s.consumeScan(); expect(s.mayScan()).toBe(false);
  });
  it('per-session: one confirm covers scans until the scope content changes', () => {
    const s = new OffensiveSession(() => NOW);
    s.load(mk('e'), 'per-session');
    s.confirm(); expect(s.mayScan()).toBe(true);
    s.consumeScan(); expect(s.mayScan()).toBe(true);
    s.load(mk('e2'), 'per-session'); // different content hash → re-arm required
    expect(s.mayScan()).toBe(false);
  });
  it('backward clock invalidates the session', () => {
    let t = NOW; const s = new OffensiveSession(() => t);
    s.load(mk('e'), 'per-session'); s.confirm(); expect(s.mayScan()).toBe(true);
    t = NOW - 60_000; expect(s.mayScan()).toBe(false);
  });
});
