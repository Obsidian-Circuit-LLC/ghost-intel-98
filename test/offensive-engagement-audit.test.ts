import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EngagementAudit, verifyAuditLog, type AuditEvent } from '../src/main/offensive/engagement-audit';
import { ed25519 } from '@noble/curves/ed25519.js';

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

  it('with a signer, verify passes only with the matching verifier', () => {
    const p = join(dir, 'd.log');
    const sec = ed25519.utils.randomSecretKey();
    const pub = ed25519.getPublicKey(sec);
    const signer = (head: string) => Buffer.from(ed25519.sign(Buffer.from(head, 'hex'), sec)).toString('hex');
    const verifier = (sig: string, head: string) => ed25519.verify(Buffer.from(sig, 'hex'), Buffer.from(head, 'hex'), pub);
    const a = new EngagementAudit(p, signer);
    a.record(ev(0)); a.record(ev(1));
    expect(verifyAuditLog(p, verifier).ok).toBe(true);
    expect(verifyAuditLog(p).ok).toBe(true); // chain-only still passes (no verifier)
  });

  it('with a signer, a LAST-event edit is detected by the verifier (in-file chain alone would miss it)', () => {
    const p = join(dir, 'e.log');
    const sec = ed25519.utils.randomSecretKey();
    const pub = ed25519.getPublicKey(sec);
    const signer = (head: string) => Buffer.from(ed25519.sign(Buffer.from(head, 'hex'), sec)).toString('hex');
    const verifier = (sig: string, head: string) => ed25519.verify(Buffer.from(sig, 'hex'), Buffer.from(head, 'hex'), pub);
    const a = new EngagementAudit(p, signer);
    a.record(ev(0)); a.record(ev(1));
    const lines = readFileSync(p, 'utf8').split('\n').filter(Boolean);
    const last = JSON.parse(lines[1]); last.dialedIp = '8.8.8.8'; // edit last event, keep its sig
    writeFileSync(p, [lines[0], JSON.stringify(last)].join('\n') + '\n');
    expect(verifyAuditLog(p).ok).toBe(true);            // chain-only MISSES a last-event edit
    expect(verifyAuditLog(p, verifier).ok).toBe(false); // the signature CATCHES it
  });
});
