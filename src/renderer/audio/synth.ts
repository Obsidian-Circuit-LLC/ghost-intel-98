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
  /** Attack ramp length in seconds (default 0.01). Larger values give a soft "swell"
   *  for pads/boot chimes; tiny values give a percussive onset. */
  attack?: number;
}

function tone({ freq, duration, type = 'square', gain = 0.08, startOffset = 0, attack = 0.01 }: ToneOpts): void {
  const c = getCtx();
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t0 = c.currentTime + startOffset;
  const atk = Math.min(attack, duration * 0.5);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + atk);
  g.gain.linearRampToValueAtTime(0, t0 + duration);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

/** A single crisp mechanical "tick" — short broadband transient through a highpass,
 *  exponential decay. Two ticks back-to-back read as a physical mouse press+release. */
function clickTick(startOffset: number, gain: number): void {
  const c = getCtx();
  const dur = 0.012;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 2200;
  const g = c.createGain();
  const t0 = c.currentTime + startOffset;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.0008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(hp).connect(g).connect(c.destination);
  src.start(t0);
  src.stop(t0 + dur + 0.005);
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

/** Soft click for button-y interactions (legacy; kept for icon/menu callers). */
export function playClick(): void {
  tone({ freq: 1500, duration: 0.03, type: 'square', gain: 0.04 });
}

/** Retro mechanical mouse click — press + release ticks. Used globally on every <button>. */
export function playMouseClick(): void {
  clickTick(0, 0.06);
  clickTick(0.045, 0.035);
}

/** Original power-on swell. Deliberately NOT the Win9x/Eno startup recording — a layered
 *  triangle arpeggio over a soft sine pad, synthesized fresh each launch.
 *
 *  Voiced low and warm (roughly a register below a chime-style jingle) for a darker "hi-fi
 *  waking up" feel: an F-major bed (F2/C3/F3) with slightly detuned twin oscillators for an
 *  analog shimmer, a slow major arpeggio rising F3→F4, and two soft sine bells settling on the
 *  major third so it resolves warm rather than shrill. Original composition; no sampled assets. */
export function playBoot(): void {
  // Low warm pad: root + fifth + octave, each doubled with a faintly detuned twin for lushness.
  const pad: Array<{ f: number; g: number }> = [
    { f: 87.31, g: 0.055 },   // F2 (root)
    { f: 130.81, g: 0.045 },  // C3 (fifth)
    { f: 174.61, g: 0.04 }    // F3 (octave)
  ];
  pad.forEach(({ f, g }) => {
    tone({ freq: f, duration: 2.6, type: 'sine', gain: g, attack: 0.7 });
    tone({ freq: f * 1.004, duration: 2.6, type: 'sine', gain: g * 0.6, attack: 0.8 });
  });
  // Slow major arpeggio resolving up an octave to a warm F-major triad — mellow triangles.
  const arp = [174.61, 220.0, 261.63, 349.23]; // F3 A3 C4 F4
  arp.forEach((f, i) => tone({ freq: f, duration: 1.4 - i * 0.12, type: 'triangle', gain: 0.085, startOffset: 0.35 + i * 0.22, attack: 0.04 }));
  // Two soft bells settling on the third/octave — the "resolved, welcoming" tail, kept low.
  tone({ freq: 440.0, duration: 1.3, type: 'sine', gain: 0.05, startOffset: 1.15, attack: 0.3 });   // A4
  tone({ freq: 523.25, duration: 1.2, type: 'sine', gain: 0.035, startOffset: 1.35, attack: 0.35 }); // C5
}

/** Standard DTMF (touch-tone) dual-tone frequencies — published telephony spec, not an asset. */
const DTMF: Record<string, [number, number]> = {
  '1': [697, 1209], '2': [697, 1336], '3': [697, 1477],
  '4': [770, 1209], '5': [770, 1336], '6': [770, 1477],
  '7': [852, 1209], '8': [852, 1336], '9': [852, 1477],
  '*': [941, 1209], '0': [941, 1336], '#': [941, 1477]
};

/** Play one touch-tone digit as its genuine dual-tone (row + column). */
export function playDtmf(key: string, duration = 0.17): void {
  const pair = DTMF[key];
  if (!pair) return;
  tone({ freq: pair[0], duration, type: 'sine', gain: 0.09 });
  tone({ freq: pair[1], duration, type: 'sine', gain: 0.09 });
}

/** Off-hook pickup click. */
export function playDialPickup(): void {
  clickTick(0, 0.05);
  clickTick(0.04, 0.03);
}

/** Modem carrier handshake — two carriers, scrambled data tones, noise. Resolves when done. */
export function playCarrier(): Promise<void> {
  tone({ freq: 2100, duration: 1.6, type: 'sine', gain: 0.05 });
  tone({ freq: 1300, duration: 1.6, type: 'sine', gain: 0.05 });
  [1700, 1850, 1950].forEach((f, i) => tone({ freq: f, duration: 0.4, type: 'sawtooth', gain: 0.03, startOffset: 0.3 + i * 0.25 }));
  noise(2.0, 0.03, 0.2);
  return new Promise((resolve) => setTimeout(resolve, 2200));
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
