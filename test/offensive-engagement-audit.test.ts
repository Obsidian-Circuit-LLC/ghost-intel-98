import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EngagementAudit, verifyAuditLog, AuditTruncationError, type AuditEvent } from '../src/main/offensive/engagement-audit';
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

  // --- C2: durable audit (fsync + sidecar head pointer; detect tail truncation) ---

  it('back-compat: a record WITHOUT resolvedIps serializes/chains byte-identically to the legacy format', () => {
    const p = join(dir, 'bc.log');
    const a = new EngagementAudit(p);
    const written = a.record(ev(0));
    // resolvedIps is absent and JSON.stringify omits undefined keys, so the
    // on-disk line and head hash match what the pre-resolvedIps code produced.
    expect('resolvedIps' in written).toBe(false);
    const line = readFileSync(p, 'utf8').split('\n').filter(Boolean)[0];
    expect(line.includes('resolvedIps')).toBe(false);
    // Re-derive the legacy line exactly. The original code built the event as
    // `{ ...partial, seq, prevHash }`, so the chained/serialized field order is
    // the partial's keys first, then seq/prevHash last — unchanged here.
    const legacy = { ...ev(0), seq: 0, prevHash: '0'.repeat(64) };
    expect(line).toBe(JSON.stringify(legacy));
    expect(verifyAuditLog(p).ok).toBe(true);
  });

  it('a record WITH resolvedIps round-trips and verifies', () => {
    const p = join(dir, 'rip.log');
    const a = new EngagementAudit(p);
    const written = a.record({ ...ev(0), resolvedIps: ['1.2.3.4', '::1'] });
    expect(written.resolvedIps).toEqual(['1.2.3.4', '::1']);
    const v = verifyAuditLog(p);
    expect(v.ok).toBe(true);
    expect(v.events[0].resolvedIps).toEqual(['1.2.3.4', '::1']);
    // resolvedIps IS part of the canon bytes, so it appears on disk.
    expect(readFileSync(p, 'utf8').includes('resolvedIps')).toBe(true);
  });

  it('fsync durability: the .head sidecar exists and reflects the latest {seq,headHash}', () => {
    const p = join(dir, 'head.log');
    const a = new EngagementAudit(p);
    a.record(ev(0)); a.record(ev(1));
    const hp = p + '.head';
    expect(existsSync(hp)).toBe(true);
    const head = JSON.parse(readFileSync(hp, 'utf8'));
    expect(head.seq).toBe(2);
    expect(head.headHash).toBe(a.headHash());
    expect(head.headHash).toBe(verifyAuditLog(p).headHash);
  });

  it('detects tail truncation: sidecar head ahead of a shortened log => constructor throws', () => {
    const p = join(dir, 'trunc.log');
    const a = new EngagementAudit(p);
    a.record(ev(0)); a.record(ev(1)); a.record(ev(2));
    // The sidecar now records seq:3. Drop the last log line (crash/tamper) but
    // leave the sidecar ahead. A valid 2-event prefix self-verifies as ok, yet
    // the durable head says there should be 3 — fail loud.
    const lines = readFileSync(p, 'utf8').split('\n').filter(Boolean);
    writeFileSync(p, lines.slice(0, -1).join('\n') + '\n');
    expect(verifyAuditLog(p).ok).toBe(true);          // the shorter chain is a valid prefix...
    expect(verifyAuditLog(p).events.length).toBe(2);  // ...but it is NOT what the durable head claims
    expect(() => new EngagementAudit(p)).toThrow(AuditTruncationError);
  });

  it('no spurious throw: reconstructing a fully-intact durable log succeeds and resumes at the right seq', () => {
    const p = join(dir, 'intact.log');
    const a = new EngagementAudit(p);
    a.record(ev(0)); a.record(ev(1));
    const b = new EngagementAudit(p); // reopen — sidecar matches reconstructed log
    expect(b.headHash()).toBe(a.headHash());
    b.record(ev(2));
    expect(verifyAuditLog(p).events.length).toBe(3);
    expect(verifyAuditLog(p).ok).toBe(true);
  });
});
