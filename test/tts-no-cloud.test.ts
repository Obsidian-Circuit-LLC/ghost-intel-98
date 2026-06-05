// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub the Web Speech API: jsdom implements neither speechSynthesis nor SpeechSynthesisUtterance.
interface FakeVoice { voiceURI: string; name: string; lang: string; localService: boolean; default: boolean }
const spoken: Array<{ text: string; voice?: FakeVoice }> = [];
let voices: FakeVoice[] = [];

class FakeUtterance {
  text: string;
  voice: FakeVoice | undefined;
  rate = 1;
  constructor(t: string) { this.text = t; }
  addEventListener(): void { /* noop */ }
}

beforeEach(() => {
  spoken.length = 0;
  (globalThis as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = FakeUtterance;
  const synth = {
    getVoices: () => voices,
    cancel: vi.fn(),
    speak: vi.fn((u: FakeUtterance) => spoken.push({ text: u.text, voice: u.voice })),
    speaking: false,
    addEventListener: vi.fn()
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
});

import { speak, onVoicesChanged } from '../src/renderer/audio/tts';

const LOCAL: FakeVoice = { voiceURI: 'local', name: 'Local', lang: 'en', localService: true, default: false };
const REMOTE: FakeVoice = { voiceURI: 'remote', name: 'Online Natural', lang: 'en', localService: false, default: true };

describe('TTS no-cloud enforcement', () => {
  it('refuses an explicitly-chosen cloud (remote) voice — case text must not egress', () => {
    voices = [LOCAL, REMOTE];
    const r = speak('case-sensitive reply', { voiceURI: 'remote' });
    expect(r).toEqual({ spoken: false, reason: 'remote-blocked' });
    expect(spoken).toHaveLength(0);
  });

  it('picks an ON-DEVICE voice when none is chosen (not the remote OS default)', () => {
    voices = [REMOTE, LOCAL]; // remote is .default — must NOT be used
    const r = speak('hello', {});
    expect(r).toEqual({ spoken: true });
    expect(spoken[0].voice?.voiceURI).toBe('local');
  });

  it('refuses to speak when only cloud voices are installed', () => {
    voices = [REMOTE];
    const r = speak('hello', {});
    expect(r).toEqual({ spoken: false, reason: 'no-local-voice' });
    expect(spoken).toHaveLength(0);
  });

  it('fails CLOSED on a cold-start empty voice list (does not fall through to OS default)', () => {
    voices = []; // getVoices() not yet populated
    const r = speak('case dossier text', {});
    expect(r).toEqual({ spoken: false, reason: 'no-local-voice' });
    expect(spoken).toHaveLength(0);
  });

  it('caps very long utterances', () => {
    voices = [LOCAL];
    speak('x'.repeat(10_000), {});
    expect(spoken[0].text.length).toBeLessThanOrEqual(4000);
  });
});

describe('onVoicesChanged — live voice discovery', () => {
  // A speechSynthesis stub with a real event registry so we can fire `voiceschanged`.
  let handlers: Array<() => void>;
  function installSynth(): void {
    handlers = [];
    const synth = {
      getVoices: () => voices,
      cancel: vi.fn(),
      speak: vi.fn(),
      speaking: false,
      addEventListener: (ev: string, h: () => void) => { if (ev === 'voiceschanged') handlers.push(h); },
      removeEventListener: (ev: string, h: () => void) => {
        if (ev === 'voiceschanged') handlers = handlers.filter((x) => x !== h);
      }
    };
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  }

  it('does NOT fire on subscribe (the caller pairs it with listVoices for the initial value)', () => {
    installSynth();
    voices = [LOCAL];
    const cb = vi.fn();
    onVoicesChanged(cb);
    expect(cb).not.toHaveBeenCalled();
  });

  it('emits the mapped voice list when voiceschanged fires, with remote = !localService', () => {
    installSynth();
    voices = [];
    const cb = vi.fn();
    onVoicesChanged(cb);
    // Voices arrive after the initial window — the case the one-shot fetch used to lose.
    voices = [LOCAL, REMOTE];
    handlers.forEach((h) => h());
    expect(cb).toHaveBeenCalledTimes(1);
    const emitted = cb.mock.calls[0][0] as Array<{ voiceURI: string; remote: boolean }>;
    expect(emitted.map((v) => [v.voiceURI, v.remote])).toEqual([['local', false], ['remote', true]]);
  });

  it('unsubscribe stops further emissions', () => {
    installSynth();
    voices = [LOCAL];
    const cb = vi.fn();
    const off = onVoicesChanged(cb);
    off();
    handlers.forEach((h) => h()); // any leftover handlers (should be none)
    expect(cb).not.toHaveBeenCalled();
  });
});
