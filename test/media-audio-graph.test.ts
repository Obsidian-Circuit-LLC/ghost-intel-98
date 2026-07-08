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
});
