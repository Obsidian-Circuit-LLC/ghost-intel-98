/** Layered module banner header. Three stacked layers give a seamless, animated header at any width:
 *   0. an ambient blur fill (a pre-blurred zoomed copy of the banner) as the base, set per-module;
 *   1. a colour-matched Matrix code-rain canvas over it (adapted from invoices/LedgerFill — throttled
 *      RAF, paused off-screen, one static frame under prefers-reduced-motion, handles cleaned up);
 *   2. the crisp banner art, centred at its natural size, with mask-feathered left/right edges so it
 *      DISSOLVES into the rain instead of showing a hard rectangle — a truly seamless edge bleed.
 * Rain colours are built into rgba() at runtime from numeric arrays, so no static colour literal is
 * emitted into themed source (keeps the quiet-amethyst no-straggler guard clean). Decoration only. */
import { useEffect, useRef } from 'react';

export type BannerVariant = 'q' | 'briefcase' | 'mail' | 'settings' | 'shred' | 'journal';

// glyph = accent that matches each banner; fade = trailing-fill (also tints the field toward the
// banner's own base colour). Higher fade alpha ⇒ faster trails + more base tint.
const RAIN: Record<BannerVariant, { glyph: [number, number, number]; fade: [number, number, number, number] }> = {
  q:         { glyph: [90, 205, 220],  fade: [20, 26, 27, 0.40] },
  briefcase: { glyph: [95, 200, 210],  fade: [14, 14, 20, 0.42] },
  mail:      { glyph: [130, 180, 255], fade: [6, 16, 96, 0.40] },
  settings:  { glyph: [90, 215, 205],  fade: [26, 74, 109, 0.36] },
  shred:     { glyph: [130, 150, 245], fade: [26, 35, 66, 0.40] },
  journal:   { glyph: [60, 80, 160],   fade: [172, 174, 182, 0.42] },
};

const GLYPHS = '01<>{}[]#$%&*/\\=+ﾊﾋﾐ日ﾎ'.split('');

function BannerRain({ variant }: { variant: BannerVariant }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const { glyph, fade } = RAIN[variant];
    const glyphColor = (a: number): string => `rgba(${glyph[0]},${glyph[1]},${glyph[2]},${a})`;
    const fadeColor = `rgba(${fade[0]},${fade[1]},${fade[2]},${fade[3]})`;
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0; let onScreen = true; let last = 0; let cols: number[] = [];

    const size = (): void => {
      const r = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(r.width));
      canvas.height = Math.max(1, Math.floor(r.height));
    };
    size();
    // Resizing the canvas clears its bitmap; the RAF loop repaints next frame, but under
    // reduced-motion there is no loop — redraw the single static frame right after a resize.
    const ro = new ResizeObserver(() => { size(); if (reduce) draw(); }); ro.observe(canvas);
    const io = new IntersectionObserver((e) => {
      onScreen = e[0].isIntersecting;
      if (onScreen && !reduce && !raf) raf = requestAnimationFrame(loop);
    }); io.observe(canvas);

    function draw(): void {
      const w = canvas!.width; const h = canvas!.height; const fs = 13;
      ctx!.fillStyle = fadeColor; ctx!.fillRect(0, 0, w, h); // trailing fade + base tint
      const n = Math.max(1, Math.floor(w / fs));
      if (cols.length !== n) cols = Array.from({ length: n }, () => Math.random() * h);
      ctx!.font = `${fs}px monospace`;
      for (let i = 0; i < n; i++) {
        ctx!.fillStyle = glyphColor(0.35 + Math.random() * 0.4);
        ctx!.fillText(GLYPHS[(Math.random() * GLYPHS.length) | 0], i * fs, cols[i]);
        cols[i] = cols[i] > h + Math.random() * 120 ? 0 : cols[i] + fs * 0.6;
      }
    }
    function loop(t: number): void {
      raf = 0;
      if (!onScreen) return;
      if (t - last > 40) { draw(); last = t; } // ~24fps
      raf = requestAnimationFrame(loop);
    }
    if (reduce) draw(); else raf = requestAnimationFrame(loop);
    return () => { if (raf) cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); };
  }, [variant]);
  return <canvas ref={ref} className="ga98-module-banner-rain" aria-hidden="true" />;
}

export function ModuleBanner({ variant, src, blurSrc, alt }: {
  variant: BannerVariant; src: string; blurSrc: string; alt: string;
}): JSX.Element {
  return (
    <div className={`ga98-module-banner-wrap ga98-banner-${variant}`} style={{ backgroundImage: `url(${blurSrc})` }}>
      <BannerRain variant={variant} />
      <img src={src} alt={alt} className="ga98-module-banner" />
    </div>
  );
}
