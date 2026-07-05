import { describe, it, expect, afterEach, vi } from 'vitest';

// __setProfileFacadeDepsForTest lazily builds real defaults for deps it isn't given, which touches
// dataRoot()/app.getPath — mock electron so no real runtime is needed (repo convention).
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/ga98-distiller-endpoint-test' } }));

import {
  learnFromConversation,
  __setProfileFacadeDepsForTest,
  __resetProfileFacadeForTest
} from '../src/main/services/memory/profile/index';
import { createProfileStore, type ProfileStoreIO } from '../src/main/services/memory/profile/profile-store';

function fakeIO(): ProfileStoreIO {
  let text: string | null = null;
  return { async read() { return text; }, async write(t: string) { text = t; } };
}

afterEach(() => {
  __resetProfileFacadeForTest();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * Root cause (GhostExodus "nothing ever appears learned"): the distiller hardcoded model `llama3.1`
 * on the bundled runtime, which ships no chat model — every call 404'd. The fix routes distillation
 * through the user's configured chat endpoint + model (the conversation already went there).
 */
describe('adaptive-memory distiller uses the caller-supplied chat endpoint + model', () => {
  it('POSTs /api/generate to the user endpoint with the user model — not llama3.1 / not the bundled runtime', async () => {
    const calls: { url: string; model: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body: string }) => {
      calls.push({ url: String(url), model: (JSON.parse(init.body) as { model: string }).model });
      return { ok: true, json: async () => ({ response: '[]' }) } as unknown as Response;
    }));

    __setProfileFacadeDepsForTest({
      store: createProfileStore(fakeIO()),
      summaryIo: fakeIO(),
      now: () => 1000,
      newId: () => 'id-1'
    });

    await learnFromConversation('c1', 'user: I only use Tor.\nassistant: noted.', ['global'], {
      model: 'huihui_ai/qwen3.5-abliterated:4B',
      endpoint: 'http://127.0.0.1:11434'
    });

    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.url).toBe('http://127.0.0.1:11434/api/generate');
      expect(c.model).toBe('huihui_ai/qwen3.5-abliterated:4B');
      expect(c.model).not.toBe('llama3.1');
    }
  });

  it('respects a non-default (LAN) endpoint the user configured for chat', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(String(url));
      return { ok: true, json: async () => ({ response: '[]' }) } as unknown as Response;
    }));
    __setProfileFacadeDepsForTest({ store: createProfileStore(fakeIO()), summaryIo: fakeIO(), now: () => 1000, newId: () => 'id-1' });

    await learnFromConversation('c2', 'user: hi\nassistant: hey', ['global'], {
      model: 'mymodel', endpoint: 'http://10.0.0.5:11434'
    });

    expect(urls.every((u) => u === 'http://10.0.0.5:11434/api/generate')).toBe(true);
  });
});
