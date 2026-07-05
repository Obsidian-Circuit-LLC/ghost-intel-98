import { describe, it, expect, beforeEach, vi } from 'vitest';

// Same isolation strategy as investigation-report-ipc.test.ts: assembleReport is unit-tested on its
// own, so here we mock it to keep the IPC seam under test. `report:save` extends the generate seam
// with two injected effects — `renderPdf` (deterministic offscreen PDF, unit-tested separately) and
// `saveBuffer` (the OS save-dialog effect) — both spied so we assert the compose order
// (assemble → narrate → renderPdf → saveBuffer) and the UUID gate without any real Electron/FS.
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

/** Same `safeHandle`-style test double the run-IPC seam test uses (see investigation-run-ipc.test.ts):
 *  register a handler by passing a function; invoke it by passing the first call arg. */
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
const PDF = Buffer.from('%PDF-fake');

beforeEach(() => {
  vi.mocked(assembleReport).mockClear();
});

describe('registerInvestigationReportIpc — report:save', () => {
  it('report:save rejects a non-UUID caseId (validateCaseId is enforced, no PDF rendered)', async () => {
    const renderPdf = vi.fn(async () => PDF);
    const saveBuffer = vi.fn(async () => '/out/x.pdf');
    const handle = makeHandle();
    registerInvestigationReportIpc({
      handle, validateCaseId, now: () => 0, getNarrator: () => new TemplateNarrator(), renderPdf, saveBuffer
    });
    await expect(
      (async () => handle(channels.investigation.report.save, '../../../etc/passwd'))()
    ).rejects.toThrow(/UUID/i);
    expect(assembleReport).not.toHaveBeenCalled();
    expect(renderPdf).not.toHaveBeenCalled();
    expect(saveBuffer).not.toHaveBeenCalled();
  });

  it('assembles → narrates → renders the PDF → saves the buffer under an INTELREPORT-<caseId8> name, returning the save path', async () => {
    const renderPdf = vi.fn(async () => PDF);
    const saveBuffer = vi.fn(async () => '/home/desirae/INTELREPORT-11111111.pdf');
    const handle = makeHandle();
    registerInvestigationReportIpc({
      handle, validateCaseId, now: () => 0, getNarrator: () => new TemplateNarrator(), renderPdf, saveBuffer
    });
    const path = await handle(channels.investigation.report.save, CASE_UUID);
    // renderPdf gets the assembled report WITH the narrative already applied.
    expect(renderPdf).toHaveBeenCalledTimes(1);
    const rendered = renderPdf.mock.calls[0][0] as IntelReport;
    expect(rendered.caseId).toBe(CASE_UUID);
    expect(rendered.narrative?.source).toBe('template');
    // saveBuffer gets the rendered buffer under the deterministic short-id name.
    expect(saveBuffer).toHaveBeenCalledWith('INTELREPORT-11111111.pdf', PDF);
    expect(path).toBe('/home/desirae/INTELREPORT-11111111.pdf');
  });

  it('threads an optional non-UUID runId through to the assembler (run-scoped export)', async () => {
    const renderPdf = vi.fn(async () => PDF);
    const saveBuffer = vi.fn(async () => '/out/x.pdf');
    const handle = makeHandle();
    registerInvestigationReportIpc({
      handle, validateCaseId, now: () => 0, getNarrator: () => new TemplateNarrator(), renderPdf, saveBuffer
    });
    await handle(channels.investigation.report.save, CASE_UUID, { runId: 'run-1' });
    expect(assembleReport).toHaveBeenCalledWith(CASE_UUID, expect.objectContaining({ runId: 'run-1', now: expect.any(Function) }));
    const rendered = renderPdf.mock.calls[0][0] as IntelReport;
    expect(rendered.runId).toBe('run-1');
    expect(rendered.scope).toBe('run');
  });

  it('a bounded, control-char-free runId is enforced (mirrors report:generate)', async () => {
    const renderPdf = vi.fn(async () => PDF);
    const saveBuffer = vi.fn(async () => '/out/x.pdf');
    const handle = makeHandle();
    registerInvestigationReportIpc({
      handle, validateCaseId, now: () => 0, getNarrator: () => new TemplateNarrator(), renderPdf, saveBuffer
    });
    await expect(
      (async () => handle(channels.investigation.report.save, CASE_UUID, { runId: 'x'.repeat(200) }))()
    ).rejects.toThrow(/runId/i);
    expect(renderPdf).not.toHaveBeenCalled();
  });

  it('getNarrator null → template narrative still renders and the save still succeeds', async () => {
    const renderPdf = vi.fn(async () => PDF);
    const saveBuffer = vi.fn(async () => '/out/x.pdf');
    const handle = makeHandle();
    registerInvestigationReportIpc({ handle, validateCaseId, now: () => 0, getNarrator: () => null, renderPdf, saveBuffer });
    const path = await handle(channels.investigation.report.save, CASE_UUID);
    const rendered = renderPdf.mock.calls[0][0] as IntelReport;
    expect(rendered.narrative?.source).toBe('template');
    expect(path).toBe('/out/x.pdf');
  });

  it('a throwing narrator still exports (template fallback — narrative failure never fails the save)', async () => {
    const throwing: Narrator = { narrate: async () => { throw new Error('model narrator boom'); } };
    const renderPdf = vi.fn(async () => PDF);
    const saveBuffer = vi.fn(async () => '/out/x.pdf');
    const handle = makeHandle();
    registerInvestigationReportIpc({ handle, validateCaseId, now: () => 0, getNarrator: () => throwing, renderPdf, saveBuffer });
    const path = await handle(channels.investigation.report.save, CASE_UUID);
    const rendered = renderPdf.mock.calls[0][0] as IntelReport;
    expect(rendered.narrative?.source).toBe('template');
    expect(path).toBe('/out/x.pdf');
  });

  it('propagates a null save path when the user cancels the dialog', async () => {
    const renderPdf = vi.fn(async () => PDF);
    const saveBuffer = vi.fn(async () => null);
    const handle = makeHandle();
    registerInvestigationReportIpc({ handle, validateCaseId, now: () => 0, getNarrator: () => new TemplateNarrator(), renderPdf, saveBuffer });
    const path = await handle(channels.investigation.report.save, CASE_UUID);
    expect(path).toBeNull();
  });
});
