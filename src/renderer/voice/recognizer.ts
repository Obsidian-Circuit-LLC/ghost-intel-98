/**
 * Offline speech-to-text via Vosk (WASM, in-renderer) — the on-device alternative to Chromium's
 * cloud-backed webkitSpeechRecognition, which would violate the no-cloud rule.
 *
 * This module is the ISOLATED glue between vosk-browser's API and the rest of the app, behind a
 * minimal `SpeechRecognizer` seam so the turn-taking controller (and any future continuous/VAD
 * work) never touches Vosk directly. vosk-browser is dynamically imported so its WASM only loads
 * when voice is actually used, and a bundling/runtime failure degrades gracefully at that point.
 *
 * NOTE: the mic + WASM + AudioContext path can only be verified in a real browser with a
 * microphone and the bundled model present (operator's Windows box) — not on headless CI.
 */

export interface SpeechRecognizer {
  /** Acquire the mic + start feeding audio to the recognizer. */
  start(): Promise<void>;
  /** Stop feeding audio but keep the recognizer/model alive (for turn-taking). */
  pause(): void;
  /** Resume feeding audio after a pause. */
  resume(): void;
  /** Tear everything down: stop tracks, free the recognizer + model + audio graph. */
  dispose(): Promise<void>;
  onPartial(cb: (text: string) => void): void;
  onFinal(cb: (text: string) => void): void;
  onError(cb: (err: Error) => void): void;
}

/** Default model URL — served by the main process's ga98model:// protocol from the bundled
 *  resources/vosk/model.tar.gz. */
export const VOSK_MODEL_URL = 'ga98model://model/model.tar.gz';

export async function createVoskRecognizer(modelUrl = VOSK_MODEL_URL): Promise<SpeechRecognizer> {
  // Dynamic import: keep the WASM out of the startup bundle; surface load failures only on use.
  const vosk = await import('vosk-browser');

  let partialCb: (t: string) => void = () => {};
  let finalCb: (t: string) => void = () => {};
  let errorCb: (e: Error) => void = () => {};

  const model = await vosk.createModel(modelUrl);

  let ctx: AudioContext | null = null;
  let stream: MediaStream | null = null;
  let processor: ScriptProcessorNode | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let sink: GainNode | null = null;
  let recognizer: InstanceType<typeof model.KaldiRecognizer> | null = null;
  let paused = false;
  let disposed = false;

  return {
    async start(): Promise<void> {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // If anything after the mic grant throws (AudioContext exhaustion, audio-stack error), the
      // mic track is already live — release it (and the ctx) before rethrowing so we never leave
      // a hot mic with no handle to stop it (red-team: mic-leak-on-error path).
      try {
        ctx = new AudioContext();
        recognizer = new model.KaldiRecognizer(ctx.sampleRate);
        recognizer.on('result', (m) => {
          const text = (m as { result?: { text?: string } }).result?.text?.trim();
          if (text) finalCb(text);
        });
        recognizer.on('partialresult', (m) => {
          const p = (m as { result?: { partial?: string } }).result?.partial ?? '';
          partialCb(p);
        });
        recognizer.on('error', (m) => errorCb(new Error((m as { error?: string }).error ?? 'vosk error')));

        source = ctx.createMediaStreamSource(stream);
        processor = ctx.createScriptProcessor(4096, 1, 1);
        processor.onaudioprocess = (e): void => {
          if (paused || disposed || !recognizer) return;
          try { recognizer.acceptWaveformFloat(e.inputBuffer.getChannelData(0), ctx!.sampleRate); }
          catch (err) { errorCb(err as Error); }
        };
        // Route mic → processor → a SILENT sink → destination. The zero-gain sink keeps the
        // ScriptProcessor's onaudioprocess firing without playing the microphone back to the
        // speakers (which would create a feedback loop with the TTS).
        sink = ctx.createGain();
        sink.gain.value = 0;
        source.connect(processor);
        processor.connect(sink);
        sink.connect(ctx.destination);
      } catch (err) {
        try { stream.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
        try { recognizer?.remove(); } catch { /* noop */ }
        try { await ctx?.close(); } catch { /* noop */ }
        stream = null; ctx = null; recognizer = null; processor = null; source = null; sink = null;
        throw err;
      }
    },
    pause(): void { paused = true; },
    resume(): void { paused = false; },
    async dispose(): Promise<void> {
      disposed = true;
      try { processor?.disconnect(); } catch { /* noop */ }
      try { source?.disconnect(); } catch { /* noop */ }
      try { sink?.disconnect(); } catch { /* noop */ }
      try { recognizer?.remove(); } catch { /* noop */ }
      try { stream?.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
      try { await ctx?.close(); } catch { /* noop */ }
      try { model.terminate(); } catch { /* noop */ }
      processor = null; source = null; sink = null; recognizer = null; stream = null; ctx = null;
    },
    onPartial(cb): void { partialCb = cb; },
    onFinal(cb): void { finalCb = cb; },
    onError(cb): void { errorCb = cb; }
  };
}
