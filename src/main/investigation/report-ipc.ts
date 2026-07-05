/**
 * SP-7 INTELREPORT IPC wiring, extracted into its own dependency-light module (like
 * `registerInvestigationRunIpc` in `./ipc`) so the seam is unit-testable without dragging in
 * `register.ts`'s whole transitive import surface. `register.ts` calls
 * `registerInvestigationReportIpc` with the real `ipcMain`-backed `safeHandle`, the `ensureUuid`
 * validator, `Date.now`, and the subsystem-2 narrator resolver.
 *
 * The handler is a thin, boxed composition of two SP-7 units:
 *   1. `assembleReport` — deterministic, ledger-sourced fact model (never calls an LLM).
 *   2. `applyNarrative` — attaches the injected narrator's prose downstream of the facts, with a
 *      deterministic `TemplateNarrator` fallback when the narrator is absent or throws.
 *
 * SECURITY: `caseId` is UUID-gated via the injected `validateCaseId` (it is a path segment on the
 * ledger read side — `caseDir(join(...))` — so traversal-critical). `runId` is NOT a UUID: the SP-6
 * harness mints `run-<n>` / `manual` ids and runId is only ever used as a ledger *filter value*
 * (`evidence.runId === runId`, `run.id === runId`), never as a path segment — so it is validated as
 * a bounded, control-char-free string, mirroring the run-control channels in `./ipc`.
 */
import { channels } from '@shared/ipc-contracts';
import { assembleReport } from './report';
import { applyNarrative } from './narrator';
import type { IntelReport, Narrator } from '@shared/investigation-report';

type HandleFn = (channel: string, fn: (...args: unknown[]) => unknown) => void;

/** Bounded validation for the optional `runId` filter. Not a UUID (real runIds are `run-<n>` /
 *  `manual`); strip control chars and cap length — it is a filter value, never a path segment. */
function ensureRunId(v: unknown): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > 128) throw new Error('Invalid runId');
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u001f\u007f]/g, '');
}

export interface RegisterReportIpcDeps {
  handle: HandleFn;
  /** Same `ensureUuid`-backed validator `register.ts` injects into the graph/run seams. */
  validateCaseId: (id: unknown) => string;
  /** The ONE production wall-clock entry point (`Date.now`), threaded into the assembler so
   *  `generatedAt` is the sole time value and the assembler itself stays clock-free. */
  now: () => number;
  /** Returns the subsystem-2 model narrator when the OSINT investigator plugin is installed, else
   *  `null` — `applyNarrative` then falls back to the deterministic `TemplateNarrator`. */
  getNarrator: () => Narrator | null;
}

/** Wires `investigation:report:generate`. Mirrors `registerInvestigationRunIpc`: dependency-light
 *  and independently unit-testable. */
export function registerInvestigationReportIpc(deps: RegisterReportIpcDeps): void {
  deps.handle(channels.investigation.report.generate, async (...args: unknown[]): Promise<IntelReport> => {
    const caseId = deps.validateCaseId(args[0]);
    const opts = (args[1] ?? {}) as { runId?: unknown };
    const runId = opts.runId === undefined || opts.runId === null ? undefined : ensureRunId(opts.runId);
    const report = await assembleReport(caseId, { runId, now: deps.now });
    return applyNarrative(report, deps.getNarrator());
  });
}
