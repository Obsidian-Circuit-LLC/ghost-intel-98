import { describe, it, expect } from 'vitest';
import { ScriptedBrain } from '../src/main/investigation/scripted-brain';
import type { AgentContext } from '../src/shared/investigation-agent';

const ctx = {} as AgentContext;

describe('ScriptedBrain', () => {
  it('returns the scripted actions in order', async () => {
    const b = new ScriptedBrain([
      { kind: 'run-transform', transformId: 'whois', entityId: 'e1' },
      { kind: 'done', reason: 'finished' },
    ]);
    expect(await b.decide(ctx)).toEqual({ kind: 'run-transform', transformId: 'whois', entityId: 'e1' });
    expect(await b.decide(ctx)).toEqual({ kind: 'done', reason: 'finished' });
  });
  it('returns done once the script is exhausted', async () => {
    const b = new ScriptedBrain([]);
    expect(await b.decide(ctx)).toEqual({ kind: 'done', reason: 'script-exhausted' });
  });
});
