import { describe, it, expect, beforeEach } from 'vitest';
import { setRegisteredBrain, getRegisteredBrain, clearRegisteredBrain, clearAllBrains, brainRegisteredPluginIds, _resetBrainsForTest } from '../src/main/investigation/brain-registry';
import type { Brain } from '../src/shared/investigation-agent';

const brain: Brain = { decide: async () => ({ kind: 'done', reason: 'x' }) };
const mkBrain = (reason: string): Brain => ({ decide: async () => ({ kind: 'done', reason }) });

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
  it('with two brains, the last inserted key wins; re-registering a key returns its updated brain', () => {
    const a = mkBrain('a'), b = mkBrain('b'), a2 = mkBrain('a2');
    setRegisteredBrain('alpha', a);
    setRegisteredBrain('beta', b);
    expect(getRegisteredBrain()).toBe(b); // last inserted key wins
    // Re-registering an existing key updates its value in place (Map keeps insertion order), so the
    // last-inserted key ('beta') still wins — but 'alpha' now resolves to its new brain if 'beta' clears.
    setRegisteredBrain('alpha', a2);
    expect(getRegisteredBrain()).toBe(b);
    clearRegisteredBrain('beta');
    expect(getRegisteredBrain()).toBe(a2);
  });
  it('brainRegisteredPluginIds enumerates registered plugin ids (for disableAllPlugins teardown)', () => {
    expect(brainRegisteredPluginIds()).toEqual([]);
    setRegisteredBrain('osint', brain);
    expect(brainRegisteredPluginIds()).toEqual(['osint']);
    clearRegisteredBrain('osint');
    expect(brainRegisteredPluginIds()).toEqual([]);
  });
});
