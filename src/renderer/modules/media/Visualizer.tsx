/**
 * Spectrum visualizer — draws frequency bars from a Web Audio AnalyserNode onto a
 * canvas. Pure presentation; the analyser is owned by the Jukebox module. Stops its
 * animation loop when disabled or unmounted.
 */

import { useEffect, useRef } from 'react';

export function Visualizer({ analyser, enabled }: { analyser: AnalyserNode | null; enabled: boolean }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!enabled || !analyser || !ref.current) return;
    const canvas = ref.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const bins = new Uint8Array(analyser.frequencyBinCount);
    let raf = 0;
    const draw = (): void => {
      raf = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(bins);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const n = 32;
      const step = Math.max(1, Math.floor(bins.length / n));
      const w = canvas.width / n;
      for (let i = 0; i < n; i++) {
        const v = bins[i * step] / 255;
        const h = v * canvas.height;
        ctx.fillStyle = `rgb(${Math.round(80 + v * 175)},255,${Math.round(80 + v * 80)})`;
        ctx.fillRect(i * w, canvas.height - h, Math.max(1, w - 1), h);
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [analyser, enabled]);

  return (
    <canvas
      ref={ref}
      width={240}
      height={42}
      style={{ width: '100%', height: 42, background: '#000', imageRendering: 'pixelated', display: 'block' }}
    />
  );
}
