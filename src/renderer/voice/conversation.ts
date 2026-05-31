/**
 * VoiceConversation — the turn-taking controller for hands-free voice chat with the AI.
 *
 * It orchestrates: listen → (final transcript) → ask the AI → speak the reply → resume listening.
 * The recognizer is PAUSED while the AI is thinking/speaking so the assistant never transcribes
 * its own TTS voice into a feedback loop. Push-to-talk is the same machine with the listen window
 * gated by a button hold; continuous mode listens whenever it isn't thinking/speaking.
 *
 * Deliberately dependency-injected (recognizer + ask + speak are passed in) and DOM-free, so the
 * state machine is unit-testable with fakes — the part of this feature that CAN be verified on CI.
 */

import type { SpeechRecognizer } from './recognizer';

export type VoiceState = 'idle' | 'listening' | 'thinking' | 'speaking';
export type VoiceMode = 'ptt' | 'continuous';

export interface VoiceConversationDeps {
  recognizer: SpeechRecognizer;
  /** Send a transcript to the AI; resolve with the full reply text. */
  ask: (text: string) => Promise<string>;
  /** Speak text via offline TTS; resolve when speech finishes. */
  speak: (text: string) => Promise<void>;
  mode: VoiceMode;
  /** Transcripts shorter than this (after trim) are treated as noise and ignored. */
  minChars?: number;
  onState?: (s: VoiceState) => void;
  onPartial?: (t: string) => void;
  /** Fired after a completed turn with the user's transcript and the AI's reply. */
  onTurn?: (userText: string, replyText: string) => void;
  onError?: (e: Error) => void;
}

export class VoiceConversation {
  private state: VoiceState = 'idle';
  private running = false;
  private pttBuffer = '';
  private readonly minChars: number;

  constructor(private readonly deps: VoiceConversationDeps) {
    this.minChars = deps.minChars ?? 2;
  }

  getState(): VoiceState { return this.state; }

  private setState(s: VoiceState): void {
    this.state = s;
    this.deps.onState?.(s);
  }

  async start(): Promise<void> {
    this.running = true;
    const { recognizer } = this.deps;
    recognizer.onPartial((t) => { if (this.running) this.deps.onPartial?.(t); });
    recognizer.onFinal((t) => { void this.onFinal(t); });
    recognizer.onError((e) => this.deps.onError?.(e));
    await recognizer.start();
    if (this.deps.mode === 'continuous') {
      recognizer.resume();
      this.setState('listening');
    } else {
      // Push-to-talk: hold the mic muted until the user presses-and-holds.
      recognizer.pause();
      this.setState('idle');
    }
  }

  /** Push-to-talk press: open the listen window. */
  pttDown(): void {
    if (!this.running || this.deps.mode !== 'ptt' || this.state !== 'idle') return;
    this.pttBuffer = '';
    this.deps.recognizer.resume();
    this.setState('listening');
  }

  /** Push-to-talk release: close the window and handle whatever was captured. */
  pttUp(): void {
    if (!this.running || this.deps.mode !== 'ptt' || this.state !== 'listening') return;
    this.deps.recognizer.pause();
    const text = this.pttBuffer.trim();
    this.pttBuffer = '';
    void this.handle(text);
  }

  private async onFinal(text: string): Promise<void> {
    if (!this.running) return;
    if (this.deps.mode === 'ptt') {
      // Accumulate finals across the hold; handled on release. Cap so a very long hold can't
      // ship an unbounded transcript in one request.
      if (this.state === 'listening') this.pttBuffer = `${this.pttBuffer} ${text}`.trim().slice(0, 4000);
      return;
    }
    // Continuous: each final (segmented by Vosk on silence) is one utterance.
    if (this.state === 'listening') await this.handle(text);
  }

  private async handle(text: string): Promise<void> {
    const clean = text.trim();
    if (!this.running) return;
    if (clean.length < this.minChars) {
      // Too short to be a real utterance — go back to listening (continuous) / idle (ptt).
      this.resumeAfterTurn();
      return;
    }
    // Pause the mic so the AI's spoken reply isn't fed back into recognition.
    this.deps.recognizer.pause();
    this.setState('thinking');
    try {
      const reply = await this.ask(clean);
      if (!this.running) return;
      this.deps.onTurn?.(clean, reply);
      if (reply.trim()) {
        this.setState('speaking');
        await this.deps.speak(reply);
      }
    } catch (err) {
      this.deps.onError?.(err as Error);
    } finally {
      if (this.running) this.resumeAfterTurn();
    }
  }

  private ask(text: string): Promise<string> { return this.deps.ask(text); }

  private resumeAfterTurn(): void {
    if (this.deps.mode === 'continuous') {
      this.deps.recognizer.resume();
      this.setState('listening');
    } else {
      this.setState('idle'); // ptt: wait for the next hold
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    this.setState('idle');
    await this.deps.recognizer.dispose();
  }
}
