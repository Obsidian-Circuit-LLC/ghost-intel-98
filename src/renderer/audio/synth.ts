/**
 * Web Audio sound generator. Every sound is synthesized at runtime — no
 * bundled audio files, no copyrighted assets.
 */

let ctx: AudioContext | null = null;
function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  // Resume on user gesture if suspended (browser autoplay policy)
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

interface ToneOpts {
  freq: number;
  duration: number;
  type?: OscillatorType;
  gain?: number;
  startOffset?: number;
}

function tone({ freq, duration, type = 'square', gain = 0.08, startOffset = 0 }: ToneOpts): void {
  const c = getCtx();
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t0 = c.currentTime + startOffset;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
  g.gain.linearRampToValueAtTime(0, t0 + duration);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

function noise(duration: number, gain = 0.04, startOffset = 0): void {
  const c = getCtx();
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * duration), c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * 0.6;
  const src = c.createBufferSource();
  src.buffer = buf;
  const g = c.createGain();
  const t0 = c.currentTime + startOffset;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
  g.gain.linearRampToValueAtTime(0, t0 + duration);
  src.connect(g).connect(c.destination);
  src.start(t0);
  src.stop(t0 + duration);
}

/** Two-chime power-on. */
export function playStartup(): void {
  tone({ freq: 523.25, duration: 0.18, type: 'triangle', gain: 0.12 });
  tone({ freq: 783.99, duration: 0.26, type: 'triangle', gain: 0.12, startOffset: 0.18 });
  tone({ freq: 1046.5, duration: 0.34, type: 'triangle', gain: 0.10, startOffset: 0.42 });
}

/** Single triangle pluck. */
export function playReminder(): void {
  tone({ freq: 880, duration: 0.12, type: 'triangle', gain: 0.14 });
  tone({ freq: 1318.5, duration: 0.18, type: 'triangle', gain: 0.12, startOffset: 0.12 });
}

/** Soft click for button-y interactions. */
export function playClick(): void {
  tone({ freq: 1500, duration: 0.03, type: 'square', gain: 0.04 });
}

/** Error beep. */
export function playError(): void {
  tone({ freq: 196, duration: 0.18, type: 'square', gain: 0.12 });
  tone({ freq: 165, duration: 0.22, type: 'square', gain: 0.12, startOffset: 0.18 });
}

/** Two-note arpeggio (used by Mail post-MVP "You have mail"). Distinct from any AOL asset. */
export function playMailAlert(): void {
  tone({ freq: 659.25, duration: 0.14, type: 'sine', gain: 0.14 });
  tone({ freq: 987.77, duration: 0.22, type: 'sine', gain: 0.14, startOffset: 0.14 });
}

/** Dial-up handshake sequence (DialTerm post-MVP). Original waveform. */
export function playDialup(): Promise<void> {
  // pickup click + DTMF-ish digits + carrier handshake noise
  playClick();
  const digits = [697, 770, 852, 941];
  digits.forEach((f, i) => tone({ freq: f, duration: 0.18, type: 'square', gain: 0.07, startOffset: 0.1 + i * 0.2 }));
  // handshake: two carriers + noise
  tone({ freq: 2100, duration: 1.6, type: 'sine', gain: 0.05, startOffset: 1.0 });
  tone({ freq: 1300, duration: 1.6, type: 'sine', gain: 0.05, startOffset: 1.0 });
  noise(2.0, 0.03, 1.2);
  return new Promise((resolve) => setTimeout(resolve, 3200));
}
