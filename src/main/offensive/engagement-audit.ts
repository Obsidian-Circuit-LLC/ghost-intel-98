import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

export interface AuditEvent {
  seq: number; prevHash: string;
  manifestId: string; manifestContentHash: string;
  host: string; dialedIp: string; port: number; method: string;
  decision: 'allowed' | 'denied'; reason?: string;
  attackType?: string; // SCANNER-ASSERTED, UNVERIFIED
  at: string;
}

const GENESIS = '0'.repeat(64);
const canon = (e: AuditEvent): string => JSON.stringify(e);
const chain = (prevHash: string, e: AuditEvent): string =>
  createHash('sha256').update(prevHash).update(canon(e)).digest('hex');

export class EngagementAudit {
  private seq = 0;
  private prevHash = GENESIS;
  constructor(private readonly path: string) {
    if (existsSync(path)) {
      const r = verifyAuditLog(path);
      this.seq = r.events.length;
      this.prevHash = r.headHash;
    }
  }
  record(partial: Omit<AuditEvent, 'seq' | 'prevHash'>): AuditEvent {
    const e: AuditEvent = { ...partial, seq: this.seq, prevHash: this.prevHash };
    appendFileSync(this.path, JSON.stringify(e) + '\n');
    this.prevHash = chain(this.prevHash, e);
    this.seq += 1;
    return e;
  }
  headHash(): string { return this.prevHash; }
}

export interface AuditVerifyResult { ok: boolean; events: AuditEvent[]; headHash: string; }

export function verifyAuditLog(path: string): AuditVerifyResult {
  if (!existsSync(path)) return { ok: true, events: [], headHash: GENESIS };
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  const events: AuditEvent[] = [];
  let prev = GENESIS;
  for (let i = 0; i < lines.length; i++) {
    let e: AuditEvent;
    try { e = JSON.parse(lines[i]); } catch { return { ok: false, events, headHash: prev }; }
    if (e.seq !== i || e.prevHash !== prev) return { ok: false, events, headHash: prev };
    events.push(e);
    prev = chain(prev, e);
  }
  return { ok: true, events, headHash: prev };
}
