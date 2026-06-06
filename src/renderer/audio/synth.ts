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

/** Original power-on swell — a glassy synth bloom in the spirit of a late-90s OS waking up, but an
 *  original composition: NOT the copyrighted Windows 98 startup recording, and not a note-for-note
 *  transcription of it. Synthesized fresh each launch; no sampled assets (project invariant).
 *
 *  Voiced in a warm D major and dropped well below a bright chime, with the timbre opening up over
 *  time (an additive "bloom": a faintly-detuned sawtooth edge and a glassy bell triad enter late,
 *  so the sound brightens as it swells — the synthetic shimmer feel without a filter sweep). A high
 *  sparkle arrives last and it settles on the major third, resolving warm rather than shrill. */
export function playBoot(): void {
  // Low warm pad: D-major bed (root/fifth/octave/third). Each sine is shadowed by a faintly
  // detuned sawtooth that swells in slowly — the "more synthetic" edge, blooming late.
  const pad: Array<{ f: number; g: number }> = [
    { f: 73.42, g: 0.05 },    // D2 (root)
    { f: 110.0, g: 0.042 },   // A2 (fifth)
    { f: 146.83, g: 0.038 },  // D3 (octave)
    { f: 185.0, g: 0.03 }     // F#3 (third)
  ];
  pad.forEach(({ f, g }) => {
    tone({ freq: f, duration: 2.6, type: 'sine', gain: g, attack: 0.7 });
    tone({ freq: f * 1.005, duration: 2.6, type: 'sawtooth', gain: g * 0.18, attack: 0.9 });
  });
  // Glassy bell triad blooming in — staggered entries make the timbre open up (additive, so it
  // renders identically every launch) rather than relying on a biquad sweep.
  const bells = [293.66, 369.99, 440.0, 587.33]; // D4 F#4 A4 D5
  bells.forEach((f, i) => tone({ freq: f, duration: 1.6 - i * 0.12, type: 'triangle', gain: 0.06, startOffset: 0.3 + i * 0.14, attack: 0.05 }));
  // High shimmer entering last for sparkle, very soft.
  tone({ freq: 880.0, duration: 1.0, type: 'sine', gain: 0.03, startOffset: 0.9, attack: 0.25 });     // A5
  tone({ freq: 1174.66, duration: 0.9, type: 'sine', gain: 0.022, startOffset: 1.05, attack: 0.3 });  // D6
  // Warm resolve bell on the major third — the "resolved, welcoming" tail.
  tone({ freq: 369.99, duration: 1.4, type: 'sine', gain: 0.045, startOffset: 1.3, attack: 0.3 });    // F#4
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

/** North-American dial tone — a continuous 350 Hz + 440 Hz pair (published telephony spec, the
 *  precise frequencies of the US dial tone, not a sampled asset). Played briefly after pickup,
 *  before the digits are dialed, exactly as the reference handshake opens. */
export function playDialTone(duration = 0.5): void {
  tone({ freq: 350, duration, type: 'sine', gain: 0.06 });
  tone({ freq: 440, duration, type: 'sine', gain: 0.05 });
}

/** One "packet beat" of the DialTerm uplink animation. The CSS keyframe `ga98-packet-travel`
 *  loops every 1.1 s with three packets staggered by a third of that, so a packet crosses the link
 *  every CARRIER_BEAT seconds. playCarrier lays its events on this grid (and the module reveals the
 *  negotiation log on it too) so the audio lands in lockstep with the visuals. Keep in sync with
 *  theme.css. */
export const CARRIER_BEAT = 1.1 / 3; // ≈ 0.3667 s

/** Modem dial-up handshake — the authentic V-series connect sequence, reproduced synthetically from
 *  its functional ITU tones (an analysis of a real handshake recording gives the phase timeline; the
 *  frequencies themselves are standardised signals, not copyrightable expression — and nothing is
 *  sampled). Compressed onto the uplink animation's packet beat so audio + visuals + log advance in
 *  lockstep. Phase map (B ≈ 0.367 s):
 *    0–2  remote modem answers — 2100 Hz answer tone (CED/ANSam) + a short V.8 answer warble
 *    2–3  the iconic V.8 two-tone "bong" (low → high)
 *    3–5  V.21 FSK negotiation — the low mark/space warble
 *    5–7  2100 Hz echo-canceller-disable tone, sustained, with a faint probe underneath
 *    7–9  V.34 line-probe "gallop" — a mid warble under a rising multitone sweep
 *    9–12 full scrambled-data roar — broadband low/mid/high carriers + rising hiss + a data chirp
 *         on every packet beat
 *  Runs 12 beats (4 full packet cycles ≈ 4.4 s); resolves when done. */
export function playCarrier(): Promise<void> {
  const B = CARRIER_BEAT;
  // Phase 1 (beats 0–2) — remote modem answers: 2100 Hz answer tone with a brief V.8 answer warble
  // (1530 + 2220) riding the front edge.
  tone({ freq: 2100, duration: B * 2, type: 'sine', gain: 0.06, startOffset: 0 });
  tone({ freq: 2220, duration: 0.22, type: 'sine', gain: 0.05, startOffset: 0 });
  tone({ freq: 1530, duration: 0.22, type: 'sine', gain: 0.045, startOffset: 0.05 });
  // Phase 2 (beat 2) — the V.8 two-tone "bong", low then high.
  tone({ freq: 650, duration: 0.18, type: 'sine', gain: 0.1, startOffset: B * 2 });
  tone({ freq: 1240, duration: 0.2, type: 'sine', gain: 0.1, startOffset: B * 2 + 0.18 });
  // Phase 3 (beats 3–5) — V.21 FSK negotiation: the low warble, mark/space hopping each half-beat.
  const fsk = [980, 1650, 1180, 1450, 990, 1620, 1080, 1340];
  for (let i = 0; i < fsk.length; i += 1) {
    tone({ freq: fsk[i], duration: B * 0.45, type: 'square', gain: 0.035, startOffset: B * 3 + i * B * 0.5 });
  }
  // Phase 4 (beats 5–7) — 2100 Hz echo-canceller-disable tone, sustained, with a faint probe.
  tone({ freq: 2100, duration: B * 2, type: 'sine', gain: 0.05, startOffset: B * 5 });
  tone({ freq: 1100, duration: B * 2, type: 'sine', gain: 0.012, startOffset: B * 5 });
  // Phase 5 (beats 7–9) — V.34 line-probe "gallop": a mid sawtooth warble under a rising sweep.
  const gallop = [1600, 1900, 1700, 1840, 1650, 1900];
  for (let i = 0; i < gallop.length; i += 1) {
    tone({ freq: gallop[i], duration: (B / 3) * 0.9, type: 'sawtooth', gain: 0.03, startOffset: B * 7 + i * (B / 3) });
  }
  const sweep = [2250, 2550, 2850, 3000];
  for (let i = 0; i < sweep.length; i += 1) {
    tone({ freq: sweep[i], duration: B * 0.45, type: 'sine', gain: 0.025, startOffset: B * 7 + i * B * 0.5 });
  }
  // Phase 6 (beats 9–12) — full scrambled-data roar: broadband carriers (low/mid/high) + rising
  // filtered hiss + a sawtooth data chirp on every packet beat (each coincides with a packet
  // launching across the link).
  const dataStart = B * 9;
  const dataBeats = 3;
  const roar: Array<[number, number]> = [[360, 0.03], [1300, 0.035], [1800, 0.03], [2700, 0.022], [3100, 0.018]];
  roar.forEach(([f, g]) => tone({ freq: f, duration: B * dataBeats, type: 'sine', gain: g, startOffset: dataStart }));
  const chirps = [1700, 2250, 1550];
  for (let i = 0; i < dataBeats; i += 1) {
    tone({ freq: chirps[i % chirps.length], duration: 0.2, type: 'sawtooth', gain: 0.03, startOffset: dataStart + i * B });
  }
  noise(B * dataBeats, 0.05, dataStart);
  const total = dataStart + B * dataBeats; // 12 beats ≈ 4.4 s
  return new Promise((resolve) => setTimeout(resolve, total * 1000));
}

/** Hang-up: a legacy handset dropped back onto its cradle — the switch-hook click, a low plastic
 *  "clunk" with a settling bounce and a bit of rattle, and a faint bell residue (older phones give
 *  a tiny ding as the hook closes). Built from the same primitives; no sampled assets. */
export function playHangup(): void {
  clickTick(0, 0.05);                                                              // hook switch depresses
  tone({ freq: 150, duration: 0.06, type: 'triangle', gain: 0.16, attack: 0.002 }); // body of the handset
  tone({ freq: 92, duration: 0.09, type: 'sine', gain: 0.13, attack: 0.002 });      // low thud
  noise(0.05, 0.05, 0.004);                                                          // plastic clack/rattle
  tone({ freq: 1480, duration: 0.08, type: 'sine', gain: 0.02, startOffset: 0.03 }); // faint bell residue
  // settling bounce as it seats into the cradle
  tone({ freq: 132, duration: 0.05, type: 'triangle', gain: 0.09, attack: 0.002, startOffset: 0.075 });
  noise(0.03, 0.03, 0.08);
  clickTick(0.065, 0.03);
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
