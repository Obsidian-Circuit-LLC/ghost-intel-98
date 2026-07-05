import type { Brain, AgentContext, AgentAction } from '@shared/investigation-agent';

/** Deterministic test brain: returns a preset action sequence, then `done`. Keeps the whole harness
 *  unit-testable with no LLM (the real free-form brain is subsystem-2). */
export class ScriptedBrain implements Brain {
  private i = 0;
  constructor(private readonly script: AgentAction[]) {}
  async decide(_ctx: AgentContext): Promise<AgentAction> {
    return this.script[this.i++] ?? { kind: 'done', reason: 'script-exhausted' };
  }
}
