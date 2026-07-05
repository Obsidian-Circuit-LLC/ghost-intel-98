import { describe, it, expect, beforeEach, vi } from 'vitest';

// assembleReport is unit-tested on its own (investigation-report.test.ts); here we mock it so the
// IPC seam is tested in isolation — the handler's job is UUID-gating the caseId, threading the
// injected `now`, passing an optional runId through, then applying the injected narrator (with the
// deterministic template fallback). The real narrator seam runs unmocked so the fallback paths are
// genuinely exercised.
vi.mock('../src/main/investigation/report', () => ({
  assembleReport: vi.fn(async (caseId: string, opts?: { runId?: string; now?: () => number }) => ({
    caseId,
    ...(opts?.runId ? { runId: opts.runId, scope: 'run' as const } : { scope: 'case' as const }),
    generatedAt: new Date((opts?.now ?? (() => 0))()).toISOString(),
    entityCount: 0,
    findingCount: 0,
    keyActors: [],
    actorTail: { shown: 0, total: 0 },
    findings: [],
    methodology: []
  }))
}));

import { channels } from '../src/shared/ipc-contracts';
import { registerInvestigationReportIpc } from '../src/main/investigation/report-ipc';
import { assembleReport } from '../src/main/investigation/report';
import { TemplateNarrator } from '../src/main/investigation/narrator';
import { ensureUuid } from '../src/main/security/validate';
import type { IntelReport, Narrator } from '../src/shared/investigation-report';

/** Same `safeHandle`-style test double the run-IPC seam test uses (see
 *  investigation-run-ipc.test.ts): register a handler by passing a function; invoke it by passing
 *  the first call arg. */
function makeHandle(): (channel: string, fnOrArg: unknown, ...rest: unknown[]) => unknown {
  const handlers = new Map<string, (...a: unknown[]) => unknown>();
  return function handle(channel: string, fnOrArg: unknown, ...rest: unknown[]): unknown {
    if (typeof fnOrArg === 'function') {
      handlers.set(channel, fnOrArg as (...a: unknown[]) => unknown);
      return undefined;
    }
    const h = handlers.get(channel);
    if (!h) throw new Error(`no handler registered for ${channel}`);
    return h(fnOrArg, ...rest);
  };
}

const CASE_UUID = '11111111-1111-4111-8111-111111111111';
const validateCaseId = (id: unknown): string => ensureUuid(id, 'caseId');

beforeEach(() => {
  vi.mocked(assembleReport).mockClear();
});

describe('registerInvestigationReportIpc', () => {
  it('report:generate rejects a non-UUID caseId (validateCaseId is enforced)', async () => {
    const handle = makeHandle();
    registerInvestigationReportIpc({ handle, validateCaseId, now: () => 0, getNarrator: () => new TemplateNarrator() });
    await expect(
      (async () => handle(channels.investigation.report.generate, '../../../etc/passwd'))()
    ).rejects.toThrow(/UUID/i);
    expect(assembleReport).not.toHaveBeenCalled();
  });

  it('returns the assembled model with a template narrative attached', async () => {
    const handle = makeHandle();
    registerInvestigationReportIpc({ handle, validateCaseId, now: () => 0, getNarrator: () => new TemplateNarrator() });
    const report = (await handle(channels.investigation.report.generate, CASE_UUID)) as IntelReport;
    expect(report.caseId).toBe(CASE_UUID);
    expect(report.scope).toBe('case');
    expect(report.narrative).toBeDefined();
    expect(report.narrative?.source).toBe('template');
    // The injected `now` is threaded into the assembler (storage-boundary ISO conversion).
    expect(assembleReport).toHaveBeenCalledWith(CASE_UUID, expect.objectContaining({ now: expect.any(Function) }));
  });

  it('threads an optional runId through to the assembler (run-scoped, non-UUID runId accepted)', async () => {
    const handle = makeHandle();
    registerInvestigationReportIpc({ handle, validateCaseId, now: () => 0, getNarrator: () => new TemplateNarrator() });
    // Real SP-6 runIds are `run-<n>` / `manual`, NOT UUIDs — the run filter must accept them.
    const report = (await handle(channels.investigation.report.generate, CASE_UUID, { runId: 'run-1' })) as IntelReport;
    expect(report.runId).toBe('run-1');
    expect(report.scope).toBe('run');
    expect(assembleReport).toHaveBeenCalledWith(CASE_UUID, expect.objectContaining({ runId: 'run-1', now: expect.any(Function) }));
  });

  it('getNarrator returning null falls back to the deterministic template narrator', async () => {
    const handle = makeHandle();
    registerInvestigationReportIpc({ handle, validateCaseId, now: () => 0, getNarrator: () => null });
    const report = (await handle(channels.investigation.report.generate, CASE_UUID)) as IntelReport;
    expect(report.narrative?.source).toBe('template');
  });

  it('a throwing narrator still yields a report (template fallback — narrative failure never fails the report)', async () => {
    const throwing: Narrator = { narrate: async () => { throw new Error('model narrator boom'); } };
    const handle = makeHandle();
    registerInvestigationReportIpc({ handle, validateCaseId, now: () => 0, getNarrator: () => throwing });
    const report = (await handle(channels.investigation.report.generate, CASE_UUID)) as IntelReport;
    expect(report.caseId).toBe(CASE_UUID);
    expect(report.narrative?.source).toBe('template');
  });
});
