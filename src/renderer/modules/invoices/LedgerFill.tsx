/** Animated header fill beside the left-pinned banner: purple pixel-cubes dissolving out of the banner
 *  edge (denser at the left seam) + a sparse matrix code-rain behind them, gradient-blended at the seam,
 *  with a low-opacity "NO CHEATING!" watermark up the right edge. Pure decoration: throttled RAF, paused
 *  off-screen, one static frame under prefers-reduced-motion, all handles cleaned up on unmount. */
import { useEffect, useRef } from 'react';

const GLYPHS = '01<>{}[]#$%&*/\\=+ﾊﾋﾐ日ﾎ'.split('');

export function LedgerFill(): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0; let onScreen = true; let last = 0; let cols: number[] = [];

    const size = (): void => { const r = canvas.getBoundingClientRect(); canvas.width = Math.max(1, Math.floor(r.width)); canvas.height = Math.max(1, Math.floor(r.height)); };
    size();
    const ro = new ResizeObserver(size); ro.observe(canvas);
    const io = new IntersectionObserver((e) => { onScreen = e[0].isIntersecting; if (onScreen && !reduce && !raf) raf = requestAnimationFrame(loop); }); io.observe(canvas);

    function draw(): void {
      const w = canvas!.width; const h = canvas!.height; const fs = 12;
      ctx!.fillStyle = 'rgba(18,8,31,0.35)'; ctx!.fillRect(0, 0, w, h); // trailing fade
      // matrix rain (behind)
      const n = Math.max(1, Math.floor(w / fs));
      if (cols.length !== n) cols = Array.from({ length: n }, () => Math.random() * h);
      ctx!.font = `${fs}px monospace`;
      for (let i = 0; i < n; i++) {
        ctx!.fillStyle = 'rgba(160,120,255,0.5)';
        ctx!.fillText(GLYPHS[(Math.random() * GLYPHS.length) | 0], i * fs, cols[i]);
        cols[i] = cols[i] > h + Math.random() * 120 ? 0 : cols[i] + fs * 0.6;
      }
      // pixel cubes dissolving from the left seam (denser at left)
      const cube = 10;
      for (let x = 0; x < w; x += cube + 4) {
        const density = Math.max(0, 1 - x / (w * 0.8)); // 1 at seam → 0 rightward
        for (let y = 0; y < h; y += cube + 4) {
          if (Math.random() < density * 0.5) {
            ctx!.fillStyle = `rgba(124,77,255,${0.25 + density * 0.5})`;
            ctx!.fillRect(x, y, cube, cube);
            ctx!.fillStyle = 'rgba(200,170,255,0.35)'; ctx!.fillRect(x, y, cube, 2); // top highlight
          }
        }
      }
      // seam gradient (blend into the banner's dark edge)
      const g = ctx!.createLinearGradient(0, 0, Math.min(120, w), 0);
      g.addColorStop(0, '#0d0518'); g.addColorStop(1, 'rgba(13,5,24,0)');
      ctx!.fillStyle = g; ctx!.fillRect(0, 0, Math.min(120, w), h);
      // watermark up the right edge
      ctx!.save(); ctx!.translate(w - 12, h / 2); ctx!.rotate(-Math.PI / 2);
      ctx!.font = 'bold 13px monospace'; ctx!.textAlign = 'center'; ctx!.fillStyle = 'rgba(210,185,255,0.16)';
      ctx!.fillText('NO CHEATING!', 0, 0); ctx!.restore();
    }
    function loop(t: number): void {
      raf = 0;
      if (!onScreen) return;
      if (t - last > 40) { draw(); last = t; } // ~24fps
      raf = requestAnimationFrame(loop);
    }
    if (reduce) draw(); else raf = requestAnimationFrame(loop);
    return () => { if (raf) cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); };
  }, []);
  return <canvas ref={ref} className="ga98-ledger-fill" aria-hidden="true" />;
}
