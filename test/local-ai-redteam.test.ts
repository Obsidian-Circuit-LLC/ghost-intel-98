import { describe, it, expect } from 'vitest';
import { LOCAL_AI_ENDPOINT } from '../src/main/services/local-ai-paths';
import { ensureLocalAiSetupOpts } from '../src/main/security/validate';

describe('local-ai red-team invariants', () => {
  it('runtime endpoint is loopback-only', () => {
    expect(LOCAL_AI_ENDPOINT.startsWith('http://127.0.0.1:')).toBe(true);
  });
  it('setup opts reject anything but online|bundled and strip client URLs', () => {
    expect(() => ensureLocalAiSetupOpts({ mode: 'evil', url: 'http://attacker' } as any)).toThrow();
    expect(ensureLocalAiSetupOpts({ mode: 'online', url: 'http://attacker' } as any)).toEqual({ mode: 'online' });
    expect(() => ensureLocalAiSetupOpts({} as any)).toThrow();
  });
});
