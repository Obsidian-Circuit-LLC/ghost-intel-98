/**
 * Text-to-speech via the Web Speech API (`window.speechSynthesis`).
 *
 * This is fully OFFLINE / on-device: it uses the voices installed on the OS. On Windows that
 * includes the Windows 11 "Natural" voices IF the user has installed them (Settings →
 * Accessibility → Speech / Narrator → add natural voices) — they aren't exposed to apps
 * otherwise. No cloud, no Python, no bundled audio.
 *
 * NOTE: the STT (speech-to-text) half of voice conversations deliberately does NOT use the Web
 * Speech API — Chromium's webkitSpeechRecognition streams mic audio to Google's cloud. The
 * offline push-to-talk path uses a local Vosk engine instead (separate module).
 *
 * Designed as the TTS seam for later continuous-conversation work: speak()/cancel()/isSpeaking()
 * plus an onEnd callback are enough for a turn-taking loop to drive.
 */

export interface TtsVoice {
  /** Stable identifier passed back to speak(). */
  voiceURI: string;
  name: string;
  lang: string;
  /** True for voices that may resolve over the network (e.g. some "Online (Natural)" voices).
   *  Surfaced so the UI can prefer / mark on-device voices under the no-cloud posture. */
  remote: boolean;
  default: boolean;
}

function synth(): SpeechSynthesis | null {
  return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
}

/** True if this runtime can speak at all. */
export function ttsSupported(): boolean {
  return synth() !== null;
}

function mapVoice(v: SpeechSynthesisVoice): TtsVoice {
  return { voiceURI: v.voiceURI, name: v.name, lang: v.lang, remote: !v.localService, default: v.default };
}

/** List installed voices. The list populates asynchronously on first access in Chromium, so we
 *  resolve once `onvoiceschanged` fires (or immediately if already populated), with a timeout. */
export function listVoices(): Promise<TtsVoice[]> {
  const s = synth();
  if (!s) return Promise.resolve([]);
  const now = s.getVoices();
  if (now.length > 0) return Promise.resolve(now.map(mapVoice));
  return new Promise((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      resolve(s.getVoices().map(mapVoice));
    };
    s.addEventListener('voiceschanged', finish, { once: true });
    setTimeout(finish, 1500);
  });
}

/** Subscribe to OS voice-list changes and get the updated list each time. Returns an unsubscribe.
 *  The voice set can change at runtime (a voice pack installs, or Chromium finishes populating it
 *  after the initial one-shot `listVoices()` window) — a persistent listener keeps the picker
 *  honest instead of being stuck with whatever was (or wasn't) available at mount. Does NOT fire
 *  on subscribe; pair it with `listVoices()` for the initial value. */
export function onVoicesChanged(cb: (voices: TtsVoice[]) => void): () => void {
  const s = synth();
  if (!s) return () => { /* no speech engine — nothing to observe */ };
  const emit = (): void => cb(s.getVoices().map(mapVoice));
  s.addEventListener('voiceschanged', emit);
  return () => s.removeEventListener('voiceschanged', emit);
}

export interface SpeakOpts {
  voiceURI?: string | null;
  rate?: number;
  onEnd?: () => void;
}

export type SpeakResult =
  | { spoken: true }
  | { spoken: false; reason: 'unsupported' | 'empty' | 'remote-blocked' | 'no-local-voice' };

/** Hard cap on utterance length — bounds what a long reply ships to the engine in one shot. */
const MAX_UTTERANCE_CHARS = 4000;

/**
 * Speak `text` through an ON-DEVICE voice only. Cancels any in-progress utterance first.
 *
 * NO-CLOUD ENFORCEMENT (not just labeling): a voice with `localService === false` may stream the
 * utterance text to a cloud TTS service. Under the operator's "no cloud unless explicitly enabled"
 * rule we REFUSE to speak through such a voice — including when the OS *default* voice is remote
 * and no explicit voiceURI was chosen. The caller gets a reason it can surface once.
 */
export function speak(text: string, opts: SpeakOpts = {}): SpeakResult {
  const s = synth();
  if (!s) return { spoken: false, reason: 'unsupported' };
  const trimmed = text.trim().slice(0, MAX_UTTERANCE_CHARS);
  if (!trimmed) return { spoken: false, reason: 'empty' };

  const voices = s.getVoices();
  let voice: SpeechSynthesisVoice | undefined;
  if (opts.voiceURI) {
    voice = voices.find((x) => x.voiceURI === opts.voiceURI);
    // An explicitly-chosen cloud voice is refused — the picker shouldn't offer them, but
    // defend in depth in case a remote voiceURI is persisted from a prior build.
    if (voice && voice.localService === false) return { spoken: false, reason: 'remote-blocked' };
  }
  if (!voice) {
    // No explicit pick (or it vanished): choose an on-device voice rather than deferring to the
    // OS default, which may itself be a cloud voice. FAIL CLOSED — if no local voice is known
    // (including the cold-start window before getVoices() has populated), refuse rather than
    // letting Chromium pick the default (possibly cloud) voice and egress the text.
    voice = voices.find((x) => x.localService);
    if (!voice) return { spoken: false, reason: 'no-local-voice' };
  }

  s.cancel();
  const u = new SpeechSynthesisUtterance(trimmed);
  if (voice) u.voice = voice;
  if (typeof opts.rate === 'number' && Number.isFinite(opts.rate)) {
    u.rate = Math.min(2, Math.max(0.5, opts.rate));
  }
  if (opts.onEnd) u.addEventListener('end', opts.onEnd, { once: true });
  s.speak(u);
  return { spoken: true };
}

/** Stop speaking immediately. */
export function cancelSpeech(): void {
  synth()?.cancel();
}

export function isSpeaking(): boolean {
  return synth()?.speaking ?? false;
}
