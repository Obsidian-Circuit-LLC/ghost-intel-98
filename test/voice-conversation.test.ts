import { describe, it, expect, vi } from 'vitest';
import { VoiceConversation } from '../src/renderer/voice/conversation';
import type { SpeechRecognizer } from '../src/renderer/voice/recognizer';

const flush = async (): Promise<void> => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); };

function fakeRecognizer() {
  const calls = { start: 0, pause: 0, resume: 0, dispose: 0 };
  let onFinal: (t: string) => void = () => {};
  let onPartial: (t: string) => void = () => {};
  const rec: SpeechRecognizer = {
    start: vi.fn(async () => { calls.start += 1; }),
    pause: vi.fn(() => { calls.pause += 1; }),
    resume: vi.fn(() => { calls.resume += 1; }),
    dispose: vi.fn(async () => { calls.dispose += 1; }),
    onPartial: (cb) => { onPartial = cb; },
    onFinal: (cb) => { onFinal = cb; },
    onError: () => {}
  };
  return { rec, calls, emitFinal: (t: string) => onFinal(t), emitPartial: (t: string) => onPartial(t) };
}

describe('VoiceConversation turn-taking', () => {
  it('continuous: listen → ask → speak → listen, pausing the mic during the turn (no feedback loop)', async () => {
    const f = fakeRecognizer();
    const ask = vi.fn(async (t: string) => `reply to ${t}`);
    const speak = vi.fn(async () => {});
    const states: string[] = [];
    const convo = new VoiceConversation({ recognizer: f.rec, ask, speak, mode: 'continuous', onState: (s) => states.push(s) });

    await convo.start();
    expect(convo.getState()).toBe('listening');

    f.emitFinal('what is this case about');
    await flush();

    expect(ask).toHaveBeenCalledWith('what is this case about');
    expect(speak).toHaveBeenCalledWith('reply to what is this case about');
    // Mic paused before asking, resumed after speaking → back to listening.
    expect(f.calls.pause).toBeGreaterThanOrEqual(1);
    expect(convo.getState()).toBe('listening');
    expect(states).toEqual(['listening', 'thinking', 'speaking', 'listening']);
  });

  it('ignores sub-threshold noise transcripts without calling the AI', async () => {
    const f = fakeRecognizer();
    const ask = vi.fn(async () => 'x');
    const convo = new VoiceConversation({ recognizer: f.rec, ask, speak: async () => {}, mode: 'continuous', minChars: 3 });
    await convo.start();
    f.emitFinal('uh');
    await flush();
    expect(ask).not.toHaveBeenCalled();
    expect(convo.getState()).toBe('listening');
  });

  it('push-to-talk: accumulates finals across the hold and handles them on release', async () => {
    const f = fakeRecognizer();
    const ask = vi.fn(async (t: string) => `ok: ${t}`);
    const speak = vi.fn(async () => {});
    const convo = new VoiceConversation({ recognizer: f.rec, ask, speak, mode: 'ptt' });
    await convo.start();
    expect(convo.getState()).toBe('idle'); // ptt waits for a hold

    convo.pttDown();
    expect(convo.getState()).toBe('listening');
    f.emitFinal('summarise the');
    f.emitFinal('latest findings');
    await flush();
    expect(ask).not.toHaveBeenCalled(); // still holding

    convo.pttUp();
    await flush();
    expect(ask).toHaveBeenCalledWith('summarise the latest findings');
    expect(speak).toHaveBeenCalled();
    expect(convo.getState()).toBe('idle');
  });

  it('stop() disposes the recognizer and returns to idle', async () => {
    const f = fakeRecognizer();
    const convo = new VoiceConversation({ recognizer: f.rec, ask: async () => '', speak: async () => {}, mode: 'continuous' });
    await convo.start();
    await convo.stop();
    expect(f.calls.dispose).toBe(1);
    expect(convo.getState()).toBe('idle');
  });

  it('a final arriving while thinking/speaking is dropped (not double-handled)', async () => {
    const f = fakeRecognizer();
    let resolveAsk: (v: string) => void = () => {};
    const ask = vi.fn(() => new Promise<string>((r) => { resolveAsk = r; }));
    const convo = new VoiceConversation({ recognizer: f.rec, ask, speak: async () => {}, mode: 'continuous' });
    await convo.start();
    f.emitFinal('first question');
    await flush();
    expect(convo.getState()).toBe('thinking');
    f.emitFinal('stray transcript while thinking');
    await flush();
    expect(ask).toHaveBeenCalledTimes(1); // second final ignored
    resolveAsk('answer');
    await flush();
    expect(convo.getState()).toBe('listening');
  });
});
