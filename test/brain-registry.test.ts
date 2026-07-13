import { describe, it, expect, beforeEach } from 'vitest';
import { setRegisteredBrain, getRegisteredBrain, clearRegisteredBrain, clearAllBrains, _resetBrainsForTest } from '../src/main/investigation/brain-registry';
import type { Brain } from '../src/shared/investigation-agent';

const brain: Brain = { decide: async () => ({ kind: 'done', reason: 'x' }) };

describe('brain registry', () => {
  beforeEach(() => _resetBrainsForTest());
  it('returns null with no brain, the last registered brain otherwise', () => {
    expect(getRegisteredBrain()).toBeNull();
    setRegisteredBrain('osint', brain);
    expect(getRegisteredBrain()).toBe(brain);
  });
  it('clearRegisteredBrain(id) removes that plugin\'s brain', () => {
    setRegisteredBrain('osint', brain);
    clearRegisteredBrain('osint');
    expect(getRegisteredBrain()).toBeNull();
  });
  it('clearAllBrains wipes everything', () => {
    setRegisteredBrain('osint', brain); clearAllBrains();
    expect(getRegisteredBrain()).toBeNull();
  });
});
