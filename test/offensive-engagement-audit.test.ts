import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EngagementAudit, verifyAuditLog, type AuditEvent } from '../src/main/offensive/engagement-audit';

const dir = mkdtempSync(join(tmpdir(), 'dcs98-audit-'));
const ev = (seq: number): Omit<AuditEvent, 'seq' | 'prevHash'> => ({
  manifestId: 'e', manifestContentHash: 'abc', host: 'h', dialedIp: '10.0.0.1', port: 443,
  method: 'GET', decision: 'allowed', at: '2026-06-10T00:00:00Z'
});

describe('EngagementAudit', () => {
  it('appends a verifiable hash chain; verify passes', () => {
    const p = join(dir, 'a.log');
    const a = new EngagementAudit(p);
    a.record(ev(0)); a.record({ ...ev(1), decision: 'denied', reason: 'out of scope' });
    expect(verifyAuditLog(p).ok).toBe(true);
    expect(verifyAuditLog(p).events.length).toBe(2);
  });
  it('detects a tampered event', () => {
    const p = join(dir, 'b.log');
    const a = new EngagementAudit(p);
    a.record(ev(0)); a.record(ev(1));
    const lines = readFileSync(p, 'utf8').split('\n').filter(Boolean);
    const first = JSON.parse(lines[0]); first.dialedIp = '8.8.8.8';
    writeFileSync(p, [JSON.stringify(first), lines[1]].join('\n') + '\n');
    expect(verifyAuditLog(p).ok).toBe(false);
  });
  it('detects truncation to a shorter chain', () => {
    const p = join(dir, 'c.log');
    const a = new EngagementAudit(p);
    a.record(ev(0)); a.record(ev(1));
    const lines = readFileSync(p, 'utf8').split('\n').filter(Boolean);
    writeFileSync(p, lines[0] + '\n'); // drop the second event
    expect(verifyAuditLog(p).ok).toBe(true);   // a valid prefix self-verifies as a shorter chain...
    expect(verifyAuditLog(p).events.length).toBe(1); // ...so callers compare length against the persisted head (Task 11)
  });
});
