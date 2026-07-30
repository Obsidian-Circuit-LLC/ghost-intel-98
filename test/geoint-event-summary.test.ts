import { describe, it, expect, vi, beforeEach } from 'vitest';

let settings: any;
vi.mock('../src/main/storage/json-fs', () => ({ settingsStore: { read: async () => settings } }));
import { summarizeEvent } from '../src/main/geoint/event-summary';

const okFetch = (content: string) => vi.fn(async () => ({
  ok: true, status: 200, json: async () => ({ message: { role: 'assistant', content } })
} as any));

beforeEach(() => {
  settings = { ai: { provider: 'ollama', endpoint: 'http://127.0.0.1:11434', model: 'llama3' } };
  vi.unstubAllGlobals();
});

describe('summarizeEvent (isolated local-Ollama path)', () => {
  it('returns available:false when the provider is not ollama (never sends OSINT remotely)', async () => {
    settings.ai.provider = 'openai-compatible';
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    const r = await summarizeEvent('A strike was reported.');
    expect(r.available).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it('returns available:false when no model is configured', async () => {
    settings.ai.model = '';
    const r = await summarizeEvent('A strike was reported.');
    expect(r.available).toBe(false);
  });

  it('returns available:false for an empty description without calling the model', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    const r = await summarizeEvent('   ');
    expect(r.available).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it('summarizes via /api/chat (stream:false) and returns the text', async () => {
    const f = okFetch('Two districts were struck; details unconfirmed.');
    vi.stubGlobal('fetch', f);
    const r = await summarizeEvent('Missiles hit two districts near the airport.');
    expect(r.available).toBe(true);
    expect(r.text).toContain('struck');
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toBe('http://127.0.0.1:11434/api/chat');
    const body = JSON.parse((init as any).body);
    expect(body.stream).toBe(false);
    expect(body.model).toBe('llama3');
    expect(body.messages[body.messages.length - 1].content).toContain('Missiles hit two districts');
  });

  it('returns available:false when the local model call fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const r = await summarizeEvent('A strike was reported.');
    expect(r.available).toBe(false);
    expect(r.reason).toBeTruthy();
  });
});
