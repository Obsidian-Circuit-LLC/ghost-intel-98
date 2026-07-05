import { describe, it, expect } from 'vitest';

import { channels } from '../src/shared/ipc-contracts';
import { registerInvestigationRunIpc } from '../src/main/investigation/ipc';
import { ScriptedBrain } from '../src/main/investigation/scripted-brain';
import { ensureUuid } from '../src/main/security/validate';

/** Minimal `safeHandle`-style test double — same convention as investigation-run-ipc.test.ts's
 *  makeHandle (a registered handler is invoked by calling `handle(channel, ...args)`). */
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

const baseDeps = {
  sendEvent: (): void => {},
  validateCaseId: (id: unknown): string => ensureUuid(id, 'caseId'),
  now: (): number => 0
};

describe('registerInvestigationRunIpc — run:available', () => {
  it('resolves true when a brain is available (reasoning pack installed)', async () => {
    const handle = makeHandle();
    registerInvestigationRunIpc({
      ...baseDeps, handle,
      getBrain: () => new ScriptedBrain([{ kind: 'done', reason: 'finished' }])
    });
    await expect(Promise.resolve(handle(channels.investigation.run.available))).resolves.toBe(true);
  });

  it('resolves false when no brain is available (plugin not installed)', async () => {
    const handle = makeHandle();
    registerInvestigationRunIpc({ ...baseDeps, handle, getBrain: () => null });
    await expect(Promise.resolve(handle(channels.investigation.run.available))).resolves.toBe(false);
  });
});
