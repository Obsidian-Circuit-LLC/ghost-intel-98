/**
 * Piper TTS player (renderer) — drives the main-process Piper sidecar over IPC and plays the returned
 * WAV through an AudioContext. Pipelines synth+play: while chunk N plays, chunk N+1 is being
 * synthesized, so delay-to-first-audio is ~one short sentence rather than the whole reply. Synthesis
 * happens in main (offline, no egress); this file only sends text and plays audio.
 */
import { chunkText } from './piper-core';
import type { SpeakOpts, SpeakResult } from './tts';

let ctx: AudioContext | null = null;
let token = 0; // bumped on every speak/cancel; stale runs check it and bail
let currentSource: AudioBufferSourceNode | null = null;
let piperOk: boolean | null = null;

function audioCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

/** Cached availability probe (binary + voice present in main). Re-probed only if it was unknown. */
export async function piperAvailable(): Promise<boolean> {
  if (piperOk !== null) return piperOk;
  try {
    piperOk = (await window.api.tts.piperStatus()).available;
  } catch {
    piperOk = false;
  }
  return piperOk;
}

/** Stop any in-flight Piper playback + synthesis. */
export function cancelPiper(): void {
  token += 1; // invalidate any running generator/player
  if (currentSource) { try { currentSource.stop(); } catch { /* already stopped */ } currentSource = null; }
  void window.api.tts.cancel().catch(() => { /* best-effort kill of an in-flight synth */ });
}

export function isPiperSpeaking(): boolean {
  return currentSource !== null;
}

/**
 * Speak `text` via Piper. Resolves once playback STARTS (or with a reason if nothing to say);
 * `opts.onEnd` fires when the whole utterance finishes (or on error, so turn-taking can't hang).
 */
export async function speakPiper(text: string, opts: SpeakOpts = {}): Promise<SpeakResult> {
  cancelPiper(); // supersede any prior utterance (this bumps `token`)
  const myToken = token; // capture the post-bump token; stale runs compare against it
  const chunks = chunkText(text);
  if (chunks.length === 0) return { spoken: false, reason: 'empty' };

  const ac = audioCtx();
  if (ac.state === 'suspended') { try { await ac.resume(); } catch { /* gesture may be required */ } }

  const buffers: AudioBuffer[] = [];
  let playIdx = 0;
  let playing = false;
  let genDone = false;
  let finished = false;
  const finish = (): void => {
    if (finished) return;
    finished = true;
    currentSource = null;
    opts.onEnd?.();
  };

  const playNext = (): void => {
    if (myToken !== token) return; // cancelled / superseded
    if (playIdx >= buffers.length) {
      if (genDone) finish(); else playing = false;
      return;
    }
    playing = true;
    const src = ac.createBufferSource();
    src.buffer = buffers[playIdx++];
    src.connect(ac.destination);
    currentSource = src;
    src.onended = () => { if (myToken === token) playNext(); };
    src.start();
  };

  void (async () => {
    try {
      for (const chunk of chunks) {
        if (myToken !== token) return;
        const wav = await window.api.tts.synthesize(chunk, opts.rate ?? undefined);
        if (myToken !== token) return;
        const buf = await ac.decodeAudioData(wav.slice().buffer);
        if (myToken !== token) return;
        buffers.push(buf);
        if (!playing) playNext();
      }
      genDone = true;
      if (!playing && playIdx >= buffers.length) finish();
    } catch {
      if (myToken === token) finish(); // surface as "done" so the hands-free loop doesn't hang
    }
  })();

  return { spoken: true };
}
