import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JukeboxGraph } from '../src/renderer/modules/media/audio-graph';
import { EQ_BANDS } from '../src/renderer/modules/media/eq';

function fakeCtx() {
  const nodes: any[] = [];
  const mk = (extra: any = {}) => { const n = { connect: vi.fn(), ...extra }; nodes.push(n); return n; };
  return {
    _nodes: nodes,
    createMediaElementSource: () => mk(),
    createAnalyser: () => mk({ fftSize: 0 }),
    createBiquadFilter: () => mk({ type: '', frequency: { value: 0 }, Q: { value: 0 }, gain: { value: 0 } }),
    resume: vi.fn(), close: vi.fn(), destination: {},
  };
}

describe('JukeboxGraph', () => {
  beforeEach(() => { (globalThis as any).AudioContext = vi.fn(() => fakeCtx()); });
  it('builds one peaking filter per band and exposes an analyser', () => {
    const g = new JukeboxGraph({} as HTMLAudioElement);
    const filters = (g as any).bands as any[];
    expect(filters).toHaveLength(EQ_BANDS.length);
    expect(filters[0].type).toBe('peaking');
    expect(filters[0].frequency.value).toBe(EQ_BANDS[0]);
    expect(g.analyser).toBeTruthy();
  });
  it('applyGains clamps and writes each band gain', () => {
    const g = new JukeboxGraph({} as HTMLAudioElement);
    g.applyGains(new Array(EQ_BANDS.length).fill(99));
    for (const f of (g as any).bands as any[]) expect(f.gain.value).toBe(12);
  });
  it('retains the MediaElementAudioSourceNode so it cannot be GC-collected mid-playback', () => {
    // An unreferenced MediaElementAudioSourceNode is garbage-collected by Chromium even while
    // connected, which severs the <audio> element from ctx.destination — sound stops after a
    // non-deterministic delay while <audio>.currentTime keeps advancing. The graph must keep a
    // live JS reference to the source node (as it already does for the ctx, bands, and analyser).
    let ctx: any;
    (globalThis as any).AudioContext = vi.fn(() => { ctx = fakeCtx(); return ctx; });
    const g = new JukeboxGraph({} as HTMLAudioElement);
    const src = ctx._nodes[0]; // createMediaElementSource is built first
    expect(Object.values(g).includes(src)).toBe(true); // retained on the instance, not a local const
    expect(src.connect).toHaveBeenCalledWith((g as any).bands[0]); // still feeds the EQ chain
  });
  it('chains band[i] -> band[i+1] and the last band -> analyser (analyser taps AFTER the EQ)', () => {
    const g = new JukeboxGraph({} as HTMLAudioElement);
    const bands = (g as any).bands as any[];
    for (let i = 0; i < bands.length - 1; i++) {
      expect(bands[i].connect).toHaveBeenCalledWith(bands[i + 1]);
    }
    expect(bands[bands.length - 1].connect).toHaveBeenCalledWith(g.analyser);
  });
});
