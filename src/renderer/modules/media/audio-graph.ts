/** The Jukebox Web-Audio graph: MediaElementSource → [10 peaking biquads] → Analyser → destination.
 *  Built lazily on first play (autoplay policy needs a gesture) and reused. The analyser taps AFTER the
 *  EQ, so the visualizer reflects what you hear. Disabled EQ = flat gains (transparent), no reconnect. */
import { EQ_BANDS, clampGain } from './eq';

export class JukeboxGraph {
  private ctx: AudioContext;
  private bands: BiquadFilterNode[] = [];
  readonly analyser: AnalyserNode;

  constructor(audio: HTMLAudioElement) {
    this.ctx = new AudioContext();
    const src = this.ctx.createMediaElementSource(audio);
    let node: AudioNode = src;
    for (const hz of EQ_BANDS) {
      const f = this.ctx.createBiquadFilter();
      f.type = 'peaking';
      f.frequency.value = hz;
      f.Q.value = 1.0;
      f.gain.value = 0;
      node.connect(f);
      node = f;
      this.bands.push(f);
    }
    const an = this.ctx.createAnalyser();
    an.fftSize = 128;
    node.connect(an);
    an.connect(this.ctx.destination);
    this.analyser = an;
  }

  resume(): void { void this.ctx.resume(); }
  setBandGain(i: number, db: number): void { const f = this.bands[i]; if (f) f.gain.value = clampGain(db); }
  applyGains(gains: number[]): void { this.bands.forEach((f, i) => { f.gain.value = clampGain(gains[i] ?? 0); }); }
  close(): void { void this.ctx.close(); }
}
