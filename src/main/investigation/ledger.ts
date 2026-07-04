import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { caseDir } from '../storage/paths';
import { secureReadText, secureWriteFile } from '../storage/secure-fs';
import { withLock } from '../util/mutex';
import type { EvidenceRecord, Finding, InvestigationRun } from '@shared/investigation-types';

interface LedgerShape { evidence: EvidenceRecord[]; findings: Finding[]; runs: InvestigationRun[] }

const appendListeners = new Set<(caseId: string) => void>();
export function onLedgerAppend(cb: (caseId: string) => void): () => void { appendListeners.add(cb); return () => appendListeners.delete(cb); }

function ledgerFile(caseId: string): string { return join(caseDir(caseId), 'investigation', 'ledger.json'); }
function rawFile(caseId: string, evidenceId: string): string { return join(caseDir(caseId), 'investigation', 'raw', `${evidenceId}.txt`); }

async function read(caseId: string): Promise<LedgerShape> {
  try { return JSON.parse(await secureReadText(ledgerFile(caseId))) as LedgerShape; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { evidence: [], findings: [], runs: [] }; throw e; }
}
async function write(caseId: string, l: LedgerShape): Promise<void> {
  await secureWriteFile(ledgerFile(caseId), JSON.stringify(l, null, 2));
}

export async function appendEvidence(
  caseId: string,
  rec: Omit<EvidenceRecord, 'id' | 'rawRef' | 'createdAt'>,
  raw: string,
  now: string
): Promise<EvidenceRecord> {
  return withLock(`inv:${caseId}`, async () => {
    const l = await read(caseId);
    const id = `ev-${randomUUID()}`;
    const rawRef = rawFile(caseId, id);
    await secureWriteFile(rawRef, raw);
    const full: EvidenceRecord = { ...rec, id, rawRef, createdAt: now };
    l.evidence.push(full);
    await write(caseId, l);
    for (const cb of appendListeners) cb(caseId);
    return full;
  });
}

export async function appendFinding(caseId: string, f: Omit<Finding, 'id' | 'createdAt'>, now: string): Promise<Finding> {
  return withLock(`inv:${caseId}`, async () => {
    const l = await read(caseId);
    const full: Finding = { ...f, id: `find-${randomUUID()}`, createdAt: now };
    l.findings.push(full);
    await write(caseId, l);
    return full;
  });
}

export async function upsertRun(caseId: string, run: InvestigationRun): Promise<void> {
  return withLock(`inv:${caseId}`, async () => {
    const l = await read(caseId);
    const idx = l.runs.findIndex((r) => r.id === run.id);
    if (idx >= 0) l.runs[idx] = run; else l.runs.push(run);
    await write(caseId, l);
  });
}

export async function getRun(caseId: string, runId: string): Promise<InvestigationRun | undefined> {
  return withLock(`inv:${caseId}`, async () => (await read(caseId)).runs.find((r) => r.id === runId));
}

export async function listEvidence(caseId: string, runId?: string): Promise<EvidenceRecord[]> {
  return withLock(`inv:${caseId}`, async () => {
    const all = (await read(caseId)).evidence;
    return runId ? all.filter((e) => e.runId === runId) : all;
  });
}

export async function listFindings(caseId: string): Promise<Finding[]> {
  return withLock(`inv:${caseId}`, async () => (await read(caseId)).findings);
}
