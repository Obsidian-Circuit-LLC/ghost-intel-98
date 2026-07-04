/**
 * SP-4 investigation graph IPC wiring, extracted from `main/ipc/register.ts` into its own
 * dependency-light module so the seam is unit-testable without dragging in register.ts's entire
 * transitive import surface (chat/ssh/ftp/searchlight/etc). `register.ts` calls
 * `registerInvestigationGraphIpc` with the real `ipcMain`-backed `safeHandle` + a
 * `webContents.send`-backed `sendToWatchers`.
 *
 * Watcher lifecycle: the renderer calls `investigation:graph(caseId)` to fetch the current
 * scene; the first such call for a given caseId also subscribes it to the debounced emitter
 * (Task 4), so every subsequent ledger append for that case streams a delta via `sendToWatchers`.
 */
import { channels } from '@shared/ipc-contracts';
import { sceneForCase, onSceneDelta, startGraphEmitter } from './graph';
import type { InvestigationScene, SceneDelta } from '@shared/investigation-graph';

type HandleFn = (channel: string, fn: (...args: unknown[]) => unknown) => void;
type SendToWatchers = (payload: { caseId: string; delta: SceneDelta }) => void;

export function registerInvestigationGraphIpc(deps: { handle: HandleFn; sendToWatchers: SendToWatchers; validateCaseId: (id: unknown) => string }): void {
  startGraphEmitter();
  const watched = new Set<string>();
  deps.handle(channels.investigation.graph, (...args: unknown[]): Promise<InvestigationScene> => {
    // Validate BEFORE the id reaches sceneForCase → listEvidence → ledgerFile → caseDir(join): a raw
    // caseId like '../../..' would otherwise escape casesDir() on the read side (node:path.join does
    // not strip traversal). register.ts injects ensureUuid; every sibling caseId channel already does.
    const caseId = deps.validateCaseId(args[0]);
    if (!watched.has(caseId)) {
      watched.add(caseId);
      onSceneDelta(caseId, (delta) => deps.sendToWatchers({ caseId, delta }));
    }
    return sceneForCase(caseId);
  });
}
